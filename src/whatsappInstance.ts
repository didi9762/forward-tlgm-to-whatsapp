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
                this.client.once('ready', () => {
                    this.isInitialized = true;
                    this.currentQrCode = ''; // Clear QR code when ready
                    console.log('WhatsApp client is ready!');
                    this.client.getChats().then(() => {
                        console.log('WhatsApp groups are ready!');
                        this.groupsReady = true;
                    });
                    resolve();
                });

                this.client.once('qr', (qr) => {
                    console.log('whatsapp need scan');
                    resolve();
                })

                this.client.once('auth_failure', (msg) => {
                    console.error('Authentication failed:', msg);
                    reject(new Error(`Authentication failed: ${msg}`));
                });

                // Set a timeout for initialization
                setTimeout(() => {
                    if (!this.isInitialized) {
                        reject(new Error('WhatsApp client initialization timeout'));
                    }
                }, 1000 * 60 *2); // 2 minutes timeout
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
        const { type = 'text', caption, mediaType = 'image' } = options || {};
        
        if (type === 'media') {
            await this.sendMediaToGroup(groupId, content, caption, mediaType);
        } else {
            await this.sendTextToGroup(groupId, content);
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
            console.error('Error taking screenshot');
            return '';
        }
    }

    /**
     * Setup event handlers for the WhatsApp client
     */
    private setupEventHandlers(): void {
        this.client.on('qr', async (qr) => {
            console.log('QR Code received');
            // this.currentQrCode = qr; // Store QR code
            
            // if (this.qrCodeCallback) {
            //     this.qrCodeCallback(qr);
            // } else {
            //     console.log('QR Code updated. Use /api/qr endpoint to retrieve it.');
            // }
        });

        this.client.on('authenticated', () => {
            console.log('WhatsApp authenticated successfully');
            this.currentQrCode = ''; // Clear QR code when authenticated
        });

        this.client.on('ready', () => {
            console.log('WhatsApp client is ready');
            this.currentQrCode = ''; // Clear QR code when ready
        });

        this.client.on('disconnected', (reason) => {
            console.log('WhatsApp client disconnected:', reason);
            this.isInitialized = false;
        });

        this.client.on('auth_failure', (message) => {
            console.error('Authentication failure:', message);
            this.isInitialized = false;
        });
    }
}

// Export default instance
export default WhatsAppInstance;
