import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { Api } from 'telegram/tl';
import { helpers } from 'telegram';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { configManager } from './configManager';
import { getActiveListeningConfigs } from './db';
// Load environment variables
dotenv.config();

export interface TelegramChannel {
    id: string;
    title: string;
    username?: string;
    participantsCount?: number;
    isChannel: boolean;
    isGroup: boolean;
    isMegagroup: boolean;
}

export interface TelegramMessage {
    id: number;
    text: string;
    date: Date;
    senderId?: string;
    senderName?: string;
    channelId: string;
    channelTitle: string;
    isForwarded: boolean;
    forwardedFrom?: string;
    mediaType?: 'photo' | 'video' | 'document' | 'audio' | 'sticker';
    hasMedia: boolean;
    // Add these new properties for media handling
    mediaBuffer?: Buffer;
    mediaFileName?: string;
    mediaMimeType?: string;
    mediaSkippedReason?: 'size_limit' | 'download_failed';
}

export class TelegramInstance {
    private client!: TelegramClient; // Add ! to indicate it will be assigned
    private isInitialized: boolean = false;
    private sessionString: string = '';
    private sessionFilePath: string;
    private listeningChannels: Set<string> = new Set();
    private messageHandlers: ((message: TelegramMessage) => void)[] = [];
    // Authentication state management
    private isAuthenticating: boolean = false;
    private phoneCodeResolver: ((code: string) => void) | null = null;
    private passwordResolver: ((password: string) => void) | null = null;
    // Add this property to store event handler reference
    private currentEventHandler: any = null;
    
    // Add keep-alive properties
    private keepAliveInterval: NodeJS.Timeout | null = null;
    private connectionCheckInterval: NodeJS.Timeout | null = null;
    private isKeepAliveActive: boolean = false;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;

    constructor() {
        this.sessionFilePath = path.join(process.cwd(), 'telegram_session.txt');
        
        // Load existing session if available
        this.loadSession();
        
        // Try to restart with existing session first
        const restartedWithSession = this.restart();
        
        // Only continue with constructor setup if restart didn't work with session
        if (!restartedWithSession) {
            // Load listening channels from config
            this.loadListeningChannelsFromConfig();
            
            const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
            const apiHash = process.env.TELEGRAM_API_HASH || '';
            
            if (!apiId || !apiHash) {
                throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in environment variables');
            }

            this.client = new TelegramClient(
                new StringSession(this.sessionString),
                apiId,
                apiHash,
                {
                    connectionRetries: 5,
                    useWSS: true,
                }
            );

            this.setupEventHandlers();
        }
    }

    /**
     * Load listening channels from config
     */
    private loadListeningChannelsFromConfig(): void {
        const configChannels = configManager.getTelegramChannelIds();
        this.listeningChannels = new Set(configChannels);
        if (configChannels.length > 0) {
            // console.log(`Loaded ${configChannels.length} listening channels from config:`, configChannels);
        }
    }

    /**
     * Save listening channels to config
     */
    private async saveListeningChannelsToConfig(): Promise<void> {
        try {
            const channelArray = Array.from(this.listeningChannels);
            await configManager.setTelegramChannelIds(channelArray);
            
            console.log(`Saved ${channelArray.length} listening channels to config`);
        } catch (error) {
            console.error('Error saving listening channels to config:', error);
        }
    }

