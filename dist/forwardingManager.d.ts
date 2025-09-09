import { TelegramInstance, TelegramMessage } from './telegramInstance';
import { WhatsAppInstance } from './whatsappInstance';
import { ForwardingRule } from './configManager';
export interface ForwardingSession {
    ruleId: string;
    handlerId: string;
    messageHandler: (message: TelegramMessage) => void;
    isActive: boolean;
}
declare class ForwardingManager {
    private telegramInstance;
    private whatsappInstance;
    private activeSessions;
    constructor(telegramInstance: TelegramInstance, whatsappInstance: WhatsAppInstance);
    /**
     * Start forwarding based on a specific rule
     */
    startForwardingRule(rule: ForwardingRule): Promise<boolean>;
    /**
     * Stop forwarding for a specific rule
     */
    stopForwardingRule(ruleId: string): boolean;
    /**
     * Start all active forwarding rules
     */
    startAllActiveRules(): Promise<void>;
    /**
     * Stop all active forwarding rules
     */
    stopAllRules(): void;
    /**
     * Restart all active forwarding rules
     */
    restartAllRules(): Promise<void>;
    /**
     * Get active sessions info
     */
    getActiveSessionsInfo(): Array<{
        ruleId: string;
        handlerId: string;
        ruleName: string;
    }>;
    /**
     * Check if a rule is currently active
     */
    isRuleActive(ruleId: string): boolean;
    /**
     * Forward a Telegram message to WhatsApp
     */
    private forwardMessageToWhatsApp;
}
export default ForwardingManager;
//# sourceMappingURL=forwardingManager.d.ts.map