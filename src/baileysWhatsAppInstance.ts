import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    WASocket,
    WAMessage,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { WhatsAppMessage } from './whatsappInstance';

interface BaileysGroupInfo {
    id: { _serialized: string };
    name: string;
    participants: unknown[];
    description: string | null;
}

interface QueueItem {
    id: string;
    groupId: string;
    mediaPath: string;
    content: string;
    options?: {
        type?: 'text' | 'media';
        caption?: string;
        mediaType?: 'image' | 'video' | 'audio' | 'document';
    };
    timestamp: number;
    resolve: (value: void | PromiseLike<void>) => void;
    reject: (reason?: any) => void;
}

export class BaileysWhatsAppInstance {
    private sock: WASocket | null = null;
    private phoneNumber: string;
    private isInitialized: boolean = false;
    private isRestarting_: boolean = false;
    private isConnecting: boolean = false;
    private isDestroying: boolean = false;
    private shouldAttemptReconnect: boolean = true;
    private hasEverConnected: boolean = false;
    private authPath: string;
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    private pairingCodeTimer: ReturnType<typeof setTimeout> | null = null;
    private currentPairingCode: string = '';
    private consecutiveReconnectFailures: number = 0;
    private readonly MAX_BACKOFF_MS = 5 * 60 * 1000;
    private cachedGroups: BaileysGroupInfo[] = [];
    private groupsReady: boolean = false;

    private messageQueue: QueueItem[] = [];
    private isProcessingQueue: boolean = false;
    private queueProcessingDelay: number = 1000;
    private maxQueueSize: number = 100;

    private listeningGroups: Set<string> = new Set();
    private messageHandlers: ((message: WhatsAppMessage) => void)[] = [];

    constructor() {
        this.phoneNumber = (process.env.BAILEYS_PHONE_NUMBER || '').replace(/[^0-9]/g, '');
        this.authPath = process.env.BAILEYS_AUTH_PATH || path.join(process.cwd(), 'baileys_auth');
        this.startQueueProcessor();
    }

    public getEngineType(): 'wwebjs' | 'baileys' {
        return 'baileys';
    }

    public getPhoneNumber(): string {
        return this.phoneNumber;
    }

    public getCurrentQrCode(): string {
        return '';
    }

    public getPairingInfo(): { type: 'qr'; data: string } | { type: 'code'; data: string } | null {
        if (this.currentPairingCode) {
            return { type: 'code', data: this.currentPairingCode };
        }
        return null;
    }

    /**
     * Set a new phone number and initiate pairing from scratch.
     */
    public async pairWithPhone(phone: string): Promise<string> {
        this.phoneNumber = phone.replace(/[^0-9]/g, '');
        if (!this.phoneNumber) {
            throw new Error('Invalid phone number');
        }
        await this.resetInstance();
        await this.initialize();

        // initialize resolves when a pairing code is issued, but allow a short grace period
        if (!this.currentPairingCode) {
            await new Promise(r => setTimeout(r, 2000));
        }
        return this.currentPairingCode || 'Pairing code pending...';
    }