    /**
     * Initialize the Telegram client
     * @param phoneNumber Phone number for authentication (if not already authenticated)
     */
    public async initialize(phoneNumber: string): Promise<void> {
        try {
            console.log('Initializing Telegram client with phone number:', phoneNumber);
            if(!this.client){
                const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
                const apiHash = process.env.TELEGRAM_API_HASH || '';
                if (!apiId || !apiHash) {
                    throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in environment variables');
                }
                this.client = new TelegramClient(
                    new StringSession(this.sessionString),
                    apiId,
                    apiHash,
                    {
                        connectionRetries: 5,
                        useWSS: true,
                    }
                );
                this.setupEventHandlers();
            }
            
            this.isAuthenticating = true;
            
            await this.client.start({
                phoneNumber: async () => phoneNumber,
                password: async () => await this.promptPassword(),
                phoneCode: async () => await this.promptPhoneCode(),
                onError: (err) => console.error('Telegram auth error:', err),
            });

            this.isInitialized = true;
            this.isAuthenticating = false;
            
            // Save session
            this.sessionString = this.client.session.save() as unknown as string;
            this.saveSession();
            
            console.log('Telegram client is ready!');
            console.log('Logged in as:', (await this.client.getMe()).firstName);
            
            // Auto-start listening to configured channels
            if (this.listeningChannels.size > 0) {
                console.log(`Auto-starting listening to ${this.listeningChannels.size} configured channels`);
                // Start keep-alive if there are forwarding rules
                if (this.hasActiveForwardingRules()) {
                    this.startKeepAlive();
                }
            }
        } catch (error) {
            console.error('Error initializing Telegram client:', error);
            throw error;
        }
    }

    /**
     * Restart the Telegram client
     * @returns boolean - true if successfully restarted with session, false if needs manual setup
     */
    public async restart(): Promise<boolean> {
        try {
            // Only restart if we have a valid session
            if (!this.sessionString) {
                console.log('No session available for restart');
                return false;
            }

            console.log('Restarting Telegram client...');
            
            // Stop keep-alive during restart
            const wasKeepAliveActive = this.isKeepAliveActive;
            this.stopKeepAlive();

            if (this.isInitialized) {
                try {
                    await this.client.disconnect();
                } catch (error: any) {
                    console.log('Error disconnecting during restart (expected):', error.message);
                }
                this.isInitialized = false;
            }

            // Reset authentication state
            this.isAuthenticating = false;
            this.phoneCodeResolver = null;
            this.passwordResolver = null;

            // Create new client instance with existing session
            const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
            const apiHash = process.env.TELEGRAM_API_HASH || '';
            
            this.client = new TelegramClient(
                new StringSession(this.sessionString),
                apiId,
                apiHash,
                {
                    connectionRetries: 5,
                    useWSS: true,
                }
            );
            
            this.loadListeningChannelsFromConfig();
            this.setupEventHandlers();
            
            // Connect using the existing session with timeout
            console.log('Connecting with saved session...');
            await Promise.race([
                this.client.connect(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout')), 30000)
                )
            ]);
            
            this.isInitialized = true;
            
            // Restart keep-alive if it was active
            if (wasKeepAliveActive && this.hasActiveForwardingRules()) {
                this.startKeepAlive();
            }
            
            console.log('Telegram client restarted successfully with session');
            return true;
        } catch (error) {
            console.error('Error restarting Telegram client:', error);
            this.isInitialized = false;
            return false;
        }
    }

    /**
     * Reset Telegram client by deleting session and disconnecting
     */
    public async reset(): Promise<void> {
        try {
            console.log('Resetting Telegram client...');
            
            // Stop keep-alive first
            this.stopKeepAlive();
            
            // Disconnect if connected
            if (this.isInitialized) {
                await this.client.disconnect();
                this.isInitialized = false;
            }

            // Clear session data
            this.sessionString = '';
            
            // Delete session file if it exists
            if (fs.existsSync(this.sessionFilePath)) {
                fs.unlinkSync(this.sessionFilePath);
                console.log('Session file deleted');
            }

            // Reset authentication state
            this.isAuthenticating = false;
            this.phoneCodeResolver = null;
            this.passwordResolver = null;

            // Clear listening channels
            this.listeningChannels.clear();
            
            // Clear message handlers
            this.messageHandlers = [];

            console.log('Telegram client reset successfully');
        } catch (error) {
            console.error('Error resetting Telegram client:', error);
            throw error;
        }
    }

