export interface ForwardingRule {
    id: string;
    name: string;
    telegramChannelIds: string[];
    whatsappGroupId: string;
    isActive: boolean;
    createdAt: Date;
    lastModified: Date;
}
export interface AppConfig {
    groupToSend: string;
    telegramListeningChannels: string[];
    forwardingRules: ForwardingRule[];
    autoStartForwarding: boolean;
}
declare class ConfigManager {
    private config;
    private configPath;
    private defaultConfig;
    constructor(configPath?: string);
    /**
     * Load configuration from JSON file
     */
    private loadConfig;
    /**
     * Save configuration to JSON file
     */
    private saveConfig;
    /**
     * Get the entire configuration object
     */
    getConfig(): AppConfig;
    /**
     * Get a specific configuration value
     */
    get<K extends keyof AppConfig>(key: K): AppConfig[K];
    /**
     * Set a specific configuration value
     */
    set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void;
    /**
     * Update multiple configuration values
     */
    update(updates: Partial<AppConfig>): void;
    /**
     * Reset configuration to default values
     */
    reset(): void;
    /**
     * Get group to send messages to
     */
    getGroupToSend(): string;
    /**
     * Set group to send messages to
     */
    setGroupToSend(groupJid: string): void;
    /**
     * Get Telegram channels to listen to
     */
    getTelegramListeningChannels(): string[];
    /**
     * Set Telegram channels to listen to
     */
    setTelegramListeningChannels(channelIds: string[]): void;
    /**
     * Add Telegram channel to listening list
     */
    addTelegramListeningChannel(channelId: string): void;
    /**
     * Remove Telegram channel from listening list
     */
    removeTelegramListeningChannel(channelId: string): void;
    /**
     * Get all forwarding rules
     */
    getForwardingRules(): ForwardingRule[];
    /**
     * Get active forwarding rules
     */
    getActiveForwardingRules(): ForwardingRule[];
    /**
     * Get forwarding rule by ID
     */
    getForwardingRule(ruleId: string): ForwardingRule | null;
    /**
     * Add a new forwarding rule
     */
    addForwardingRule(rule: Omit<ForwardingRule, 'id' | 'createdAt' | 'lastModified'>): ForwardingRule;
    /**
     * Update an existing forwarding rule
     */
    updateForwardingRule(ruleId: string, updates: Partial<Omit<ForwardingRule, 'id' | 'createdAt'>>): ForwardingRule | null;
    /**
     * Delete a forwarding rule
     */
    deleteForwardingRule(ruleId: string): boolean;
    /**
     * Activate a forwarding rule
     */
    activateForwardingRule(ruleId: string): boolean;
    /**
     * Deactivate a forwarding rule
     */
    deactivateForwardingRule(ruleId: string): boolean;
    /**
     * Get auto start forwarding setting
     */
    getAutoStartForwarding(): boolean;
    /**
     * Set auto start forwarding setting
     */
    setAutoStartForwarding(autoStart: boolean): void;
    /**
     * Get all unique Telegram channel IDs from active forwarding rules
     */
    getAllActiveChannelIds(): string[];
    /**
     * Get or create the main forwarding rule
     */
    getOrCreateMainForwardingRule(): ForwardingRule;
    /**
     * Update the main forwarding rule with current listening channels
     */
    syncMainForwardingRule(): void;
    /**
     * Clean up duplicate rules and keep only the main rule
     */
    cleanupForwardingRules(): void;
}
export declare const configManager: ConfigManager;
export default ConfigManager;
//# sourceMappingURL=configManager.d.ts.map