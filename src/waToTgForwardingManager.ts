import { TelegramInstance } from './telegramInstance';
import { WhatsAppMessage } from './whatsappInstance';
import { WaToTgConfig, getActiveWaToTgConfigs, getWaToTgConfig } from './db';
import { database } from './db';
import { askModel } from './openRouter';
import fs from 'fs';
import path from 'path';
import { WhatsAppEngine } from './whatsappEngine';

export interface WaToTgForwardingSession {
    configId: string;
    handlerId: string;
    messageHandler: (message: WhatsAppMessage) => void;
    isActive: boolean;
}

class WaToTgForwardingManager {
    private telegramInstance: TelegramInstance;
    private whatsappInstance: WhatsAppEngine;
    private activeSessions: Map<string, WaToTgForwardingSession> = new Map();

    constructor(telegramInstance: TelegramInstance, whatsappInstance: WhatsAppEngine) {
        this.telegramInstance = telegramInstance;
        this.whatsappInstance = whatsappInstance;
    }

    private async getAISettings(): Promise<{ prompt: string; model: string; temperature: number } | null> {
        try {
            const dbResult = await database('system_prompts');
            if (!dbResult) return null;

            const { conn, coll } = dbResult;
            try {
                const settings = await coll.findOne({});
                if (settings && settings.prompt && settings.prompt.trim()) {
                    return {
                        prompt: settings.prompt,
                        model: settings.model || 'anthropic/claude-3.5-sonnet',
                        temperature: settings.temperature || 0.0
                    };
                }
                return null;
            } finally {
                await conn.close();
            }
        } catch (error) {
            console.error('Error getting AI settings:', error);
            return null;
        }
    }

    private async translateMessage(text: string, aiSettings: { prompt: string; model: string; temperature: number }): Promise<string> {
        try {
            const fullPrompt = `${aiSettings.prompt}\n\nMessage to translate: ${text}`;
            const translation = await askModel(fullPrompt, aiSettings.model, aiSettings.temperature);
            return translation || text;
        } catch (error) {
            console.error('Error translating message:', error);
            return text;
        }
    }

    public async startForwardingConfig(config: WaToTgConfig): Promise<boolean> {
        try {
            if (this.activeSessions.has(config.id)) {
                console.log(`WA→TG forwarding config ${config.id} is already active`);
                return true;
            }

            this.stopForwardingConfig(config.id);

            if (!this.whatsappInstance.isReady()) {
                console.error('WhatsApp client is not ready');
                return false;
            }

            if (!this.telegramInstance.isReady()) {
                console.error('Telegram client is not ready');
                return false;
            }

            this.whatsappInstance.startListeningToGroups(config.whatsappGroupIds);

            const messageHandler = async (message: WhatsAppMessage) => {
                if (config.whatsappGroupIds.includes(message.groupId)) {
                    try {
                        await this.forwardMessageToTelegram(message, config);
                        console.log(`[WA→TG] Message forwarded successfully`);
                    } catch (error) {
                        console.error(`[WA→TG] Error forwarding message from config ${config.id}:`, error);
                    }
                }
            };

            this.whatsappInstance.onMessage(messageHandler);

            const session: WaToTgForwardingSession = {
                configId: config.id,
                handlerId: `wa_tg_handler_${config.id}_${Date.now()}`,
                messageHandler,
                isActive: true
            };

            this.activeSessions.set(config.id, session);
            console.log(`[WA→TG] Started forwarding config: ${config.id}`);
            return true;

        } catch (error) {
            console.error(`[WA→TG] Error starting forwarding config ${config.id}:`, error);
            return false;
        }
    }

    public stopForwardingConfig(configId: string): boolean {
        try {
            const session = this.activeSessions.get(configId);
            if (!session) {
                return false;
            }

            this.whatsappInstance.removeMessageHandler(session.messageHandler);
            this.activeSessions.delete(configId);

            console.log(`[WA→TG] Stopped forwarding config: ${configId}`);
            return true;
        } catch (error) {
            console.error(`[WA→TG] Error stopping forwarding config ${configId}:`, error);
            return false;
        }
    }

    public async startAllActiveConfigs(): Promise<void> {
        try {
            const activeConfigs = await getActiveWaToTgConfigs();
            console.log(`[WA→TG] Starting ${activeConfigs.length} active forwarding configs...`);

            for (const config of activeConfigs) {
                await this.startForwardingConfig(config);
            }
        } catch (error) {
            console.error('[WA→TG] Error starting all active configs:', error);
        }
    }

    public stopAllConfigs(): void {
        console.log('[WA→TG] Stopping all forwarding configs...');
        for (const [configId] of this.activeSessions) {
            this.stopForwardingConfig(configId);
        }
        this.activeSessions.clear();
    }

    public async restartAllConfigs(): Promise<void> {
        this.stopAllConfigs();
        await this.startAllActiveConfigs();
    }

    public async getActiveSessionsInfo(): Promise<Array<{
        configId: string;
        handlerId: string;
        telegramChatId: string;
        whatsappGroupsCount: number;
    }>> {
        const result: Array<{
            configId: string;
            handlerId: string;
            telegramChatId: string;
            whatsappGroupsCount: number;
        }> = [];

        for (const [configId, session] of this.activeSessions) {
            const config = await getWaToTgConfig(configId);
            result.push({
                configId,
                handlerId: session.handlerId,
                telegramChatId: config?.telegramChatId || 'Unknown',
                whatsappGroupsCount: config?.whatsappGroupIds.length || 0
            });
        }

        return result;
    }

    public isConfigActive(configId: string): boolean {
        return this.activeSessions.has(configId);
    }

    private async forwardMessageToTelegram(message: WhatsAppMessage, config: WaToTgConfig): Promise<void> {
        try {
            const aiSettings = await this.getAISettings();

            let formattedMessage = `💬 *${message.groupName}*\n`;
            if (message.senderName) {
                formattedMessage += `👤 ${message.senderName}\n`;
            }

            if (message.text) {
                let messageText = message.text;
                if (aiSettings) {
                    console.log('[WA→TG] Translating message with AI...');
                    messageText = await this.translateMessage(messageText, aiSettings);
                }
                formattedMessage += `\n${messageText}`;
            }

            if (message.hasMedia && message.mediaBuffer) {
                try {
                    await this.telegramInstance.sendMediaToChat(
                        config.telegramChatId,
                        message.mediaBuffer,
                        message.mediaFileName || `media_${message.id}`,
                        message.mediaMimeType || 'application/octet-stream',
                        formattedMessage
                    );
                } catch (mediaError) {
                    console.error('[WA→TG] Error sending media to Telegram:', mediaError);
                    formattedMessage += `\n\n📎 Media: ${message.mediaType || 'Unknown'} (failed to forward)`;
                    await this.telegramInstance.sendMessageToChat(config.telegramChatId, formattedMessage);
                }
            } else {
                if (message.hasMedia) {
                    formattedMessage += `\n\n📎 Media: ${message.mediaType || 'Unknown'} (download failed)`;
                }
                await this.telegramInstance.sendMessageToChat(config.telegramChatId, formattedMessage);
            }
        } catch (error) {
            console.error('[WA→TG] Error forwarding message to Telegram:', error);
            throw error;
        }
    }
}

export default WaToTgForwardingManager;