    /**
     * Get all channels and groups the user is part of
     * @returns Array of channels/groups
     */
    public async getChannelsAndGroups(): Promise<TelegramChannel[]> {
        try {
            if (!this.isInitialized) {
                throw new Error('Telegram client is not initialized');
            }

            // console.log('Fetching channels and groups...');
            const dialogs = await this.client.getDialogs({});
            const channels: TelegramChannel[] = [];

            for (const dialog of dialogs) {
                const entity = dialog.entity;

                if (!entity) continue;
                if (entity.className === 'Channel' || entity.className === 'Chat') {
                    const channel: TelegramChannel = {
                        id: entity.id.toString(),
                        title: entity.title || 'Unknown',
                        participantsCount: entity.participantsCount,
                        isChannel: entity.className === 'Channel' && !entity.megagroup,
                        isGroup: entity.className === 'Chat',
                        isMegagroup: entity.className === 'Channel' && entity.megagroup || false
                    };
                    
                    channels.push(channel);
                }
            }

            // console.log(`Found ${channels.length} channels and groups`);
            return channels;
        } catch (error) {
            console.error('Error getting channels and groups:', error);
            throw error;
        }
    }

    /**
     * Start listening to messages from specific channels
     * @param channelIds Array of channel IDs to listen to
     * @param saveToConfig Whether to save to config (default: true)
     */
    public async startListening(channelIds: string[], saveToConfig: boolean = true): Promise<void> {
        try {
            if (!this.isInitialized) {
                throw new Error('Telegram client is not initialized');
            }

            // Add channel IDs to listening set
            channelIds.forEach(id => this.listeningChannels.add(id));
            
            // Save to config if requested
            if (saveToConfig) {
                await this.saveListeningChannelsToConfig();
            }
            
            // Start keep-alive if we now have forwarding rules and it's not already active
            if (this.hasActiveForwardingRules() && !this.isKeepAliveActive) {
                this.startKeepAlive();
            }
            
            console.log(`Started listening to ${channelIds.length} channels:`, channelIds);
        } catch (error) {
            console.error('Error starting to listen to channels:', error);
            throw error;
        }
    }

    /**
     * Stop listening to messages from specific channels
     * @param channelIds Array of channel IDs to stop listening to
     * @param saveToConfig Whether to save to config (default: true)
     */
    public stopListening(channelIds: string[], saveToConfig: boolean = true): void {
        channelIds.forEach(id => this.listeningChannels.delete(id));
        
        // Save to config if requested
        if (saveToConfig) {
            this.saveListeningChannelsToConfig();
        }
        
        // Stop keep-alive if no more forwarding rules
        if (!this.hasActiveForwardingRules() && this.isKeepAliveActive) {
            this.stopKeepAlive();
        }
        
        console.log(`Stopped listening to ${channelIds.length} channels:`, channelIds);
    }

    /**
     * Get list of channels currently being listened to
     * @returns Array of channel IDs
     */
    public getListeningChannels(): string[] {
        return Array.from(this.listeningChannels);
    }

    /**
     * Add a message handler
     * @param handler Function to handle incoming messages
     */
    public onMessage(handler: (message: TelegramMessage) => void): void {
        this.messageHandlers.push(handler);
        
        // Start keep-alive if we now have forwarding rules and it's not already active
        if (this.hasActiveForwardingRules() && !this.isKeepAliveActive) {
            this.startKeepAlive();
        }
    }

    /**
     * Remove a message handler
     * @param handler Function to remove
     */
    public removeMessageHandler(handler: (message: TelegramMessage) => void): void {
        const index = this.messageHandlers.indexOf(handler);
        if (index > -1) {
            this.messageHandlers.splice(index, 1);
        }
        
        // Stop keep-alive if no more forwarding rules
        if (!this.hasActiveForwardingRules() && this.isKeepAliveActive) {
            this.stopKeepAlive();
        }
    }

    /**
     * Get client info
     */
    public async getClientInfo(): Promise<any> {
        try {
            if (!this.isInitialized) {
                throw new Error('Telegram client is not initialized');
            }
            
            const me = await this.client.getMe();
            return {
                id: me.id.toString(),
                firstName: me.firstName,
                lastName: me.lastName,
                username: me.username,
                phone: me.phone,
                isBot: me.bot
            };
        } catch (error) {
            console.error('Error getting client info:', error);
            throw error;
        }
    }

