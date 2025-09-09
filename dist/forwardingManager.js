"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const configManager_1 = require("./configManager");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class ForwardingManager {
    constructor(telegramInstance, whatsappInstance) {
        this.activeSessions = new Map();
        this.telegramInstance = telegramInstance;
        this.whatsappInstance = whatsappInstance;
    }
    /**
     * Start forwarding based on a specific rule
     */
    async startForwardingRule(rule) {
        try {
            // Check if rule is already active
            if (this.activeSessions.has(rule.id)) {
                console.log(`Forwarding rule ${rule.name} is already active`);
                return true;
            }
            // Check if Telegram client is ready
            if (!this.telegramInstance.isReady()) {
                console.error('Telegram client is not ready');
                return false;
            }
            // Check if WhatsApp client is ready
            if (!this.whatsappInstance.isReady()) {
                console.error('WhatsApp client is not ready');
                return false;
            }
            // Start listening to the channels in this rule
            await this.telegramInstance.startListening(rule.telegramChannelIds);
            // Create message handler for this rule
            const messageHandler = async (message) => {
                console.log(`ForwardingManager: Checking message from channel ${message.channelId}`);
                console.log(`ForwardingManager: Rule channels:`, rule.telegramChannelIds);
                // Check if this message is from one of the channels in this rule
                if (rule.telegramChannelIds.includes(message.channelId)) {
                    console.log(`ForwardingManager: Message matches rule ${rule.name}, forwarding to WhatsApp`);
                    try {
                        await this.forwardMessageToWhatsApp(message, rule);
                        console.log(`ForwardingManager: Message forwarded successfully`);
                    }
                    catch (error) {
                        console.error(`Error forwarding message from rule ${rule.name}:`, error);
                    }
                }
                else {
                    console.log(`ForwardingManager: Message does not match rule ${rule.name}`);
                }
            };
            // Add the handler to Telegram instance
            this.telegramInstance.onMessage(messageHandler);
            // Create session record
            const session = {
                ruleId: rule.id,
                handlerId: `handler_${rule.id}_${Date.now()}`,
                messageHandler,
                isActive: true
            };
            this.activeSessions.set(rule.id, session);
            console.log(`Started forwarding rule: ${rule.name}`);
            return true;
        }
        catch (error) {
            console.error(`Error starting forwarding rule ${rule.name}:`, error);
            return false;
        }
    }
    /**
     * Stop forwarding for a specific rule
     */
    stopForwardingRule(ruleId) {
        try {
            const session = this.activeSessions.get(ruleId);
            if (!session) {
                console.log(`No active session found for rule ${ruleId}`);
                return false;
            }
            // Remove message handler
            this.telegramInstance.removeMessageHandler(session.messageHandler);
            // Remove session
            this.activeSessions.delete(ruleId);
            console.log(`Stopped forwarding rule: ${ruleId}`);
            return true;
        }
        catch (error) {
            console.error(`Error stopping forwarding rule ${ruleId}:`, error);
            return false;
        }
    }
    /**
     * Start all active forwarding rules
     */
    async startAllActiveRules() {
        const activeRules = configManager_1.configManager.getActiveForwardingRules();
        console.log(`Starting ${activeRules.length} active forwarding rules...`);
        for (const rule of activeRules) {
            await this.startForwardingRule(rule);
        }
        // Update Telegram listening channels based on all active rules
        const allChannelIds = configManager_1.configManager.getAllActiveChannelIds();
        if (allChannelIds.length > 0) {
            configManager_1.configManager.setTelegramListeningChannels(allChannelIds);
        }
    }
    /**
     * Stop all active forwarding rules
     */
    stopAllRules() {
        console.log('Stopping all forwarding rules...');
        for (const [ruleId] of this.activeSessions) {
            this.stopForwardingRule(ruleId);
        }
        this.activeSessions.clear();
    }
    /**
     * Restart all active forwarding rules
     */
    async restartAllRules() {
        this.stopAllRules();
        await this.startAllActiveRules();
    }
    /**
     * Get active sessions info
     */
    getActiveSessionsInfo() {
        const result = [];
        for (const [ruleId, session] of this.activeSessions) {
            const rule = configManager_1.configManager.getForwardingRule(ruleId);
            result.push({
                ruleId,
                handlerId: session.handlerId,
                ruleName: rule?.name || 'Unknown'
            });
        }
        return result;
    }
    /**
     * Check if a rule is currently active
     */
    isRuleActive(ruleId) {
        return this.activeSessions.has(ruleId);
    }
    /**
     * Forward a Telegram message to WhatsApp
     */
    async forwardMessageToWhatsApp(message, rule) {
        try {
            // Format the message for WhatsApp
            let formattedMessage = `📢 *${message.channelTitle}*\n`;
            if (message.senderName) {
                formattedMessage += `👤 ${message.senderName}\n`;
            }
            if (message.isForwarded && message.forwardedFrom) {
                formattedMessage += `🔄 Forwarded from: ${message.forwardedFrom}\n`;
            }
            if (message.text) {
                formattedMessage += `\n${message.text}`;
            }
            // Handle media messages
            if (message.hasMedia && message.mediaBuffer) {
                console.log(`Forwarding media: ${message.mediaFileName}`);
                // Create a temporary file path or use base64
                const tempDir = path_1.default.join(process.cwd(), 'temp');
                if (!fs_1.default.existsSync(tempDir)) {
                    fs_1.default.mkdirSync(tempDir, { recursive: true });
                }
                const tempFilePath = path_1.default.join(tempDir, message.mediaFileName || `media_${message.id}`);
                try {
                    // Write media to temporary file
                    fs_1.default.writeFileSync(tempFilePath, message.mediaBuffer);
                    // Determine media type for WhatsApp
                    let whatsappMediaType = 'document';
                    if (message.mediaType === 'photo') {
                        whatsappMediaType = 'image';
                    }
                    else if (message.mediaType === 'video') {
                        whatsappMediaType = 'video';
                    }
                    else if (message.mediaType === 'audio') {
                        whatsappMediaType = 'audio';
                    }
                    // Send media to WhatsApp
                    await this.whatsappInstance.sendMediaToGroup(rule.whatsappGroupId, tempFilePath, formattedMessage, // Use formatted message as caption
                    whatsappMediaType);
                    // Clean up temporary file
                    fs_1.default.unlinkSync(tempFilePath);
                }
                catch (mediaError) {
                    console.error('Error handling media file:', mediaError);
                    // Fallback to text message mentioning media
                    formattedMessage += `\n\n📎 Media: ${message.mediaType || 'Unknown'} (failed to forward)`;
                    await this.whatsappInstance.sendMessageToGroup(rule.whatsappGroupId, formattedMessage);
                }
            }
            else {
                // Text-only message or media without buffer
                if (message.hasMedia) {
                    formattedMessage += `\n\n📎 Media: ${message.mediaType || 'Unknown'} (download failed)`;
                }
                // Send text message to WhatsApp group
                await this.whatsappInstance.sendMessageToGroup(rule.whatsappGroupId, formattedMessage);
            }
            console.log(`Forwarded message from ${message.channelTitle} to WhatsApp group via rule: ${rule.name}`);
        }
        catch (error) {
            console.error('Error forwarding message to WhatsApp:', error);
            throw error;
        }
    }
}
exports.default = ForwardingManager;
//# sourceMappingURL=forwardingManager.js.map