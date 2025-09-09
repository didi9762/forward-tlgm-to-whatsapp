import { GroupChat } from 'whatsapp-web.js';
export declare class WhatsAppInstance {
    private client;
    private isInitialized;
    private currentQrCode;
    private qrCodeCallback?;
    constructor();
    /**
     * Clean up singleton lock file that might be left from previous runs
     */
    private cleanupSingletonLock;
    /**
     * Initialize the WhatsApp client
     * @param qrCallback Optional callback to handle QR code display
     */
    initialize(qrCallback?: (qr: string) => void): Promise<void>;
    /**
     * Get current QR code
     * @returns Current QR code string or empty string if not available
     */
    getCurrentQrCode(): string;
    /**
     * Restart the WhatsApp client
     */
    restart(): Promise<void>;
    /**
     * Reset WhatsApp instance by deleting auth/cache directories and restarting
     */
    resetInstance(): Promise<void>;
    /**
     * Get all groups that the bot is part of
     * @returns Array of group chats
     */
    getGroups(): Promise<GroupChat[]>;
    /**
     * Send a text message to a group
     * @param groupId Group ID (can be group name or ID)
     * @param message Text message to send
     */
    sendTextToGroup(groupId: string, message: string): Promise<void>;
    /**
     * Send a media message to a group
     * @param groupId Group ID (can be group name or ID)
     * @param mediaPath Path to the media file or base64 data
     * @param caption Optional caption for the media
     * @param mediaType Type of media (image, video, audio, document)
     */
    sendMediaToGroup(groupId: string, mediaPath: string, caption?: string, mediaType?: 'image' | 'video' | 'audio' | 'document'): Promise<void>;
    /**
     * Send message to group (unified method for both text and media)
     * @param groupId Group ID or name
     * @param content Message content (text or media path)
     * @param options Additional options
     */
    sendMessageToGroup(groupId: string, content: string, options?: {
        type?: 'text' | 'media';
        caption?: string;
        mediaType?: 'image' | 'video' | 'audio' | 'document';
    }): Promise<void>;
    /**
     * Find a group by ID or name
     * @param identifier Group ID or name
     * @returns Group chat or null if not found
     */
    private findGroup;
    /**
     * Get client info
     */
    getClientInfo(): Promise<any>;
    /**
     * Destroy the client
     */
    destroy(): Promise<void>;
    /**
     * Check if client is ready
     */
    isReady(): boolean;
    takeScreenshot(): Promise<string>;
    /**
     * Setup event handlers for the WhatsApp client
     */
    private setupEventHandlers;
}
export default WhatsAppInstance;
//# sourceMappingURL=whatsappInstance.d.ts.map