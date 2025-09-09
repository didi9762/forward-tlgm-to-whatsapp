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
    mediaBuffer?: Buffer;
    mediaFileName?: string;
    mediaMimeType?: string;
}
export declare class TelegramInstance {
    private client;
    private isInitialized;
    private sessionString;
    private sessionFilePath;
    private listeningChannels;
    private messageHandlers;
    private isAuthenticating;
    private phoneCodeResolver;
    private passwordResolver;
    constructor();
    /**
     * Load listening channels from config
     */
    private loadListeningChannelsFromConfig;
    /**
     * Save listening channels to config
     */
    private saveListeningChannelsToConfig;
    /**
     * Initialize the Telegram client
     * @param phoneNumber Phone number for authentication (if not already authenticated)
     */
    initialize(phoneNumber: string): Promise<void>;
    /**
     * Restart the Telegram client
     */
    restart(): Promise<void>;
    /**
     * Reset Telegram client by deleting session and disconnecting
     */
    reset(): Promise<void>;
    /**
     * Get all channels and groups the user is part of
     * @returns Array of channels/groups
     */
    getChannelsAndGroups(): Promise<TelegramChannel[]>;
    /**
     * Start listening to messages from specific channels
     * @param channelIds Array of channel IDs to listen to
     * @param saveToConfig Whether to save to config (default: true)
     */
    startListening(channelIds: string[], saveToConfig?: boolean): Promise<void>;
    /**
     * Stop listening to messages from specific channels
     * @param channelIds Array of channel IDs to stop listening to
     * @param saveToConfig Whether to save to config (default: true)
     */
    stopListening(channelIds: string[], saveToConfig?: boolean): void;
    /**
     * Get list of channels currently being listened to
     * @returns Array of channel IDs
     */
    getListeningChannels(): string[];
    /**
     * Add a message handler
     * @param handler Function to handle incoming messages
     */
    onMessage(handler: (message: TelegramMessage) => void): void;
    /**
     * Remove a message handler
     * @param handler Function to remove
     */
    removeMessageHandler(handler: (message: TelegramMessage) => void): void;
    /**
     * Get client info
     */
    getClientInfo(): Promise<any>;
    /**
     * Disconnect the client
     */
    disconnect(): Promise<void>;
    /**
     * Check if client is ready
     */
    isReady(): boolean;
    /**
     * Find a channel by ID or title
     * @param identifier Channel ID or title
     * @returns Channel or null if not found
     */
    findChannel(identifier: string): Promise<TelegramChannel | null>;
    /**
     * Setup event handlers for the Telegram client
     */
    private setupEventHandlers;
    /**
     * Get sender name from message
     */
    private getSenderName;
    /**
     * Get media type from message
     */
    private getMediaType;
    /**
     * Load session from file
     */
    private loadSession;
    /**
     * Save session to file
     */
    private saveSession;
    /**
     * Prompt for password (you can customize this)
     */
    private promptPassword;
    /**
     * Prompt for phone code (you can customize this)
     */
    private promptPhoneCode;
    /**
     * Submit phone code for authentication
     * @param code The verification code received via SMS/Telegram
     */
    submitPhoneCode(code: string): void;
    /**
     * Submit 2FA password for authentication
     * @param password The 2FA password
     */
    submitPassword(password: string): void;
    /**
     * Check if currently authenticating
     */
    checkIsAuthenticating(): boolean;
    /**
     * Check if waiting for phone code
     */
    isWaitingForPhoneCode(): boolean;
    /**
     * Check if waiting for 2FA password
     */
    isWaitingForPassword(): boolean;
    /**
     * Download media from a message
     * @param message The raw Telegram message object
     * @returns Buffer containing the media data, or null if no media
     */
    downloadMedia(message: any): Promise<{
        buffer: Buffer;
        fileName: string;
        mimeType: string;
    } | null>;
}
export default TelegramInstance;
//# sourceMappingURL=telegramInstance.d.ts.map