"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramInstance = void 0;
const telegram_1 = require("telegram");
const sessions_1 = require("telegram/sessions");
const events_1 = require("telegram/events");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const configManager_1 = require("./configManager");
// Load environment variables
dotenv.config();
class TelegramInstance {
    constructor() {
        this.isInitialized = false;
        this.sessionString = '';
        this.listeningChannels = new Set();
        this.messageHandlers = [];
        // Authentication state management
        this.isAuthenticating = false;
        this.phoneCodeResolver = null;
        this.passwordResolver = null;
        this.sessionFilePath = path.join(process.cwd(), 'telegram_session.txt');
        // Load existing session if available
        this.loadSession();
        this.restart();
        // Load listening channels from config
        this.loadListeningChannelsFromConfig();
        const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
        const apiHash = process.env.TELEGRAM_API_HASH || '';
        if (!apiId || !apiHash) {
            throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in environment variables');
        }
        this.client = new telegram_1.TelegramClient(new sessions_1.StringSession(this.sessionString), apiId, apiHash, {
            connectionRetries: 5,
            useWSS: true,
        });
        this.setupEventHandlers();
    }
    /**
     * Load listening channels from config
     */
    loadListeningChannelsFromConfig() {
        const configChannels = configManager_1.configManager.getTelegramListeningChannels();
        this.listeningChannels = new Set(configChannels);
        if (configChannels.length > 0) {
            console.log(`Loaded ${configChannels.length} listening channels from config:`, configChannels);
        }
    }
    /**
     * Save listening channels to config
     */
    saveListeningChannelsToConfig() {
        const channelArray = Array.from(this.listeningChannels);
        configManager_1.configManager.setTelegramListeningChannels(channelArray);
        // Sync the main forwarding rule with current listening channels
        configManager_1.configManager.syncMainForwardingRule();
        console.log(`Saved ${channelArray.length} listening channels to config and synced forwarding rule`);
    }
    /**
     * Initialize the Telegram client
     * @param phoneNumber Phone number for authentication (if not already authenticated)
     */
    async initialize(phoneNumber) {
        try {
            console.log('Initializing Telegram client...');
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
            this.sessionString = this.client.session.save();
            this.saveSession();
            console.log('Telegram client is ready!');
            console.log('Logged in as:', (await this.client.getMe()).firstName);
            // Auto-start listening to configured channels
            if (this.listeningChannels.size > 0) {
                console.log(`Auto-starting listening to ${this.listeningChannels.size} configured channels`);
            }
        }
        catch (error) {
            console.error('Error initializing Telegram client:', error);
            throw error;
        }
    }
    /**
     * Restart the Telegram client
     */
    async restart() {
        try {
            console.log('Restarting Telegram client...');
            if (this.isInitialized) {
                await this.client.disconnect();
                this.isInitialized = false;
            }
            // Reset authentication state
            this.isAuthenticating = false;
            this.phoneCodeResolver = null;
            this.passwordResolver = null;
            // Create new client instance with existing session
            const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
            const apiHash = process.env.TELEGRAM_API_HASH || '';
            this.client = new telegram_1.TelegramClient(new sessions_1.StringSession(this.sessionString), // This uses the saved session
            apiId, apiHash, {
                connectionRetries: 5,
                useWSS: true,
            });
            this.loadListeningChannelsFromConfig();
            this.setupEventHandlers();
            // For restart, we don't need to call initialize() with authentication
            // Just connect using the existing session
            console.log('Connecting with saved session...');
            await this.client.connect();
            this.isInitialized = true;
            console.log('Telegram client restarted successfully');
        }
        catch (error) {
            console.error('Error restarting Telegram client:', error);
            throw error;
        }
    }
    /**
     * Reset Telegram client by deleting session and disconnecting
     */
    async reset() {
        try {
            console.log('Resetting Telegram client...');
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
        }
        catch (error) {
            console.error('Error resetting Telegram client:', error);
            throw error;
        }
    }
    /**
     * Get all channels and groups the user is part of
     * @returns Array of channels/groups
     */
    async getChannelsAndGroups() {
        try {
            if (!this.isInitialized) {
                throw new Error('Telegram client is not initialized');
            }
            console.log('Fetching channels and groups...');
            const dialogs = await this.client.getDialogs({});
            const channels = [];
            for (const dialog of dialogs) {
                const entity = dialog.entity;
                if (!entity)
                    continue;
                if (entity.className === 'Channel' || entity.className === 'Chat') {
                    const channel = {
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
            console.log(`Found ${channels.length} channels and groups`);
            return channels;
        }
        catch (error) {
            console.error('Error getting channels and groups:', error);
            throw error;
        }
    }
    /**
     * Start listening to messages from specific channels
     * @param channelIds Array of channel IDs to listen to
     * @param saveToConfig Whether to save to config (default: true)
     */
    async startListening(channelIds, saveToConfig = true) {
        try {
            if (!this.isInitialized) {
                throw new Error('Telegram client is not initialized');
            }
            // Add channel IDs to listening set
            channelIds.forEach(id => this.listeningChannels.add(id));
            // Save to config if requested
            if (saveToConfig) {
                this.saveListeningChannelsToConfig();
            }
            console.log(`Started listening to ${channelIds.length} channels:`, channelIds);
        }
        catch (error) {
            console.error('Error starting to listen to channels:', error);
            throw error;
        }
    }
    /**
     * Stop listening to messages from specific channels
     * @param channelIds Array of channel IDs to stop listening to
     * @param saveToConfig Whether to save to config (default: true)
     */
    stopListening(channelIds, saveToConfig = true) {
        channelIds.forEach(id => this.listeningChannels.delete(id));
        // Save to config if requested
        if (saveToConfig) {
            this.saveListeningChannelsToConfig();
        }
        console.log(`Stopped listening to ${channelIds.length} channels:`, channelIds);
    }
    /**
     * Get list of channels currently being listened to
     * @returns Array of channel IDs
     */
    getListeningChannels() {
        return Array.from(this.listeningChannels);
    }
    /**
     * Add a message handler
     * @param handler Function to handle incoming messages
     */
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }
    /**
     * Remove a message handler
     * @param handler Function to remove
     */
    removeMessageHandler(handler) {
        const index = this.messageHandlers.indexOf(handler);
        if (index > -1) {
            this.messageHandlers.splice(index, 1);
        }
    }
    /**
     * Get client info
     */
    async getClientInfo() {
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
        }
        catch (error) {
            console.error('Error getting client info:', error);
            throw error;
        }
    }
    /**
     * Disconnect the client
     */
    async disconnect() {
        try {
            if (this.client) {
                await this.client.disconnect();
            }
            this.isInitialized = false;
            console.log('Telegram client disconnected');
        }
        catch (error) {
            console.error('Error disconnecting client:', error);
            throw error;
        }
    }
    /**
     * Check if client is ready
     */
    isReady() {
        return this.isInitialized;
    }
    /**
     * Find a channel by ID or title
     * @param identifier Channel ID or title
     * @returns Channel or null if not found
     */
    async findChannel(identifier) {
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
        }
        catch (error) {
            console.error('Error finding channel:', error);
            return null;
        }
    }
    /**
     * Setup event handlers for the Telegram client
     */
    setupEventHandlers() {
        this.client.addEventHandler(async (event) => {
            try {
                const message = event.message;
                if (!message)
                    return;
                // Fix: Handle BigInt-like Integer object properly
                const chatId = message.chatId?.value?.toString() || message.chatId?.toString();
                if (!chatId || !this.listeningChannels.has(chatId))
                    return;
                console.log('message form:', message.chatId?.value?.toString() || message.chatId?.toString());
                // Get channel info
                const channel = await this.findChannel(Math.abs(Number(chatId)).toString());
                if (!channel)
                    return;
                // Create message object
                const telegramMessage = {
                    id: message.id,
                    text: message.text || '',
                    date: new Date(message.date * 1000),
                    senderId: message.senderId?.value?.toString() || message.senderId?.toString(),
                    senderName: await this.getSenderName(message),
                    channelId: chatId,
                    channelTitle: channel.title,
                    isForwarded: !!message.fwdFrom,
                    forwardedFrom: message.fwdFrom?.fromName || message.fwdFrom?.fromId?.value?.toString() || message.fwdFrom?.fromId?.toString(),
                    mediaType: this.getMediaType(message),
                    hasMedia: !!message.media
                };
                // Download media if present
                if (message.media) {
                    const mediaData = await this.downloadMedia(message);
                    if (mediaData) {
                        telegramMessage.mediaBuffer = mediaData.buffer;
                        telegramMessage.mediaFileName = mediaData.fileName;
                        telegramMessage.mediaMimeType = mediaData.mimeType;
                    }
                }
                console.log(`New message from ${channel.title}: ${telegramMessage.text.substring(0, 100)}${telegramMessage.text.length > 100 ? '...' : ''}`);
                console.log(`Channel ID: ${telegramMessage.channelId}`);
                console.log(`Number of message handlers: ${this.messageHandlers.length}`);
                // Call all message handlers
                this.messageHandlers.forEach((handler, index) => {
                    try {
                        console.log(`Calling message handler ${index + 1}/${this.messageHandlers.length}`);
                        handler(telegramMessage);
                        console.log(`Message handler ${index + 1} completed successfully`);
                    }
                    catch (error) {
                        console.error(`Error in message handler ${index + 1}:`, error);
                    }
                });
            }
            catch (error) {
                console.error('Error handling message event:', error);
            }
        }, new events_1.NewMessage({}));
    }
    /**
     * Get sender name from message
     */
    async getSenderName(message) {
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
        }
        catch (error) {
            return undefined;
        }
    }
    /**
     * Get media type from message
     */
    getMediaType(message) {
        if (!message.media)
            return undefined;
        const mediaClassName = message.media.className;
        switch (mediaClassName) {
            case 'MessageMediaPhoto':
                return 'photo';
            case 'MessageMediaDocument':
                if (message.media.document?.mimeType?.startsWith('video/')) {
                    return 'video';
                }
                else if (message.media.document?.mimeType?.startsWith('audio/')) {
                    return 'audio';
                }
                else {
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
    loadSession() {
        try {
            if (fs.existsSync(this.sessionFilePath)) {
                this.sessionString = fs.readFileSync(this.sessionFilePath, 'utf8').trim();
                console.log('Loaded existing Telegram session');
            }
        }
        catch (error) {
            console.log('No existing session found, will create new one');
            this.sessionString = '';
        }
    }
    /**
     * Save session to file
     */
    saveSession() {
        try {
            fs.writeFileSync(this.sessionFilePath, this.sessionString);
            console.log('Telegram session saved');
        }
        catch (error) {
            console.error('Error saving session:', error);
        }
    }
    /**
     * Prompt for password (you can customize this)
     */
    async promptPassword() {
        return new Promise((resolve) => {
            this.passwordResolver = resolve;
            console.log('Two-factor authentication password required. Waiting for user input...');
        });
    }
    /**
     * Prompt for phone code (you can customize this)
     */
    async promptPhoneCode() {
        return new Promise((resolve) => {
            this.phoneCodeResolver = resolve;
            console.log('Phone verification code required. Waiting for user input...');
        });
    }
    /**
     * Submit phone code for authentication
     * @param code The verification code received via SMS/Telegram
     */
    submitPhoneCode(code) {
        if (this.phoneCodeResolver) {
            this.phoneCodeResolver(code);
            this.phoneCodeResolver = null;
        }
        else {
            console.error('No phone code resolver available');
        }
    }
    /**
     * Submit 2FA password for authentication
     * @param password The 2FA password
     */
    submitPassword(password) {
        if (this.passwordResolver) {
            this.passwordResolver(password);
            this.passwordResolver = null;
        }
        else {
            console.error('No password resolver available');
        }
    }
    /**
     * Check if currently authenticating
     */
    checkIsAuthenticating() {
        return this.isAuthenticating;
    }
    /**
     * Check if waiting for phone code
     */
    isWaitingForPhoneCode() {
        return this.phoneCodeResolver !== null;
    }
    /**
     * Check if waiting for 2FA password
     */
    isWaitingForPassword() {
        return this.passwordResolver !== null;
    }
    /**
     * Download media from a message
     * @param message The raw Telegram message object
     * @returns Buffer containing the media data, or null if no media
     */
    async downloadMedia(message) {
        try {
            if (!message.media || !this.isInitialized) {
                return null;
            }
            console.log('Downloading media from Telegram...');
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
            }
            else if (message.media.className === 'MessageMediaDocument') {
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
                buffer: buffer,
                fileName,
                mimeType
            };
        }
        catch (error) {
            console.error('Error downloading media:', error);
            return null;
        }
    }
}
exports.TelegramInstance = TelegramInstance;
// Export default instance
exports.default = TelegramInstance;
//# sourceMappingURL=telegramInstance.js.map