    /**
     * Disconnect the client
     */
    public async disconnect(): Promise<void> {
        try {
            // Stop keep-alive first
            this.stopKeepAlive();
            
            if (this.client) {
                await this.client.disconnect();
            }
            this.isInitialized = false;
            console.log('Telegram client disconnected');
        } catch (error) {
            console.error('Error disconnecting client:', error);
            throw error;
        }
    }

    /**
     * Check if client is ready
     */
    public isReady(): boolean {
        return this.isInitialized;
    }

    /**
     * Find a channel by ID or title
     * @param identifier Channel ID or title
     * @returns Channel or null if not found
     */
    public async findChannel(identifier: string): Promise<TelegramChannel | null> {
        try {
            const channels = await this.getChannelsAndGroups();
            
            // First try to find by exact ID
            let channel = channels.find(c => c.id === identifier);
            
            // If not found, try to find by title
            if (!channel) {
                channel = channels.find(c => c.title === identifier);
            }
            
            // If still not found, try partial title match
            if (!channel) {
                channel = channels.find(c => c.title?.toLowerCase().includes(identifier.toLowerCase()));
            }
            
            // Try by username
            if (!channel) {
                channel = channels.find(c => c.username === identifier || c.username === identifier.replace('@', ''));
            }
            
            return channel || null;
        } catch (error) {
            console.error('Error finding channel:', error);
            return null;
        }
    }

    /**
     * Setup event handlers for the Telegram client
     */
    private setupEventHandlers(): void {
        // Remove existing handler if it exists
        if (this.currentEventHandler) {
            this.client.removeEventHandler(this.currentEventHandler, new NewMessage({}));
        }
        
        // Create and store the handler
        this.currentEventHandler = async (event: any) => {
            try {
                const message = event.message;

                if (!message) return;
                const activeConfigs = await getActiveListeningConfigs();
                this.listeningChannels = new Set(activeConfigs[0]?.telegramChannelIds);


                // Fix: Handle BigInt-like Integer object properly
                const chatId = message.chatId?.value?.toString() || message.chatId?.toString();
                const fixedId = chatId.startsWith('-100')?chatId.replace('-100', ''):chatId.replace('-', '');
                if (!chatId || !this.listeningChannels.has(fixedId)) return;
                // console.log('message form:', message.chatId?.value?.toString() || message.chatId?.toString());
                if(!this.messageHandlers.length) return;

                let titel = ''
                const entity = await this.client.getEntity(chatId);
                // console.log('entity:', entity);
                if (entity.className === "Channel" || entity.className === "Chat") {
                    titel = entity.title;
                  } else if (entity.className === "User") {
                    titel = entity.firstName + ' ' + entity.lastName;
                  }
                // Create message object
                const telegramMessage: TelegramMessage = {
                    id: message.id,
                    text: message.text || '',
                    date: new Date(message.date * 1000),
                    senderId: message.senderId?.value?.toString() || message.senderId?.toString(),
                    senderName: await this.getSenderName(message),
                    channelId: fixedId,
                    channelTitle: titel || message.chatTitle || 'Unknown', // Use the fetched title first
                    isForwarded: !!message.fwdFrom,
                    forwardedFrom: this.getForwardedFromName(message.fwdFrom),
                    mediaType: this.getMediaType(message),
                    hasMedia: !!message.media
                };

                // Download media if present, but check size first
                if (message.media) {
                    const mediaSize = this.getMediaSize(message);
                    const maxSizeBytes = 75 * 1024 * 1024; // 75 MB in bytes
                    
                    if (mediaSize && mediaSize > maxSizeBytes) {
                        console.log(`Skipping media download - file size (${Math.round(mediaSize / (1024 * 1024))} MB) exceeds 75 MB limit. Text will still be forwarded.`);
                        // Still set media properties but without buffer
                        telegramMessage.mediaType = this.getMediaType(message);
                        telegramMessage.hasMedia = true;
                        telegramMessage.mediaFileName = this.getMediaFileName(message);
                        telegramMessage.mediaMimeType = this.getMediaMimeType(message);
                        telegramMessage.mediaSkippedReason = 'size_limit';
                    } else {
                        const mediaData = await this.downloadMedia(message);
                        if (mediaData) {
                            telegramMessage.mediaBuffer = mediaData.buffer;
                            telegramMessage.mediaFileName = mediaData.fileName;
                            telegramMessage.mediaMimeType = mediaData.mimeType;
                        } else {
                            telegramMessage.mediaSkippedReason = 'download_failed';
                        }
                    }
                }

                // console.log(`New message from ${telegramMessage.channelTitle}: ${telegramMessage.text.substring(0, 100)}${telegramMessage.text.length > 100 ? '...' : ''}`);
                // console.log(`Channel ID: ${telegramMessage.channelId}`);
                // console.log(`Number of message handlers: ${this.messageHandlers.length}`);

                // Call all message handlers
                this.messageHandlers.forEach((handler, index) => {
                    try {
                        // console.log(`Calling message handler ${index + 1}/${this.messageHandlers.length}`);
                        handler(telegramMessage);
                        console.log(`Message handler ${index + 1} completed successfully`);
                    } catch (error) {
                        console.error(`Error in message handler ${index + 1}:`, error);
                    }
                });
            } catch (error) {
                console.error('Error handling message event:', error);
            }
        };
        
        this.client.addEventHandler(this.currentEventHandler, new NewMessage({}));
    }