    public async initialize(_qrCallback?: (qr: string) => void): Promise<void> {
        this.shouldAttemptReconnect = true;

        if (this.isConnecting) {
            console.log('[Baileys] Already connecting, skipping duplicate initialization');
            return;
        }

        const authExists = fs.existsSync(path.join(this.authPath, 'creds.json'));

        if (!this.phoneNumber && !authExists) {
            console.log('[Baileys] No phone number configured and no saved session. Use WhatsApp Config to pair a device.');
            return;
        }

        return new Promise(async (resolve, reject) => {
            let settled = false;
            const settleOk = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const settleErr = (err: unknown) => {
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            };

            try {
                this.isConnecting = true;
                console.log('[Baileys] Initializing Baileys instance...');

                if (this.sock) {
                    try {
                        this.clearSocketEventListeners(this.sock);
                        this.sock.end(undefined);
                    } catch (error) {
                        console.error('[Baileys] Error cleaning up existing socket:', error);
                    }
                    this.sock = null;
                }

                const { state, saveCreds } = await useMultiFileAuthState(this.authPath);

                let waVersion: [number, number, number] = [2, 3000, 1033893291];
                try {
                    const { version } = await fetchLatestBaileysVersion();
                    waVersion = version as [number, number, number];
                } catch (versionError) {
                    console.warn('[Baileys] Could not fetch latest WA version, using fallback:', versionError);
                }

                this.sock = makeWASocket({
                    auth: state,
                    printQRInTerminal: false,
                    version: waVersion,
                    browser: Browsers.ubuntu('Chrome'),
                    logger: pino({ level: 'silent' }),
                    connectTimeoutMs: 60_000,
                    defaultQueryTimeoutMs: 60_000,
                    keepAliveIntervalMs: 25_000
                });

                if (!this.sock.authState.creds?.registered && this.phoneNumber) {
                    if (this.pairingCodeTimer) {
                        clearTimeout(this.pairingCodeTimer);
                        this.pairingCodeTimer = null;
                    }
                    this.pairingCodeTimer = setTimeout(async () => {
                        this.pairingCodeTimer = null;
                        if (!this.sock || this.isDestroying || this.sock.authState.creds?.registered) {
                            return;
                        }
                        try {
                            const code = await this.sock!.requestPairingCode(this.phoneNumber);
                            this.currentPairingCode = code;
                            console.log(`[Baileys] Pairing code: ${code}`);
                            console.log('[Baileys] Enter this code in WhatsApp > Linked Devices > Link a Device');
                            // Pairing flow: resolve so callers (pairWithPhone) don't wait forever for 'open'
                            settleOk();
                        } catch (error) {
                            console.error('[Baileys] Error requesting pairing code:', error);
                        }
                    }, 4000);
                }

                this.sock.ev.on('creds.update', saveCreds);

                this.sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
                    if (connection === 'close') {
                        const closeStatusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                        if (closeStatusCode !== DisconnectReason.restartRequired) {
                            console.log('[Baileys] Connection closed');
                        }

                        if (this.isDestroying) return;
                        if (!this.shouldAttemptReconnect) return;
                        if (this.isConnecting) return;

                        const error = lastDisconnect?.error as Boom;
                        const statusCode = error?.output?.statusCode;
                        const isRestartRequired = statusCode === DisconnectReason.restartRequired;

                        const shouldReconnect =
                            statusCode !== DisconnectReason.loggedOut &&
                            this.shouldAttemptReconnect;

                        if (!isRestartRequired) {
                            console.log('[Baileys] Connection closed, statusCode:', statusCode, ', reconnecting:', shouldReconnect);
                        }

                        if (shouldReconnect) {
                            if (this.sock) {
                                this.clearSocketEventListeners(this.sock);
                                this.sock.end(undefined);
                                this.sock = null;
                            }

                            this.isInitialized = false;
                            this.isConnecting = false;

                            let waitTime: number;
                            if (isRestartRequired) {
                                waitTime = 0;
                                console.log('[Baileys] Restart required (515) - reconnecting immediately');
                            } else {
                                this.consecutiveReconnectFailures += 1;
                                const exp = Math.min(this.consecutiveReconnectFailures - 1, 6);
                                waitTime = Math.min(5000 * Math.pow(2, exp), this.MAX_BACKOFF_MS);
                                console.log(`[Baileys] Waiting ${Math.round(waitTime / 1000)}s before reconnect (failure #${this.consecutiveReconnectFailures})`);
                            }

                            if (waitTime > 0) {
                                await new Promise(r => setTimeout(r, waitTime));
                            }

                            if (!this.isDestroying && !this.isConnecting && this.shouldAttemptReconnect) {
                                try {
                                    await this.initialize();
                                } catch (err) {
                                    console.error('[Baileys] Error during reconnection:', err);
                                    this.isConnecting = false;
                                }
                            }
                        } else {
                            console.log('[Baileys] Logged out, removing auth');
                            this.isInitialized = false;
                            if (this.pairingCodeTimer) {
                                clearTimeout(this.pairingCodeTimer);
                                this.pairingCodeTimer = null;
                            }
                            if (this.sock) {
                                try {
                                    this.clearSocketEventListeners(this.sock);
                                    this.sock.end(undefined);
                                } catch (_) {}
                                this.sock = null;
                            }
                            try {
                                fs.rmSync(this.authPath, { recursive: true, force: true });
                            } catch (_) {}
                        }
                    } else if (connection === 'open') {
                        this.isInitialized = true;
                        this.isDestroying = false;
                        this.consecutiveReconnectFailures = 0;
                        this.currentPairingCode = '';
                        this.hasEverConnected = true;
                        console.log('[Baileys] Connected successfully');

                        settleOk();
                        this.startKeepAlive();

                        setTimeout(async () => {
                            try {
                                await this.loadGroups();
                            } catch (err) {
                                console.error('[Baileys] Error loading groups:', err);
                            }
                        }, 3000);
                    }
                });

                this.setupMessageListener();
            } catch (error) {
                console.error('[Baileys] Error initializing:', error);
                settleErr(error);
            } finally {
                this.isConnecting = false;
            }
        });
    }

    public async restart(): Promise<void> {
        if (this.isRestarting_) return;
        this.isRestarting_ = true;
        this.isInitialized = false;
        this.groupsReady = false;
        this.cachedGroups = [];

        try {
            await this.destroy();
            console.log('[Baileys] Restarting...');
            await this.initialize();
            console.log('[Baileys] Restart completed');
        } catch (error) {
            console.error('[Baileys] Error restarting:', error);
            throw error;
        } finally {
            this.isRestarting_ = false;
        }
    }

    public async resetInstance(): Promise<void> {
        await this.destroy();
        try {
            fs.rmSync(this.authPath, { recursive: true, force: true });
            console.log('[Baileys] Auth state cleared');
        } catch (_) {}
        this.hasEverConnected = false;
        this.currentPairingCode = '';
        this.groupsReady = false;
        this.cachedGroups = [];
    }

    public async getGroups(): Promise<BaileysGroupInfo[] | string> {
        if (!this.isInitialized) {
            return 'Baileys client is not initialized';
        }
        if (!this.groupsReady) {
            return 'Groups are not ready yet, try again in a few seconds';
        }
        if (this.isRestarting_) {
            return 'WhatsApp client is restarting';
        }
        return this.cachedGroups;
    }

    public async sendTextToGroup(groupId: string, message: string): Promise<void> {
        return this.addToQueue(groupId, '', message, { type: 'text' });
    }

    public async sendMediaToGroup(
        groupId: string,
        mediaPath: string,
        caption?: string,
        mediaType: 'image' | 'video' | 'audio' | 'document' = 'image'
    ): Promise<void> {
        return this.addToQueue(groupId, mediaPath, caption || '', {
            type: 'media',
            caption,
            mediaType
        });
    }

    public async sendMessageToGroup(
        groupId: string,
        mediaPath: string,
        content: string,
        options?: {
            type?: 'text' | 'media';
            caption?: string;
            mediaType?: 'image' | 'video' | 'audio' | 'document';
        }
    ): Promise<void> {
        return this.addToQueue(groupId, mediaPath, content, options);
    }

    public async getClientInfo(): Promise<any> {
        if (!this.isInitialized || !this.sock) {
            throw new Error('Baileys client is not initialized');
        }
        return {
            engine: 'baileys',
            user: this.sock.user || null,
            phoneNumber: this.phoneNumber || this.sock.user?.id?.split(':')[0] || null
        };
    }

    public isReady(): boolean {
        return this.isInitialized && this.sock !== null;
    }

    public async takeScreenshot(): Promise<string> {
        return '';
    }

    public async destroy(): Promise<void> {
        this.shouldAttemptReconnect = false;
        this.isDestroying = true;
        this.isInitialized = false;
        this.isConnecting = false;

        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }

        if (this.pairingCodeTimer) {
            clearTimeout(this.pairingCodeTimer);
            this.pairingCodeTimer = null;
        }

        if (this.sock) {
            this.clearSocketEventListeners(this.sock);
            this.sock.end(undefined);
            this.sock = null;
        }

        this.isDestroying = false;
    }

    public onMessage(handler: (message: WhatsAppMessage) => void): void {
        this.messageHandlers.push(handler);
    }

    public removeMessageHandler(handler: (message: WhatsAppMessage) => void): void {
        const index = this.messageHandlers.indexOf(handler);
        if (index > -1) {
            this.messageHandlers.splice(index, 1);
        }
    }

    public startListeningToGroups(groupIds: string[]): void {
        groupIds.forEach(id => this.listeningGroups.add(id));
        console.log(`[Baileys] Now listening to ${this.listeningGroups.size} groups`);
    }

    public stopListeningToGroups(groupIds: string[]): void {
        groupIds.forEach(id => this.listeningGroups.delete(id));
        console.log(`[Baileys] Now listening to ${this.listeningGroups.size} groups`);
    }

    public getListeningGroups(): string[] {
        return Array.from(this.listeningGroups);
    }

    public getQueueStatus(): {
        queueSize: number;
        isProcessing: boolean;
        processingDelay: number;
    } {
        return {
            queueSize: this.messageQueue.length,
            isProcessing: this.isProcessingQueue,
            processingDelay: this.queueProcessingDelay
        };
    }

    public setQueueDelay(delayMs: number): void {
        this.queueProcessingDelay = Math.max(100, delayMs);
    }

    public startKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
        }

        this.keepAliveInterval = setInterval(async () => {
            if (!this.isInitialized && !this.isConnecting && !this.isDestroying) {
                console.log('[Baileys] Keep-alive: connection lost, reinitializing...');
                try {
                    await this.destroy();
                    await this.initialize();
                } catch (error) {
                    console.error('[Baileys] Keep-alive reinitialization error:', error);
                }
            }
        }, 2 * 60 * 1000);
    }

    public isCurrentlyRestarting(): boolean {
        return this.isRestarting_;
    }

    public getRestartAttempts(): number {
        return this.consecutiveReconnectFailures;
    }

    public resetRestartAttempts(): void {
        this.consecutiveReconnectFailures = 0;
    }

    private async loadGroups(): Promise<void> {
        if (!this.sock || !this.isInitialized) return;

        try {
            const groupsMetadata = await this.sock.groupFetchAllParticipating();
            this.cachedGroups = Object.values(groupsMetadata).map(group => ({
                id: { _serialized: group.id },
                name: group.subject || 'unknown',
                participants: group.participants || [],
                description: group.desc || null
            }));
            this.groupsReady = true;
            console.log(`[Baileys] Groups loaded: ${this.cachedGroups.length} groups`);
        } catch (error) {
            console.error('[Baileys] Error loading groups:', error);
        }
    }

    private setupMessageListener(): void {
        if (!this.sock) return;

        this.sock.ev.on('messages.upsert', async (messageUpdate) => {
            try {
                if (this.messageHandlers.length === 0 || this.listeningGroups.size === 0) return;

                const msg = messageUpdate?.messages?.[0];
                if (!msg || !msg.message) return;
                if (msg.key.fromMe) return;

                const jid = msg.key.remoteJid;
                if (!jid || jid === 'status@broadcast' || jid.includes('newsletter')) return;
                if (!jid.endsWith('@g.us')) return;
                if (!this.listeningGroups.has(jid)) return;

                const message = msg.message;
                const text = this.extractMessageText(msg);
                const hasMedia = !!(
                    message?.imageMessage ||
                    message?.videoMessage ||
                    message?.audioMessage ||
                    message?.documentMessage ||
                    message?.stickerMessage
                );

                const waMessage: WhatsAppMessage = {
                    id: msg.key.id || `${Date.now()}`,
                    text,
                    date: new Date(Number(msg.messageTimestamp) * 1000),
                    senderId: msg.key.participant || jid,
                    senderName: msg.pushName || undefined,
                    groupId: jid,
                    groupName: this.cachedGroups.find(g => g.id._serialized === jid)?.name || jid,
                    isForwarded: !!(message?.imageMessage?.contextInfo?.isForwarded ||
                        message?.extendedTextMessage?.contextInfo?.isForwarded ||
                        message?.videoMessage?.contextInfo?.isForwarded),
                    hasMedia,
                };

                if (hasMedia) {
                    try {
                        const buffer = await downloadMediaMessage(
                            msg,
                            'buffer',
                            {},
                            {
                                logger: pino({ level: 'silent' }),
                                reuploadRequest: this.sock!.updateMediaMessage
                            }
                        );

                        let mimetype = 'application/octet-stream';
                        let filename = 'file';
                        let mediaType: WhatsAppMessage['mediaType'] = 'document';

                        if (message?.imageMessage) {
                            mimetype = message.imageMessage.mimetype || 'image/jpeg';
                            filename = 'image.jpg';
                            mediaType = 'image';
                        } else if (message?.videoMessage) {
                            mimetype = message.videoMessage.mimetype || 'video/mp4';
                            filename = 'video.mp4';
                            mediaType = 'video';
                        } else if (message?.audioMessage) {
                            mimetype = message.audioMessage.mimetype || 'audio/ogg';
                            filename = 'audio.ogg';
                            mediaType = 'audio';
                        } else if (message?.stickerMessage) {
                            mimetype = message.stickerMessage.mimetype || 'image/webp';
                            filename = 'sticker.webp';
                            mediaType = 'sticker';
                        } else if (message?.documentMessage) {
                            mimetype = message.documentMessage.mimetype || 'application/octet-stream';
                            filename = message.documentMessage.fileName || 'document';
                            mediaType = 'document';
                        }

                        waMessage.mediaBuffer = buffer as Buffer;
                        waMessage.mediaMimeType = mimetype;
                        waMessage.mediaFileName = filename;
                        waMessage.mediaType = mediaType;
                    } catch (mediaError: any) {
                        console.error('[Baileys] Error downloading media:', mediaError?.message || mediaError);
                    }
                }

                for (const handler of this.messageHandlers) {
                    try {
                        handler(waMessage);
                    } catch (handlerError) {
                        console.error('[Baileys] Error in message handler:', handlerError);
                    }
                }
            } catch (error: any) {
                console.error('[Baileys] Error processing message:', error?.message || error);
            }
        });
    }

    private extractMessageText(msg: WAMessage): string {
        const message = msg.message;
        if (!message) return '';

        if (message.conversation) return message.conversation;
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
        if (message.imageMessage?.caption) return message.imageMessage.caption;
        if (message.videoMessage?.caption) return message.videoMessage.caption;
        if (message.documentMessage?.caption) return message.documentMessage.caption;
        return '';
    }

    private resolveJid(identifier: string): string {
        if (identifier.includes('@')) return identifier;

        const group = this.cachedGroups.find(
            g =>
                g.id._serialized === identifier ||
                g.name === identifier ||
                g.name?.toLowerCase().includes(identifier.toLowerCase())
        );
        if (group) return group.id._serialized;

        return `${identifier}@s.whatsapp.net`;
    }

    private async sendTextToGroupDirectly(groupId: string, message: string): Promise<void> {
        if (!this.sock || !this.isInitialized) {
            throw new Error('Baileys client is not initialized');
        }
        const jid = this.resolveJid(groupId);
        await this.sock.sendMessage(jid, { text: message });
        console.log(`[Baileys] Text message sent to: ${jid}`);
    }

    private async sendMediaToGroupDirectly(
        groupId: string,
        mediaPath: string,
        caption?: string,
        mediaType: 'image' | 'video' | 'audio' | 'document' = 'image'
    ): Promise<void> {
        if (!this.sock || !this.isInitialized) {
            throw new Error('Baileys client is not initialized');
        }

        const jid = this.resolveJid(groupId);
        let buffer: Buffer;
        let mimetype: string | undefined;
        let fileName = 'file';

        if (mediaPath.startsWith('data:')) {
            const match = mediaPath.match(/^data:([^;]+);base64,(.+)$/);
            if (!match) throw new Error('Invalid data URI for media');
            mimetype = match[1];
            buffer = Buffer.from(match[2], 'base64');
        } else {
            buffer = fs.readFileSync(mediaPath);
            fileName = path.basename(mediaPath);
        }

        switch (mediaType) {
            case 'image':
                await this.sock.sendMessage(jid, {
                    image: buffer,
                    caption: caption || undefined,
                    mimetype: mimetype as any
                });
                break;
            case 'video':
                await this.sock.sendMessage(jid, {
                    video: buffer,
                    caption: caption || undefined,
                    mimetype: mimetype as any
                });
                break;
            case 'audio':
                await this.sock.sendMessage(jid, {
                    audio: buffer,
                    mimetype: mimetype as any
                });
                break;
            case 'document':
                await this.sock.sendMessage(jid, {
                    document: buffer,
                    mimetype: (mimetype as any) || 'application/octet-stream',
                    fileName,
                    caption: caption || undefined
                });
                break;
        }
        console.log(`[Baileys] Media (${mediaType}) sent to: ${jid}`);
    }

    private startQueueProcessor(): void {
        setInterval(() => {
            void this.processQueue();
        }, 100);
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;
        if (!this.isInitialized || this.isRestarting_) return;

        this.isProcessingQueue = true;
        try {
            const queueItem = this.messageQueue.shift();
            if (!queueItem) return;

            try {
                const { type = 'text', caption, mediaType = 'image' } = queueItem.options || {};
                if (type === 'media') {
                    await this.sendMediaToGroupDirectly(queueItem.groupId, queueItem.mediaPath, caption, mediaType);
                } else {
                    await this.sendTextToGroupDirectly(queueItem.groupId, queueItem.content);
                }
                queueItem.resolve();
            } catch (error) {
                queueItem.reject(error);
            } finally {
                if (queueItem.mediaPath && !queueItem.mediaPath.startsWith('data:') && fs.existsSync(queueItem.mediaPath)) {
                    try { fs.unlinkSync(queueItem.mediaPath); } catch (_) {}
                }
            }

            await new Promise(resolve => setTimeout(resolve, this.queueProcessingDelay));
        } finally {
            this.isProcessingQueue = false;
        }
    }

    private addToQueue(
        groupId: string,
        mediaPath: string,
        content: string,
        options?: {
            type?: 'text' | 'media';
            caption?: string;
            mediaType?: 'image' | 'video' | 'audio' | 'document';
        }
    ): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('Baileys client is not initialized');
        }
        if (this.messageQueue.length >= this.maxQueueSize) {
            console.error(`Queue size limit (${this.maxQueueSize}) reached. Exiting process.`);
            process.exit(-1);
        }
        return new Promise((resolve, reject) => {
            this.messageQueue.push({
                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                groupId,
                mediaPath,
                content,
                options,
                timestamp: Date.now(),
                resolve,
                reject
            });
        });
    }

    private clearSocketEventListeners(sock: WASocket | null): void {
        if (!sock) return;
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('creds.update');
        sock.ev.removeAllListeners('messages.upsert');
    }
}

export default BaileysWhatsAppInstance;
