import { Client, LocalAuth, MessageMedia, GroupChat, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

export interface WhatsAppMessage {
    id: string;
    text: string;
    date: Date;
    senderId?: string;
    senderName?: string;
    groupId: string;
    groupName: string;
    isForwarded: boolean;
    mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    hasMedia: boolean;
    mediaBuffer?: Buffer;
    mediaFileName?: string;
    mediaMimeType?: string;
}

// Interface for queue items
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

export class WhatsAppInstance {
    private client: Client;
    private groupsReady: boolean = false;
    private cachedGroups: GroupChat[] = [];
    private isInitialized: boolean = false;
    private currentQrCode: string = '';
    private qrCodeCallback?: (qr: string) => void;
    private isRestarting: boolean = false;
    private maxRestartAttempts: number = 3;
    private restartAttempts: number = 0;
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    
    // Message queue properties
    private messageQueue: QueueItem[] = [];
    private isProcessingQueue: boolean = false;
    private queueProcessingDelay: number = 1000; // 1 second delay between messages
    private maxQueueSize: number = 100; // Maximum queue size before exit

    // Incoming message handling (WA → TG forwarding)
    private listeningGroups: Set<string> = new Set();
    private messageHandlers: ((message: WhatsAppMessage) => void)[] = [];

    constructor() {
        // Clean up any existing singleton locks before creating client
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: "telegram-forwarder"
            }),
            puppeteer: {
                //use the chrome depende on the os
                executablePath: process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : process.platform === 'linux' ? '/usr/bin/google-chrome' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-software-rasterizer",
                    '--max-old-space-size=4096',
                    '--no-sandbox',
                  ],
            }
        });

        this.startQueueProcessor();
    }

    /**
     * Clean up singleton lock file that might be left from previous runs
     */
    private cleanupSingletonLock(): void {
        try {
            const lockPath = path.join(process.cwd(), '.wwebjs_auth', 'session-telegram-forwarder', 'SingletonLock');
            if (fs.existsSync(lockPath)) {
                fs.unlinkSync(lockPath);
                console.log('Cleaned up existing WhatsApp singleton lock');
            }
        } catch (error) {
            console.log('Could not clean up singleton lock (this is usually fine):', error);
        }
    }

    /**
     * Check if error requires client restart
     * @param error Error object or string
     * @returns boolean indicating if restart is needed
     */
    private shouldRestartClient(error: any): boolean {
        const errorMessage = error?.message || error?.toString() || '';
        if (!this.isInitialized || this.isRestarting) return false
        console.log('checking err mess:',errorMessage);
        
        
        // List of error patterns that require restart
        const restartTriggers = [
            'Protocol error (Runtime.callFunctionOn): Session closed',
            'Session closed. Most likely the page has been closed',
            'Target closed',
            'Page crashed',
            'Navigation timeout',
            'Protocol error',
            'WebSocket connection closed',
            'Browser has been closed'
        ];

        return restartTriggers.some(trigger => errorMessage.includes(trigger));
    }

    /**
     * Handle errors with automatic restart if needed
     * @param error The error that occurred
     * @param context Context where the error occurred
     * @param shouldRestart Whether to attempt restart for this error
     */
    private async handleError(error: any, context: string, shouldRestart: boolean = true): Promise<void> {
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        console.error(`WhatsApp ${context} error:`, errorMessage);

        if (shouldRestart && this.shouldRestartClient(error) && !this.isRestarting) {
            console.log(`Detected session error in ${context}, attempting to restart client...`);
            await this.attemptRestart();
        }
    }

    /**
     * Attempt to restart client with retry logic
     */
    private async attemptRestart(): Promise<void> {
        if (this.isRestarting) {
            console.log('Restart already in progress, skipping...');
            return;
        }

        this.restartAttempts++;

        try {
            if (this.restartAttempts > this.maxRestartAttempts) {
                console.error(`Max restart attempts (${this.maxRestartAttempts}) reached. Manual intervention required.`);
                return;
            }

            console.log(`Restart attempt ${this.restartAttempts}/${this.maxRestartAttempts}`);
            await this.restart();
            
            // Reset restart attempts on successful restart
            this.restartAttempts = 0;
        } catch (restartError) {
            console.error('Failed to restart client:', restartError);
            
            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    /**
     * Initialize the WhatsApp client
     * @param qrCallback Optional callback to handle QR code display
     */
    public async initialize(qrCallback?: (qr: string) => void): Promise<void> {
        try {
            this.qrCodeCallback = qrCallback;
            this.currentQrCode = '';

            console.log('Initializing WhatsApp client...');
            await this.client.initialize();

            this.setupEventHandlers();

            return new Promise((resolve, reject) => {
                this.client.once('qr', (qr) => {
                    console.log('WhatsApp needs scan');
                    this.currentQrCode = qr;
                    resolve();
                });

                this.client.once('ready', () => {
                    this.isInitialized = true;
                    this.currentQrCode = '';
                    console.log('WhatsApp client is ready!');
                    void this.loadGroupsAfterReady().catch((error) => {
                        console.error('Error loading groups after ready:', error);
                    });
                    this.startKeepAlive();
                    resolve();
                });

                this.client.once('auth_failure', (msg) => {
                    console.error('Authentication failed:', msg);
                    reject(new Error(`Authentication failed: ${msg}`));
                });

                setTimeout(() => {
                    if (!this.isInitialized && !this.currentQrCode) {
                        reject(new Error('WhatsApp client initialization timeout'));
                    }
                }, 1000 * 60 * 2);
            });
        } catch (error) {
            console.error('Error initializing WhatsApp client:', error);
            throw error;
        }
    }

    /**
     * Get current QR code
     * @returns Current QR code string or empty string if not available
     */
    public getCurrentQrCode(): string {
        return this.currentQrCode;
    }

    public getEngineType(): 'wwebjs' | 'baileys' {
        return 'wwebjs';
    }

    public getPairingInfo(): { type: 'qr'; data: string } | { type: 'code'; data: string } | null {
        if (this.currentQrCode) {
            return { type: 'qr', data: this.currentQrCode };
        }
        return null;
    }

    public async pairWithPhone(_phone: string): Promise<string> {
        throw new Error('Pairing code is only supported with the Baileys engine (set WHATSAPP_ENGINE=baileys)');
    }

    /**
     * Restart the WhatsApp client
     */
    public async restart(): Promise<void> {
        if (this.isRestarting) return;
        this.isInitialized = false;
        this.groupsReady = false;
        this.cachedGroups = [];
        this.isRestarting = true;
        try {
            await this.client.destroy();
        } catch (e) {
            console.error('Error destroying WhatsApp client:', e);
        }
        try {
            console.log('Restarting WhatsApp client...');
            this.client = new Client({
                authStrategy: new LocalAuth({
                    clientId: "telegram-forwarder"
                }),
                puppeteer: {
                    executablePath: process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : process.platform === 'linux' ? '/usr/bin/google-chrome' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-software-rasterizer",
                        '--max-old-space-size=4096',
                        '--no-sandbox',
                    ],
                }
            });
            await this.initialize();
            console.log('WhatsApp client restarted successfully');
        } catch (error) {
            console.error('Error restarting WhatsApp client:', error);
            throw error;
        } finally {
            this.isRestarting = false;
        }
    }

    /**
     * Load and cache groups immediately after the client is ready.
     * If getChats() fails, falls back to a light store read (id + name only)
     * that skips the broken GroupMetadata.update path.
     */
    private async loadGroupsAfterReady(): Promise<void> {
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const chats = await this.client.getChats();
                this.cachedGroups = chats.filter(chat => chat.isGroup) as GroupChat[];
                this.groupsReady = true;
                console.log(`WhatsApp groups are ready! Cached ${this.cachedGroups.length} groups`);
                return;
            } catch (error: any) {
                console.warn(`[WhatsApp] getChats failed (${attempt}/${maxAttempts}): ${error?.message || error}`);
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        // Fallback: light store read via pupPage — pulls id + name without GroupMetadata.update
        try {
            const pupPage = this.client.pupPage;
            if (!pupPage) throw new Error('pupPage not available');

            const groups: { id: string; name: string }[] = await pupPage.evaluate(() => {
                const g = globalThis as any;
                const store = g.Store || g.window?.Store;
                if (!store?.Chat) return [];
                return store.Chat.getModelsArray()
                    .filter((c: any) => c.isGroup)
                    .map((c: any) => ({
                        id: c.id?._serialized || c.id?.toString() || '',
                        name: c.name || c.formattedTitle || '',
                    }))
                    .filter((g: any) => g.id);
            });

            if (groups.length > 0) {
                this.cachedGroups = groups as any;
                this.groupsReady = true;
                console.log(`[WhatsApp] Light store fetch: cached ${groups.length} groups`);
                return;
            }
        } catch (storeErr: any) {
            console.warn(`[WhatsApp] Light store fallback failed: ${storeErr?.message || storeErr}`);
        }

        console.warn('[WhatsApp] Could not load groups — will retry on next getGroups() call');
    }

    /**
     * Destroy client with timeout to prevent hanging
     * @param timeoutMs Timeout in milliseconds
     */
    private async destroyWithTimeout(timeoutMs: number = 10000): Promise<void> {
        return new Promise(async (resolve, reject) => {
            let isResolved = false;
            
            // Set up timeout
            const timeoutId = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    console.warn(`Client destroy timed out after ${timeoutMs}ms, forcing cleanup...`);
                    this.forceCleanup();
                    resolve();
                }
            }, timeoutMs);

            try {
                // Attempt graceful destroy
                await this.client.destroy();
                
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timeoutId);
                    console.log('Client destroyed gracefully');
                    resolve();
                }
            } catch (error) {
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timeoutId);
                    console.warn('Error during client destroy, attempting force cleanup:', error);
                    this.forceCleanup();
                    resolve(); // Don't reject, just continue with force cleanup
                }
            }
        });
    }

    /**
     * Force cleanup when graceful destroy fails
     */
    private forceCleanup(): void {
        try {
            // Try to access the puppeteer page and close it forcefully
            const pupPage = (this.client as Client).pupPage;
            if (pupPage && !pupPage.isClosed()) {
                pupPage.close().catch(() => {
                    console.log('Could not close puppeteer page gracefully');
                });
            }

            // Try to access the browser instance and close it
            const browser = (this.client as Client).pupBrowser;
            if (browser) {
                browser.close().catch(() => {
                    console.log('Could not close browser gracefully');
                });
            }

            // Clean up singleton lock
            this.cleanupSingletonLock();
            
            console.log('Force cleanup completed');
        } catch (error) {
            console.log('Error during force cleanup (this is usually fine):', error);
        }
    }

    /**
     * Reset WhatsApp instance by deleting auth/cache directories and restarting
     */
    public async resetInstance(): Promise<void> {
        try {
            console.log('Resetting WhatsApp instance...');
            this.isRestarting = true;
            
            // First destroy the current client if it exists
            if (this.isInitialized) {
                await this.destroyWithTimeout(10000); // Use timeout here too
                this.isInitialized = false;
                this.groupsReady = false;
                this.cachedGroups = [];
            }

            // Delete .wwebjs_auth and .wwebjs_cache directories
            const authDir = path.join(process.cwd(), '.wwebjs_auth');
            const cacheDir = path.join(process.cwd(), '.wwebjs_cache');

            // Remove auth directory
            if (fs.existsSync(authDir)) {
                console.log('Removing .wwebjs_auth directory...');
                fs.rmSync(authDir, { recursive: true, force: true });
                console.log('Auth directory removed successfully');
            }

            // Remove cache directory
            if (fs.existsSync(cacheDir)) {
                console.log('Removing .wwebjs_cache directory...');
                fs.rmSync(cacheDir, { recursive: true, force: true });
                console.log('Cache directory removed successfully');
            }

            // Create new client instance
            this.client = new Client({
                authStrategy: new LocalAuth({
                    clientId: "telegram-forwarder"
                }),
                puppeteer: {
                    executablePath: process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : process.platform === 'linux' ? '/usr/bin/google-chrome' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-software-rasterizer",
                        '--max-old-space-size=4096',
                        '--no-sandbox',
                    ],
                }
            });

            // Initialize the new client
            await this.initialize();
            
            console.log('WhatsApp instance reset successfully');
        } catch (error) {
            console.error('Error resetting WhatsApp instance:', error);
            throw error;
        }finally{
            this.isRestarting = false
        }
    }

    /**
     * Get all groups that the bot is part of
     * @returns Array of group chats
     */
    public async getGroups(): Promise<GroupChat[] | string> {
        try {
            if (!this.isInitialized) {
                throw new Error('WhatsApp client is not initialized');
            }
            if (!this.groupsReady) {
                return 'WhatsApp groups are not ready yet try again in few seconds or minutes';
            }

            if (this.isRestarting) {
                return 'WhatsApp client is restarting';
            }

            return this.cachedGroups;
        } catch (error) {
            console.error('Error getting groups:', error);
            await this.handleError(error, 'getGroups');
            throw error;
        }
    }

    /**
     * Send a text message to a group (queued version)
     * @param groupId Group ID (can be group name or ID)
     * @param message Text message to send
     */
    public async sendTextToGroup(groupId: string, message: string): Promise<void> {
        return this.addToQueue(groupId, '', message, { type: 'text' });
    }

    /**
     * Send a text message to a group directly (used internally by queue)
     * @param groupId Group ID (can be group name or ID)
     * @param message Text message to send
     */
    private async sendTextToGroupDirectly(groupId: string, message: string): Promise<void> {
        try {
            if (!this.isInitialized) {
                throw new Error('WhatsApp client is not initialized');
            }

            if (this.isRestarting) {
                console.error('WhatsApp client is restarting');
                return;
            }

            const group = await this.findGroup(groupId);
            if (!group) {
                throw new Error(`Group not found: ${groupId}`);
            }

            await this.client.sendMessage(group.id._serialized, message);
            console.log(`[WhatsApp] Text message sent to group: ${group.name}`);
        } catch (error) {
            console.error('Error sending text message to group:', error);
            await this.handleError(error, 'sendTextToGroup');
            throw error;
        }
    }

    /**
     * Send a media message to a group (queued version)
     * @param groupId Group ID (can be group name or ID)
     * @param mediaPath Path to the media file or base64 data
     * @param caption Optional caption for the media
     * @param mediaType Type of media (image, video, audio, document)
     */
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

    /**
     * Send a media message to a group directly (used internally by queue)
     * @param groupId Group ID (can be group name or ID)
     * @param mediaPath Path to the media file or base64 data
     * @param caption Optional caption for the media
     * @param mediaType Type of media (image, video, audio, document)
     */
    private async sendMediaToGroupDirectly(
        groupId: string, 
        mediaPath: string, 
        caption?: string,
        mediaType: 'image' | 'video' | 'audio' | 'document' = 'image'
    ): Promise<void> {
        try {
            if (!this.isInitialized) {
                throw new Error('WhatsApp client is not initialized');
            }

            if (this.isRestarting) {
                console.error('WhatsApp client is restarting');
                return;
            }

            const group = await this.findGroup(groupId);
            if (!group) {
                throw new Error(`Group not found: ${groupId}`);
            }

            let media: MessageMedia;
            
            // Check if it's a file path or base64 data
            if (mediaPath.startsWith('data:')) {
                // Base64 data
                media = new MessageMedia(mediaPath.split(',')[0], mediaPath.split(',')[1]);
            } else {
                // File path
                media = MessageMedia.fromFilePath(mediaPath);
            }

            await this.client.sendMessage(group.id._serialized, media, { caption });
            console.log(`[WhatsApp] Media message sent to group: ${group.name}`);
        } catch (error) {
            console.error('Error sending media message to group:', error);
            await this.handleError(error, 'sendMediaToGroup');
            throw error;
        }
    }

    /**
     * Send message to group (unified method for both text and media) - queued version
     * @param groupId Group ID or name
     * @param content Message content (text or media path)
     * @param options Additional options
     */
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

    /**
     * Find a group by ID or name
     * @param identifier Group ID or name
     * @returns Group chat or null if not found
     */
    private async findGroup(identifier: string): Promise<GroupChat | null> {
        try {
            if (this.isRestarting) {
                console.error('WhatsApp client is restarting');
                return null;
            }

            const groups = await this.getGroups();

            if (typeof groups === 'string') {
                return null;
            }
            // First try to find by exact ID
            let group = groups.find(g => g.id._serialized === identifier);
            
            // If not found, try to find by name
            if (!group) {
                group = groups.find(g => g.name === identifier);
            }
            
            // If still not found, try partial name match
            if (!group) {
                group = groups.find(g => g.name?.toLowerCase().includes(identifier.toLowerCase()));
            }
            
            return group || null;
        } catch (error) {
            console.error('Error finding group:', error);
            await this.handleError(error, 'findGroup');
            return null;
        }
    }

    /**
     * Get client info
     */
    public async getClientInfo(): Promise<any> {
        try {
            if (!this.isInitialized) {
                throw new Error('WhatsApp client is not initialized');
            }

            if (this.isRestarting) {
                console.error('WhatsApp client is restarting');
                return null;
            }
            
            return await this.client.getState();
        } catch (error) {
            console.error('Error getting client info:', error);
            await this.handleError(error, 'getClientInfo');
            throw error;
        }
    }

    /**
     * Destroy the client
     */
    public async destroy(): Promise<void> {
        try {
            await this.destroyWithTimeout(1000 * 5); // Use timeout for regular destroy too
            this.isInitialized = false;
            
            console.log('WhatsApp client destroyed');
        } catch (error) {
            console.error('Error destroying client:', error);
            
            // Try force cleanup even if destroy failed
            this.forceCleanup();
            
            throw error;
        }
    }

    /**
     * Check if client is ready
     */
    public isReady(): boolean {
        return this.isInitialized;
    }


    public async takeScreenshot(): Promise<string> {
        try {
            const pupPage = this.client.pupPage;
            if (!pupPage) {
                console.log('Puppeteer page not available for screenshot');
                return '';
            }

            // Set a larger viewport to capture more content
            await pupPage.setViewport({
                width: 1920,
                height: 1080,
                deviceScaleFactor: 1,
            });

            // Wait a moment for the page to adjust to the new viewport
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Take a full page screenshot (removed quality option for PNG)
            const screenshot = await pupPage.screenshot({ 
                encoding: 'base64',
                fullPage: true,  // This captures the entire page, not just the viewport
                type: 'png'
                // Note: quality option is only supported for JPEG, not PNG
            });

            return `data:image/png;base64,${screenshot}`;
        } catch (error) {
            console.error('Error taking screenshot');
            await this.handleError(error, 'takeScreenshot');
            return '';
        }
    }

    /**
     * Setup event handlers for the WhatsApp client
     */
    private setupEventHandlers(): void {
        this.client.on('authenticated', () => {
            console.log('WhatsApp authenticated successfully');
            this.currentQrCode = ''; // Clear QR code when authenticated
        });

        this.client.on('ready', () => {
            this.currentQrCode = ''; // Clear QR code when ready
            // Chats are loaded only from initialize()'s ready handler via loadGroupsAfterReady()
        });

        this.client.on('disconnected', (reason) => {
            console.log('WhatsApp client disconnected:', reason);
            this.isInitialized = false;
            this.groupsReady = false;
            this.cachedGroups = [];
            
            // Handle disconnection with potential restart
            this.handleError(new Error(`Client disconnected: ${reason}`), 'disconnected event');
        });

        this.client.on('auth_failure', (message) => {
            console.error('Authentication failure:', message);
            this.isInitialized = false;
            this.groupsReady = false;
            this.cachedGroups = [];
        });

        // Add error event handler
        this.client.on('error', (error) => {
            console.error('WhatsApp client error:', error);
            this.handleError(error, 'client error event');
        });

        // Add change_state event handler for additional monitoring
        this.client.on('change_state', (state) => {
            console.log('[WhatsApp] client state changed:', state);
            if (state === 'CONFLICT' || state === 'UNPAIRED') {
                this.isInitialized = false;
                this.groupsReady = false;
                this.cachedGroups = [];
            }
        });

        // Incoming message handler for WA → TG forwarding
        this.client.on('message', async (msg: Message) => {
            try {
                if (this.messageHandlers.length === 0 || this.listeningGroups.size === 0) return;

                const chat = await msg.getChat();
                if (!chat.isGroup) return;

                const groupId = chat.id._serialized;
                if (!this.listeningGroups.has(groupId)) return;

                const contact = await msg.getContact();
                const senderName = contact.pushname || contact.name || contact.number;

                const waMessage: WhatsAppMessage = {
                    id: msg.id._serialized,
                    text: msg.body || '',
                    date: new Date(msg.timestamp * 1000),
                    senderId: msg.author || msg.from,
                    senderName,
                    groupId,
                    groupName: chat.name,
                    isForwarded: msg.isForwarded,
                    hasMedia: msg.hasMedia,
                };

                if (msg.hasMedia) {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            waMessage.mediaBuffer = Buffer.from(media.data, 'base64');
                            waMessage.mediaMimeType = media.mimetype;
                            waMessage.mediaFileName = media.filename || `media_${msg.id.id}`;

                            if (media.mimetype.startsWith('image/')) {
                                waMessage.mediaType = 'image';
                            } else if (media.mimetype.startsWith('video/')) {
                                waMessage.mediaType = 'video';
                            } else if (media.mimetype.startsWith('audio/')) {
                                waMessage.mediaType = 'audio';
                            } else {
                                waMessage.mediaType = 'document';
                            }

                            if (!waMessage.mediaFileName.includes('.')) {
                                const ext = media.mimetype.split('/')[1]?.split(';')[0];
                                if (ext) waMessage.mediaFileName += `.${ext}`;
                            }
                        }
                    } catch (mediaError) {
                        console.error('Error downloading WhatsApp media:', mediaError);
                    }
                }

                for (const handler of this.messageHandlers) {
                    try {
                        handler(waMessage);
                    } catch (handlerError) {
                        console.error('Error in WhatsApp message handler:', handlerError);
                    }
                }
            } catch (error) {
                console.error('Error processing incoming WhatsApp message:', error);
            }
        });
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
        console.log(`[WhatsApp] Now listening to ${this.listeningGroups.size} groups`);
    }

    public stopListeningToGroups(groupIds: string[]): void {
        groupIds.forEach(id => this.listeningGroups.delete(id));
        console.log(`[WhatsApp] Now listening to ${this.listeningGroups.size} groups`);
    }

    public getListeningGroups(): string[] {
        return Array.from(this.listeningGroups);
    }

    /**
     * Start the queue processor
     */
    private startQueueProcessor(): void {
        setInterval(() => {
            this.processQueue();
        }, 100); // Check queue every 100ms
    }

    /**
     * Process the message queue
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.messageQueue.length === 0) {
            return;
        }

        if (!this.isInitialized || this.isRestarting) {
            return;
        }

        this.isProcessingQueue = true;

        try {
            const queueItem = this.messageQueue.shift();
            if (!queueItem) {
                this.isProcessingQueue = false;
                return;
            }

            console.log(`[Queue] Processing message ${queueItem.id} for group ${queueItem.groupId}`);

            try {
                await this.sendMessageDirectly(queueItem.groupId, queueItem.mediaPath, queueItem.content, queueItem.options);
                queueItem.resolve();
                if (queueItem.mediaPath) {
                    fs.unlinkSync(queueItem.mediaPath);
                }
                console.log(`[Queue] Message ${queueItem.id} sent successfully`);
            } catch (error) {
                console.error(`[Queue] Failed to send message ${queueItem.id}:`, error);
                queueItem.reject(error);
            }

            // Wait before processing next message
            await new Promise(resolve => setTimeout(resolve, this.queueProcessingDelay));

        } catch (error) {
            console.error('[Queue] Error processing queue:', error);
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /**
     * Add message to queue
     */
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
        if(!this.isInitialized){
            throw new Error('WhatsApp client is not initialized');
        }
        if (this.messageQueue.length >= this.maxQueueSize) {
            console.error(`Queue size limit (${this.maxQueueSize}) reached. Exiting process.`);
            process.exit(-1);
        }
        return new Promise((resolve, reject) => {
            const queueItem: QueueItem = {
                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                groupId,
                mediaPath,
                content,
                options,
                timestamp: Date.now(),
                resolve,
                reject
            };

            this.messageQueue.push(queueItem);
            console.log(`[Queue] Added message ${queueItem.id} to queue. Queue size: ${this.messageQueue.length}`);
        });
    }

    /**
     * Send message directly (used by queue processor)
     */
    private async sendMessageDirectly(
        groupId: string, 
        mediaPath: string,
        content: string, 
        options?: {
            type?: 'text' | 'media';
            caption?: string;
            mediaType?: 'image' | 'video' | 'audio' | 'document';
        }
    ): Promise<void> {
        const { type = 'text', caption, mediaType = 'image' } = options || {};
        
        if (type === 'media') {
            await this.sendMediaToGroupDirectly(groupId, mediaPath, caption, mediaType);
        } else {
            await this.sendTextToGroupDirectly(groupId, content);
        }
    }

    /**
     * Get queue status information
     */
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

    /**
     * Set queue processing delay
     * @param delayMs Delay in milliseconds between messages
     */
    public setQueueDelay(delayMs: number): void {
        this.queueProcessingDelay = Math.max(100, delayMs); // Minimum 100ms delay
        console.log(`[Queue] Processing delay set to ${this.queueProcessingDelay}ms`);
    }

    private async keepAlive(): Promise<void> {
        if (this.isRestarting) return;
        if (this.client?.info) {
            this.client.getState().then((state) => {
                console.log('Connection kept alive:', state);
            }).catch((err) => {
                console.error('Error keeping connection alive:', err);
                this.restart();
            });
        } else {
            console.log('undefined client, restarting');
            this.restart();
        }
    }

    public startKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
        }
        this.keepAliveInterval = setInterval(this.keepAlive.bind(this), 20 * 60 * 1000);
    }

    /**
     * Check if client is currently restarting
     */
    public isCurrentlyRestarting(): boolean {
        return this.isRestarting;
    }

    /**
     * Get restart attempts count
     */
    public getRestartAttempts(): number {
        return this.restartAttempts;
    }

    /**
     * Reset restart attempts counter
     */
    public resetRestartAttempts(): void {
        this.restartAttempts = 0;
    }
}

// Export default instance
export default WhatsAppInstance;
