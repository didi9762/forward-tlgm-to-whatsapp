import { TelegramInstance, TelegramMessage } from './telegramInstance';
import { WhatsAppInstance } from './whatsappInstance';
import { ListeningConfig } from './db';
import fs from 'fs';
import path from 'path';
import { getListeningConfig, getActiveListeningConfigs } from './db';

export interface ForwardingSession {
    configId: string;
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
     * Start forwarding based on a specific config
     */
    public async startForwardingConfig(config: ListeningConfig): Promise<boolean> {
        try {
            // Check if config is already active
            if (this.activeSessions.has(config.id)) {
                console.log(`Forwarding config ${config.id} is already active`);
                return true;
            }

            // CRITICAL FIX: Stop any existing config first to prevent handler accumulation
            this.stopForwardingConfig(config.id);

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

            // Start listening to the channels in this config
            await this.telegramInstance.startListening(config.telegramChannelIds);

            // Create message handler for this config
            const messageHandler = async (message: TelegramMessage) => {
                // console.log(`ForwardingManager: Checking message from channel ${message.channelId}`);
                // console.log(`ForwardingManager: Config sources:`, config.telegramChannelIds);
                
                // Check if this message is from one of the sources in this config
                const fixedId = message.channelId.startsWith('-100')?message.channelId.replace('-100', ''):message.channelId.replace('-', '');
                if (config.telegramChannelIds.includes(fixedId)) {
                    // console.log(`ForwardingManager: Message matches config ${config.id}, forwarding to WhatsApp`);
                    try {
                        await this.forwardMessageToWhatsApp(message, config);
                        console.log(`ForwardingManager: Message forwarded successfully`);
                    } catch (error) {
                        console.error(`Error forwarding message from config ${config.id}:`, error);
                    }
                } else {
                    console.log(`ForwardingManager: Message does not match config ${config.id}`);
                }
            };

            // Add the handler to Telegram instance
            this.telegramInstance.onMessage(messageHandler);

            // Create session record
            const session: ForwardingSession = {
                configId: config.id,
                handlerId: `handler_${config.id}_${Date.now()}`,
                messageHandler,
                isActive: true
            };

            this.activeSessions.set(config.id, session);

            console.log(`Started forwarding config: ${config.id}`);
            return true;

        } catch (error) {
            console.error(`Error starting forwarding config ${config.id}:`, error);
            return false;
        }
    }

    /**
     * Stop forwarding for a specific config
     */
    public stopForwardingConfig(configId: string): boolean {
        try {
            const session = this.activeSessions.get(configId);
            if (!session) {
                console.log(`No active session found for config ${configId}`);
                return false;
            }

            // Remove message handler
            this.telegramInstance.removeMessageHandler(session.messageHandler);

            // Remove session
            this.activeSessions.delete(configId);

            console.log(`Stopped forwarding config: ${configId}`);
            return true;

        } catch (error) {
            console.error(`Error stopping forwarding config ${configId}:`, error);
            return false;
        }
    }

    /**
     * Start all active forwarding configs
     */
    public async startAllActiveConfigs(): Promise<void> {
        const activeConfigs = await getActiveListeningConfigs();
        
        console.log(`Starting ${activeConfigs.length} active forwarding configs...`);

        for (const config of activeConfigs) {
            await this.startForwardingConfig(config);
        }

        // Update Telegram listening channels based on all active configs
        const allChannelIds = this.getAllActiveTelegramSources(activeConfigs);
        if (allChannelIds.length > 0) {
            console.log(`Updated Telegram listening to ${allChannelIds.length} sources`);
        }
    }

    /**
     * Stop all active forwarding configs
     */
    public stopAllConfigs(): void {
        console.log('Stopping all forwarding configs...');
        
        for (const [configId] of this.activeSessions) {
            this.stopForwardingConfig(configId);
        }

        this.activeSessions.clear();
    }

    /**
     * Restart all active forwarding configs
     */
    public async restartAllConfigs(): Promise<void> {
        this.stopAllConfigs();
        await this.startAllActiveConfigs();
    }

    /**
     * Get active sessions info
     */
    public async getActiveSessionsInfo(): Promise<Array<{configId: string, handlerId: string, whatsappGroupId: string, telegramSourcesCount: number}>> {
        const result: Array<{configId: string, handlerId: string, whatsappGroupId: string, telegramSourcesCount: number}> = [];
        
        for (const [configId, session] of this.activeSessions) {
            const config = await getListeningConfig(configId);
            result.push({
                configId,
                handlerId: session.handlerId,
                whatsappGroupId: config?.whatsappGroupId || 'Unknown',
                telegramSourcesCount: config?.telegramChannelIds.length || 0
            });
        }

        return result;
    }

    /**
     * Check if a config is currently active
     */
    public isConfigActive(configId: string): boolean {
        return this.activeSessions.has(configId);
    }

    /**
     * Get all active Telegram sources from configs
     */
    private getAllActiveTelegramSources(configs: ListeningConfig[]): string[] {
        const allSources = new Set<string>();
        
        configs.forEach(config => {
            config.telegramChannelIds.forEach(source => {
                allSources.add(source);
            });
        });
        
        return Array.from(allSources);
    }

    /**
     * Forward a Telegram message to WhatsApp
     */
    private async forwardMessageToWhatsApp(message: TelegramMessage, config: ListeningConfig): Promise<void> {
        try {
            // Format the message for WhatsApp
            let formattedMessage = `📢 *${message.channelTitle}*\n`;
            
            // if (message.senderName) {
            //     formattedMessage += `👤 ${message.senderName}\n`;
            // }
            
            // if (message.isForwarded && message.forwardedFrom) {
            //     formattedMessage += `🔄 Forwarded from: ${message.forwardedFrom}\n`;
            // }
            
            if (message.text) {
                formattedMessage += `\n${message.text}`;
            }

            // Handle media messages
            if (message.hasMedia && message.mediaBuffer) {
                console.log(`[ForwardingManager] Forwarding media: ${message.mediaFileName}`);
                
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
                        config.whatsappGroupId, 
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
                    await this.whatsappInstance.sendMessageToGroup(config.whatsappGroupId, formattedMessage);
                }
            } else {
                // Text-only message or media without buffer
                if (message.hasMedia) {
                    formattedMessage += `\n\n📎 Media: ${message.mediaType || 'Unknown'} (download failed)`;
                }
                
                // Send text message to WhatsApp group
                await this.whatsappInstance.sendMessageToGroup(config.whatsappGroupId, formattedMessage);
            }
            
            // console.log(`Forwarded message from ${message.channelTitle} to WhatsApp group via config: ${config.id}`);

        } catch (error) {
            console.error('Error forwarding message to WhatsApp:', error);
            throw error;
        }
    }
}

export default ForwardingManager;