    /**
     * Get sender name from message
     */
    private async getSenderName(message: any): Promise<string | undefined> {
        try {
            if (message.sender) {
                if (message.sender.firstName) {
                    return `${message.sender.firstName} ${message.sender.lastName || ''}`.trim();
                }
                if (message.sender.title) {
                    return message.sender.title;
                }
                if (message.sender.username) {
                    return `@${message.sender.username}`;
                }
            }
            return undefined;
        } catch (error) {
            return undefined;
        }
    }

    /**
     * Get forwarded from name from message
     */
    private getForwardedFromName(fwdFrom: any): string | undefined {
        if (!fwdFrom) return undefined;

        if (fwdFrom.fromId) {
            const fromId = fwdFrom.fromId.value?.toString() || fwdFrom.fromId?.toString();
            if (fromId) {
                return fromId;
            }
        }

        if (fwdFrom.fromName) {
            return fwdFrom.fromName;
        }

        return undefined;
    }

    /**
     * Get media type from message
     */
    private getMediaType(message: any): TelegramMessage['mediaType'] {
        if (!message.media) return undefined;
        
        const mediaClassName = message.media.className;
        
        switch (mediaClassName) {
            case 'MessageMediaPhoto':
                return 'photo';
            case 'MessageMediaDocument':
                if (message.media.document?.mimeType?.startsWith('video/')) {
                    return 'video';
                } else if (message.media.document?.mimeType?.startsWith('audio/')) {
                    return 'audio';
                } else {
                    return 'document';
                }
            case 'MessageMediaSticker':
                return 'sticker';
            default:
                return undefined;
        }
    }

    /**
     * Load session from file
     */
    private loadSession(): void {
        try {
            if (fs.existsSync(this.sessionFilePath)) {
                this.sessionString = fs.readFileSync(this.sessionFilePath, 'utf8').trim();
                console.log('Loaded existing Telegram session');
            }
        } catch (error) {
            console.log('No existing session found, will create new one');
            this.sessionString = '';
        }
    }

    /**
     * Save session to file
     */
    private saveSession(): void {
        try {
            fs.writeFileSync(this.sessionFilePath, this.sessionString);
            console.log('Telegram session saved');
        } catch (error) {
            console.error('Error saving session:', error);
        }
    }

    /**
     * Prompt for password (you can customize this)
     */
    private async promptPassword(): Promise<string> {
        return new Promise((resolve) => {
            this.passwordResolver = resolve;
            console.log('Two-factor authentication password required. Waiting for user input...');
        });
    }

    /**
     * Prompt for phone code (you can customize this)
     */
    private async promptPhoneCode(): Promise<string> {
        return new Promise((resolve) => {
            this.phoneCodeResolver = resolve;
            console.log('Phone verification code required. Waiting for user input...');
        });
    }

