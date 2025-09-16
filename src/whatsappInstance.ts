import { Client, LocalAuth, MessageMedia, GroupChat } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

export class WhatsAppInstance {
    private client: Client;
    private groupsReady: boolean = false;
    private isInitialized: boolean = false;
    private currentQrCode: string = '';
    private qrCodeCallback?: (qr: string) => void;
    private isRestarting: boolean = false;
    private maxRestartAttempts: number = 3;
    private restartAttempts: number = 0;

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

        this.setupEventHandlers();
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

        this.isRestarting = true;
        this.restartAttempts++;

        try {
            if (this.restartAttempts > this.maxRestartAttempts) {
                console.error(`Max restart attempts (${this.maxRestartAttempts}) reached. Manual intervention required.`);
                this.isRestarting = false;
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
        } finally {
            this.isRestarting = false;
        }
    }

    /**
     * Initialize the WhatsApp client
     * @param qrCallback Optional callback to handle QR code display
     */
    public async initialize(qrCallback?: (qr: string) => void): Promise<void> {
        try {
            this.qrCodeCallback = qrCallback;
            this.currentQrCode = ''; // Reset QR code
            
            console.log('Initializing WhatsApp client...');
            await this.client.initialize();
            
            return new Promise((resolve, reject) => {
                this.client.once('qr', (qr) => {
                    console.log('whatsapp need scan');
                    this.currentQrCode = qr;
                    resolve();
                })
                
                this.client.once('ready', () => {
                    this.isInitialized = true;
                    this.currentQrCode = ''; // Clear QR code when ready
                    console.log('WhatsApp client is ready!');
                    this.client.getChats().then(() => {
                        console.log('WhatsApp groups are ready!');
                        this.groupsReady = true;
                    }).catch((error) => {
                        console.error('Error getting chats after ready:', error);
                        this.handleError(error, 'getChats after ready');
                    });
                    resolve();
                });

                this.client.once('auth_failure', (msg) => {
                    console.error('Authentication failed:', msg);
                    reject(new Error(`Authentication failed: ${msg}`));
                });

                // Set a timeout for initialization
                setTimeout(() => {
                    if (!this.isInitialized && !this.currentQrCode) {
                        reject(new Error('WhatsApp client initialization timeout'));
                    }
                }, 1000 * 60 * 2); // 2 minutes timeout
            });
        } catch (error) {
            console.error('Error initializing WhatsApp client:', error);
            await this.handleError(error, 'initialize');
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

    /**
     * Restart the WhatsApp client
     */
    public async restart(): Promise<void> {
        try {
            console.log('Restarting WhatsApp client...');
            
            await this.client.destroy();
            this.isInitialized = false;
            console.log('WhatsApp client destroyed, waiting for 1.5 seconds to restart');
            await new Promise(resolve => setTimeout(resolve, 1500));

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

            this.setupEventHandlers();
            await this.initialize();
            
            console.log('WhatsApp client restarted successfully');
        } catch (error) {
            console.error('Error restarting WhatsApp client:', error);
            throw error;
        }
    }

    /**
     * Reset WhatsApp instance by deleting auth/cache directories and restarting
     */
    public async resetInstance(): Promise<void> {
        try {
            console.log('Resetting WhatsApp instance...');
            
            // First destroy the current client if it exists
            if (this.isInitialized) {
                await this.client.destroy();
                this.isInitialized = false;
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

            this.setupEventHandlers();
            
            // Initialize the new client
            await this.initialize();
            
            console.log('WhatsApp instance reset successfully');
        } catch (error) {
            console.error('Error resetting WhatsApp instance:', error);
            throw error;
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

            const chats = await this.client.getChats();
            const groups = chats.filter(chat => chat.isGroup) as GroupChat[];
            
            console.log(`Found ${groups.length} groups`);
            return groups;
        } catch (error) {
            console.error('Error getting groups:', error);
            await this.handleError(error, 'getGroups');
            throw error;
        }
    }

    /**
     * Send a text message to a group
     * @param groupId Group ID (can be group name or ID)
     * @param message Text message to send
     */
    public async sendTextToGroup(groupId: string, message: string): Promise<void> {
        try {
            if (!this.isInitialized) {
                throw new Error('WhatsApp client is not initialized');
            }

            const group = await this.findGroup(groupId);
            if (!group) {
                throw new Error(`Group not found: ${groupId}`);
            }

            await this.client.sendMessage(group.id._serialized, message);
            console.log(`Text message sent to group: ${group.name}`);
        } catch (error) {
            console.error('Error sending text message to group:', error);
            await this.handleError(error, 'sendTextToGroup');
            throw error;
        }
    }

    /**
     * Send a media message to a group
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
        try {
            if (!this.isInitialized) {
                throw new Error('WhatsApp client is not initialized');
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
            console.log(`Media message sent to group: ${group.name}`);
        } catch (error) {
            console.error('Error sending media message to group:', error);
            await this.handleError(error, 'sendMediaToGroup');
            throw error;
        }
    }

    /**
     * Send message to group (unified method for both text and media)
     * @param groupId Group ID or name
     * @param content Message content (text or media path)
     * @param options Additional options
     */
    public async sendMessageToGroup(
        groupId: string, 
        content: string, 
        options?: {
            type?: 'text' | 'media';
            caption?: string;
            mediaType?: 'image' | 'video' | 'audio' | 'document';
        }
    ): Promise<void> {
        try {
            const { type = 'text', caption, mediaType = 'image' } = options || {};
            
            if (type === 'media') {
                await this.sendMediaToGroup(groupId, content, caption, mediaType);
            } else {
                await this.sendTextToGroup(groupId, content);
            }
        } catch (error) {
            console.error('Error in sendMessageToGroup:', error);
            await this.handleError(error, 'sendMessageToGroup');
            throw error;
        }
    }

    /**
     * Find a group by ID or name
     * @param identifier Group ID or name
     * @returns Group chat or null if not found
     */
    private async findGroup(identifier: string): Promise<GroupChat | null> {
        try {
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
            await this.client.destroy();
            this.isInitialized = false;
            
            // Clean up singleton lock after destroy
            this.cleanupSingletonLock();
            
            console.log('WhatsApp client destroyed');
        } catch (error) {
            console.error('Error destroying client:', error);
            
            // Try to clean up singleton lock even if destroy failed
            this.cleanupSingletonLock();
            
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
            console.error('Error taking screenshot:', error);
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
            // console.log('WhatsApp client is ready');
            this.currentQrCode = ''; // Clear QR code when ready
        });

        this.client.on('disconnected', (reason) => {
            console.log('WhatsApp client disconnected:', reason);
            this.isInitialized = false;
            this.groupsReady = false;
            
            // Handle disconnection with potential restart
            this.handleError(new Error(`Client disconnected: ${reason}`), 'disconnected event');
        });

        this.client.on('auth_failure', (message) => {
            console.error('Authentication failure:', message);
            this.isInitialized = false;
            this.groupsReady = false;
        });

        // Add error event handler
        this.client.on('error', (error) => {
            console.error('WhatsApp client error:', error);
            this.handleError(error, 'client error event');
        });

        // Add change_state event handler for additional monitoring
        this.client.on('change_state', (state) => {
            console.log('WhatsApp client state changed:', state);
            if (state === 'CONFLICT' || state === 'UNPAIRED') {
                this.isInitialized = false;
                this.groupsReady = false;
            }
        });
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
