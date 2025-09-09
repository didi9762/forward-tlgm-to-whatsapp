import { TelegramInstance, TelegramMessage } from './telegramInstance';
import { WhatsAppInstance } from './whatsappInstance';
import { configManager, ForwardingRule } from './configManager';
import fs from 'fs';
import path from 'path';

export interface ForwardingSession {
    ruleId: string;
    handlerId: string;
    messageHandler: (message: TelegramMessage) => void;
    isActive: boolean;
}

class ForwardingManager {
    private telegramInstance: TelegramInstance;
    private whatsappInstance: WhatsAppInstance;
    private activeSessions: Map<string, ForwardingSession> = new Map();

    constructor(telegramInstance: TelegramInstance, whatsappInstance: WhatsAppInstance) {
        this.telegramInstance = telegramInstance;
        this.whatsappInstance = whatsappInstance;
    }

    /**
     * Start forwarding based on a specific rule
     */
    public async startForwardingRule(rule: ForwardingRule): Promise<boolean> {
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
            const messageHandler = async (message: TelegramMessage) => {
                console.log(`ForwardingManager: Checking message from channel ${message.channelId}`);
                console.log(`ForwardingManager: Rule channels:`, rule.telegramChannelIds);
                
                // Check if this message is from one of the channels in this rule
                if (rule.telegramChannelIds.includes(message.channelId) || rule.telegramChannelIds.includes(message.channelId.replace('-100', '-'))) {
                    console.log(`ForwardingManager: Message matches rule ${rule.name}, forwarding to WhatsApp`);
                    try {
                        await this.forwardMessageToWhatsApp(message, rule);
                        console.log(`ForwardingManager: Message forwarded successfully`);
                    } catch (error) {
                        console.error(`Error forwarding message from rule ${rule.name}:`, error);
                    }
                } else {
                    console.log(`ForwardingManager: Message does not match rule ${rule.name}`);
                }
            };

            // Add the handler to Telegram instance
            this.telegramInstance.onMessage(messageHandler);

            // Create session record
            const session: ForwardingSession = {
                ruleId: rule.id,
                handlerId: `handler_${rule.id}_${Date.now()}`,
                messageHandler,
                isActive: true
            };

            this.activeSessions.set(rule.id, session);

            console.log(`Started forwarding rule: ${rule.name}`);
            return true;

        } catch (error) {
            console.error(`Error starting forwarding rule ${rule.name}:`, error);
            return false;
        }
    }

    /**
     * Stop forwarding for a specific rule
     */
    public stopForwardingRule(ruleId: string): boolean {
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

        } catch (error) {
            console.error(`Error stopping forwarding rule ${ruleId}:`, error);
            return false;
        }
    }

    /**
     * Start all active forwarding rules
     */
    public async startAllActiveRules(): Promise<void> {
        const activeRules = configManager.getActiveForwardingRules();
        
        console.log(`Starting ${activeRules.length} active forwarding rules...`);

        for (const rule of activeRules) {
            await this.startForwardingRule(rule);
        }

        // Update Telegram listening channels based on all active rules
        const allChannelIds = configManager.getAllActiveChannelIds();
        if (allChannelIds.length > 0) {
            configManager.setTelegramListeningChannels(allChannelIds);
        }
    }

    /**
     * Stop all active forwarding rules
     */
    public stopAllRules(): void {
        console.log('Stopping all forwarding rules...');
        
        for (const [ruleId] of this.activeSessions) {
            this.stopForwardingRule(ruleId);
        }

        this.activeSessions.clear();
    }

    /**
     * Restart all active forwarding rules
     */
    public async restartAllRules(): Promise<void> {
        this.stopAllRules();
        await this.startAllActiveRules();
    }

    /**
     * Get active sessions info
     */
    public getActiveSessionsInfo(): Array<{ruleId: string, handlerId: string, ruleName: string}> {
        const result: Array<{ruleId: string, handlerId: string, ruleName: string}> = [];
        
        for (const [ruleId, session] of this.activeSessions) {
            const rule = configManager.getForwardingRule(ruleId);
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
    public isRuleActive(ruleId: string): boolean {
        return this.activeSessions.has(ruleId);
    }

    /**
     * Forward a Telegram message to WhatsApp
     */
    private async forwardMessageToWhatsApp(message: TelegramMessage, rule: ForwardingRule): Promise<void> {
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
                const tempDir = path.join(process.cwd(), 'temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const tempFilePath = path.join(tempDir, message.mediaFileName || `media_${message.id}`);
                
                try {
                    // Write media to temporary file
                    fs.writeFileSync(tempFilePath, message.mediaBuffer);
                    
                    // Determine media type for WhatsApp
                    let whatsappMediaType: 'image' | 'video' | 'audio' | 'document' = 'document';
                    if (message.mediaType === 'photo') {
                        whatsappMediaType = 'image';
                    } else if (message.mediaType === 'video') {
                        whatsappMediaType = 'video';
                    } else if (message.mediaType === 'audio') {
                        whatsappMediaType = 'audio';
                    }
                    
                    // Send media to WhatsApp
                    await this.whatsappInstance.sendMediaToGroup(
                        rule.whatsappGroupId, 
                        tempFilePath, 
                        formattedMessage, // Use formatted message as caption
                        whatsappMediaType
                    );
                    
                    // Clean up temporary file
                    fs.unlinkSync(tempFilePath);
                    
                } catch (mediaError) {
                    console.error('Error handling media file:', mediaError);
                    // Fallback to text message mentioning media
                    formattedMessage += `\n\n📎 Media: ${message.mediaType || 'Unknown'} (failed to forward)`;
                    await this.whatsappInstance.sendMessageToGroup(rule.whatsappGroupId, formattedMessage);
                }
            } else {
                // Text-only message or media without buffer
                if (message.hasMedia) {
                    formattedMessage += `\n\n📎 Media: ${message.mediaType || 'Unknown'} (download failed)`;
                }
                
                // Send text message to WhatsApp group
                await this.whatsappInstance.sendMessageToGroup(rule.whatsappGroupId, formattedMessage);
            }
            
            console.log(`Forwarded message from ${message.channelTitle} to WhatsApp group via rule: ${rule.name}`);

        } catch (error) {
            console.error('Error forwarding message to WhatsApp:', error);
            throw error;
        }
    }
}

export default ForwardingManager;