    /**
     * Submit phone code for authentication
     * @param code The verification code received via SMS/Telegram
     */
    public submitPhoneCode(code: string): void {
        if (this.phoneCodeResolver) {
            this.phoneCodeResolver(code);
            this.phoneCodeResolver = null;
        } else {
            console.error('No phone code resolver available');
        }
    }

    /**
     * Submit 2FA password for authentication
     * @param password The 2FA password
     */
    public submitPassword(password: string): void {
        if (this.passwordResolver) {
            this.passwordResolver(password);
            this.passwordResolver = null;
        } else {
            console.error('No password resolver available');
        }
    }

    /**
     * Check if currently authenticating
     */
    public checkIsAuthenticating(): boolean {
        return this.isAuthenticating;
    }

    /**
     * Check if waiting for phone code
     */
    public isWaitingForPhoneCode(): boolean {
        return this.phoneCodeResolver !== null;
    }

    /**
     * Check if waiting for 2FA password
     */
    public isWaitingForPassword(): boolean {
        return this.passwordResolver !== null;
    }

    /**
     * Download media from a message
     * @param message The raw Telegram message object
     * @returns Buffer containing the media data, or null if no media
     */
    public async downloadMedia(message: any): Promise<{buffer: Buffer, fileName: string, mimeType: string} | null> {
        try {
            if (!message.media || !this.isInitialized) {
                return null;
            }

            // console.log('Downloading media from Telegram...');
            const buffer = await this.client.downloadMedia(message, {});
            
            if (!buffer) {
                console.log('No media buffer received');
                return null;
            }

            // Generate filename based on media type and message ID
            let fileName = `media_${message.id}`;
            let mimeType = 'application/octet-stream';

            if (message.media.className === 'MessageMediaPhoto') {
                fileName += '.jpg';
                mimeType = 'image/jpeg';
            } else if (message.media.className === 'MessageMediaDocument') {
                const document = message.media.document;
                if (document.mimeType) {
                    mimeType = document.mimeType;
                    // Try to get file extension from mime type
                    const ext = mimeType.split('/')[1];
                    if (ext) {
                        fileName += `.${ext}`;
                    }
                }
                // Try to get original filename from document attributes
                if (document.attributes) {
                    for (const attr of document.attributes) {
                        if (attr.className === 'DocumentAttributeFilename' && attr.fileName) {
                            fileName = attr.fileName;
                            break;
                        }
                    }
                }
            }

            console.log(`Media downloaded: ${fileName}, size: ${buffer.length} bytes`);
            return {
                buffer: buffer as Buffer,
                fileName,
                mimeType
            };
        } catch (error) {
            console.error('Error downloading media:', error);
            return null;
        }
    }

    /**
     * Start keep-alive mechanism to maintain connection
     */
    public startKeepAlive(): void {
        if (this.isKeepAliveActive) {
            console.log('Keep-alive is already active');
            return;
        }

        this.isKeepAliveActive = true;
        console.log('Starting Telegram keep-alive mechanism...');

        // Send a ping every 5 minutes to keep connection alive
        this.keepAliveInterval = setInterval(async () => {
            try {
                if (this.isInitialized && this.client && this.hasActiveForwardingRules()) {
                    // console.log('Sending keep-alive ping to Telegram...');
                    await this.client.invoke(new Api.Ping({
                        pingId: helpers.generateRandomBigInt()
                    }));
                    // console.log('Keep-alive ping sent successfully');
                    this.reconnectAttempts = 0; // Reset reconnect attempts on successful ping
                }
            } catch (error) {
                console.error('Keep-alive ping failed:', error);
                // Don't immediately reconnect on ping failure, let connection check handle it
            }
        }, 5 * 60 * 1000); // 5 minutes

        // Check connection status every minute
        this.connectionCheckInterval = setInterval(async () => {
            try {
                if (this.hasActiveForwardingRules() && !this.checkConnection()) {
                    console.log('Connection lost, attempting to reconnect...');
                    await this.handleReconnection();
                }
            } catch (error) {
                console.error('Connection check failed:', error);
            }
        }, 60 * 1000); // 1 minute

        console.log('Keep-alive mechanism started');
    }

    /**
     * Stop keep-alive mechanism
     */
    public stopKeepAlive(): void {
        if (!this.isKeepAliveActive) {
            return;
        }

        this.isKeepAliveActive = false;
        
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }

        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = null;
        }

        console.log('Keep-alive mechanism stopped');
    }

    /**
     * Check if there are active forwarding rules that require the connection
     */
    private hasActiveForwardingRules(): boolean {
        // Check if there are listening channels configured
        if (this.listeningChannels.size === 0) {
            return false;
        }

        // Check if there are message handlers (indicating active forwarding)
        if (this.messageHandlers.length === 0) {
            return false;
        }

        return true;
    }

    /**
     * Check if connection is still alive
     */
    private checkConnection(): boolean {
        try {
            return this.isInitialized && this.client && this.client?.connected!;
        } catch (error) {
            return false;
        }
    }

    /**
     * Handle reconnection logic
     */
    private async handleReconnection(): Promise<void> {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping reconnection attempts.`);
            this.stopKeepAlive();
            return;
        }

        this.reconnectAttempts++;
        console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

        try {
            // Try to restart with existing session
            const success = await this.restart();
            if (success) {
                console.log('Reconnection successful');
                this.reconnectAttempts = 0;
            } else {
                console.error('Reconnection failed');
                // Wait before next attempt (exponential backoff)
                const delay = Math.min(30000, 5000 * Math.pow(2, this.reconnectAttempts - 1));
                console.log(`Waiting ${delay}ms before next reconnection attempt...`);
                setTimeout(() => {
                    if (this.hasActiveForwardingRules()) {
                        this.handleReconnection();
                    }
                }, delay);
            }
        } catch (error) {
            console.error('Error during reconnection:', error);
        }
    }

    /**
     * Get keep-alive status
     */
    public getKeepAliveStatus(): {
        isActive: boolean;
        hasForwardingRules: boolean;
        reconnectAttempts: number;
        isConnected: boolean;
    } {
        return {
            isActive: this.isKeepAliveActive,
            hasForwardingRules: this.hasActiveForwardingRules(),
            reconnectAttempts: this.reconnectAttempts,
            isConnected: this.checkConnection()
        };
    }

    /**
     * Get media size from message without downloading
     */
    private getMediaSize(message: any): number | null {
        if (!message.media) return null;

        if (message.media.className === 'MessageMediaDocument') {
            const document = message.media.document;
            return document.size || null;
        } else if (message.media.className === 'MessageMediaPhoto') {
            const photo = message.media.photo;
            if (photo.sizes && photo.sizes.length > 0) {
                // Get the largest photo size
                const largestSize = photo.sizes.reduce((max: any, current: any) => {
                    return (current.size || 0) > (max.size || 0) ? current : max;
                });
                return largestSize.size || null;
            }
        }
        
        return null;
    }

    /**
     * Get media filename without downloading
     */
    private getMediaFileName(message: any): string {
        let fileName = `media_${message.id}`;
        
        if (message.media.className === 'MessageMediaPhoto') {
            fileName += '.jpg';
        } else if (message.media.className === 'MessageMediaDocument') {
            const document = message.media.document;
            
            // Try to get original filename from document attributes
            if (document.attributes) {
                for (const attr of document.attributes) {
                    if (attr.className === 'DocumentAttributeFilename' && attr.fileName) {
                        return attr.fileName;
                    }
                }
            }
            
            // Fallback to mime type extension
            if (document.mimeType) {
                const ext = document.mimeType.split('/')[1];
                if (ext) {
                    fileName += `.${ext}`;
                }
            }
        }
        
        return fileName;
    }

    /**
     * Get media mime type without downloading
     */
    private getMediaMimeType(message: any): string {
        if (message.media.className === 'MessageMediaPhoto') {
            return 'image/jpeg';
        } else if (message.media.className === 'MessageMediaDocument') {
            const document = message.media.document;
            return document.mimeType || 'application/octet-stream';
        }
        
        return 'application/octet-stream';
    }
}

// Export default instance
export default TelegramInstance;
