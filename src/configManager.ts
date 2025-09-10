import { database } from './db';

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
    // Add more configuration properties here as needed
}

class ConfigManager {
    private config: AppConfig;
    private readonly CONFIG_ID = 'app_config';
    private defaultConfig: AppConfig = {
        groupToSend: '',
        telegramListeningChannels: [],
        forwardingRules: [],
        autoStartForwarding: true
    };
    private initialized = false;

    constructor() {
        this.config = { ...this.defaultConfig };
    }

    /**
     * Initialize configuration - load from database
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;
        
        try {
            await this.loadConfig();
            this.initialized = true;
            console.log('ConfigManager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize ConfigManager:', error);
            // Continue with default config
            this.initialized = true;
        }
    }

    /**
     * Ensure the config manager is initialized
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    /**
     * Load configuration from database
     */
    private async loadConfig(): Promise<void> {
        try {
            const dbResult = await database('app_config');
            if (!dbResult) {
                console.log('Database not available, using default configuration');
                return;
            }

            const { conn, coll } = dbResult;
            
            try {
                const configDoc = await coll.findOne({ configId: this.CONFIG_ID });
                
                if (configDoc) {
                    // Convert date strings back to Date objects for forwarding rules
                    if (configDoc.forwardingRules) {
                        configDoc.forwardingRules = configDoc.forwardingRules.map((rule: any) => ({
                            ...rule,
                            createdAt: new Date(rule.createdAt),
                            lastModified: new Date(rule.lastModified)
                        }));
                    }
                    
                    // Merge with default config to ensure all properties exist
                    const config = { ...this.defaultConfig, ...configDoc };
                    delete (config as any).configId; // Remove configId field
                    delete (config as any).lastSaved; // Remove lastSaved field
                    
                    console.log('Configuration loaded from database');
                    this.config = config;
                } else {
                    console.log('Config document not found in database, creating with default configuration');
                    await this.saveConfig(); // Create the document with default config
                }
            } finally {
                await conn.close();
            }
        } catch (error) {
            console.error('Error loading configuration from database:', error);
            throw error;
        }
    }

    /**
     * Save configuration to database
     */
    private async saveConfig(): Promise<void> {
        try {
            const dbResult = await database('app_config');
            if (!dbResult) {
                console.error('Database not available, cannot save configuration');
                return;
            }

            const { conn, coll } = dbResult;
            
            try {
                const configToSave = {
                    configId: this.CONFIG_ID,
                    ...this.config,
                    lastSaved: new Date()
                };

                await coll.replaceOne(
                    { configId: this.CONFIG_ID }, 
                    configToSave, 
                    { upsert: true }
                );
                
                console.log('Configuration saved to database');
            } finally {
                await conn.close();
            }
        } catch (error) {
            console.error('Error saving configuration to database:', error);
            throw error;
        }
    }

    /**
     * Get the entire configuration object
     */
    public getConfig(): AppConfig {
        return { ...this.config };
    }

    /**
     * Get a specific configuration value
     */
    public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
        return this.config[key];
    }

    /**
     * Set a specific configuration value
     */
    public async set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
        this.config[key] = value;
        await this.saveConfig();
    }

    /**
     * Update multiple configuration values
     */
    public async update(updates: Partial<AppConfig>): Promise<void> {
        this.config = { ...this.config, ...updates };
        await this.saveConfig();
    }

    /**
     * Reset configuration to default values
     */
    public async reset(): Promise<void> {
        this.config = { ...this.defaultConfig };
        await this.saveConfig();
    }

    /**
     * Get group to send messages to
     */
    public getGroupToSend(): string {
        return this.config.groupToSend;
    }

    /**
     * Set group to send messages to
     */
    public async setGroupToSend(groupJid: string): Promise<void> {
        await this.set('groupToSend', groupJid);
    }

    /**
     * Get Telegram channels to listen to
     */
    public getTelegramListeningChannels(): string[] {
        return [...this.config.telegramListeningChannels];
    }

    /**
     * Set Telegram channels to listen to
     */
    public async setTelegramListeningChannels(channelIds: string[]): Promise<void> {
        channelIds = channelIds.map(id => id.startsWith('-') ? id : `-${id}`);
        await this.set('telegramListeningChannels', [...channelIds]);
    }

    /**
     * Add Telegram channel to listening list
     */
    public async addTelegramListeningChannel(channelId: string): Promise<void> {
        const currentChannels = this.getTelegramListeningChannels();
        if (!currentChannels.includes(channelId)) {
            currentChannels.push(channelId);
            await this.setTelegramListeningChannels(currentChannels);
        }
    }

    /**
     * Remove Telegram channel from listening list
     */
    public async removeTelegramListeningChannel(channelId: string): Promise<void> {
        const currentChannels = this.getTelegramListeningChannels();
        const filteredChannels = currentChannels.filter(id => id !== channelId);
        await this.setTelegramListeningChannels(filteredChannels);
    }

    // Forwarding Rules Management

    /**
     * Get all forwarding rules
     */
    public getForwardingRules(): ForwardingRule[] {
        return [...this.config.forwardingRules];
    }

    /**
     * Get active forwarding rules
     */
    public getActiveForwardingRules(): ForwardingRule[] {
        return this.config.forwardingRules.filter(rule => rule.isActive);
    }

    /**
     * Get forwarding rule by ID
     */
    public getForwardingRule(ruleId: string): ForwardingRule | null {
        return this.config.forwardingRules.find(rule => rule.id === ruleId) || null;
    }

    /**
     * Add a new forwarding rule
     */
    public async addForwardingRule(rule: Omit<ForwardingRule, 'id' | 'createdAt' | 'lastModified'>): Promise<ForwardingRule> {
        const newRule: ForwardingRule = {
            ...rule,
            id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            createdAt: new Date(),
            lastModified: new Date()
        };

        this.config.forwardingRules.push(newRule);
        await this.saveConfig();
        
        return newRule;
    }

    /**
     * Update an existing forwarding rule
     */
    public async updateForwardingRule(ruleId: string, updates: Partial<Omit<ForwardingRule, 'id' | 'createdAt'>>): Promise<ForwardingRule | null> {
        const ruleIndex = this.config.forwardingRules.findIndex(rule => rule.id === ruleId);
        
        if (ruleIndex === -1) {
            return null;
        }

        this.config.forwardingRules[ruleIndex] = {
            ...this.config.forwardingRules[ruleIndex],
            ...updates,
            lastModified: new Date()
        };

        await this.saveConfig();
        return this.config.forwardingRules[ruleIndex];
    }

    /**
     * Delete a forwarding rule
     */
    public async deleteForwardingRule(ruleId: string): Promise<boolean> {
        const initialLength = this.config.forwardingRules.length;
        this.config.forwardingRules = this.config.forwardingRules.filter(rule => rule.id !== ruleId);
        
        if (this.config.forwardingRules.length < initialLength) {
            await this.saveConfig();
            return true;
        }
        
        return false;
    }

    /**
     * Activate a forwarding rule
     */
    public async activateForwardingRule(ruleId: string): Promise<boolean> {
        const rule = this.getForwardingRule(ruleId);
        if (rule) {
            return !!(await this.updateForwardingRule(ruleId, { isActive: true }));
        }
        return false;
    }

    /**
     * Deactivate a forwarding rule
     */
    public async deactivateForwardingRule(ruleId: string): Promise<boolean> {
        const rule = this.getForwardingRule(ruleId);
        if (rule) {
            return !!(await this.updateForwardingRule(ruleId, { isActive: false }));
        }
        return false;
    }

    /**
     * Get auto start forwarding setting
     */
    public getAutoStartForwarding(): boolean {
        return this.config.autoStartForwarding;
    }

    /**
     * Set auto start forwarding setting
     */
    public async setAutoStartForwarding(autoStart: boolean): Promise<void> {
        await this.set('autoStartForwarding', autoStart);
    }

    /**
     * Get all unique Telegram channel IDs from active forwarding rules
     */
    public getAllActiveChannelIds(): string[] {
        const channelIds = new Set<string>();
        
        this.getActiveForwardingRules().forEach(rule => {
            rule.telegramChannelIds.forEach(channelId => {
                channelIds.add(channelId);
            });
        });

        return Array.from(channelIds);
    }

    /**
     * Get or create the main forwarding rule
     */
    public async getOrCreateMainForwardingRule(): Promise<ForwardingRule> {
        // Look for an existing main rule
        let mainRule = this.config.forwardingRules.find(rule => rule.name === 'Main Forwarding Rule');
        
        if (!mainRule) {
            // Create a new main rule
            mainRule = {
                id: `main_rule_${Date.now()}`,
                name: 'Main Forwarding Rule',
                telegramChannelIds: [...this.config.telegramListeningChannels],
                whatsappGroupId: this.config.groupToSend,
                isActive: true,
                createdAt: new Date(),
                lastModified: new Date()
            };
            
            // Remove all other rules and add the main rule
            this.config.forwardingRules = [mainRule];
            await this.saveConfig();
        }
        
        return mainRule;
    }

    /**
     * Update the main forwarding rule with current listening channels
     */
    public async syncMainForwardingRule(): Promise<void> {
        const mainRule = await this.getOrCreateMainForwardingRule();
        
        // Update the rule with current listening channels and target group
        await this.updateForwardingRule(mainRule.id, {
            telegramChannelIds: [...this.config.telegramListeningChannels],
            whatsappGroupId: this.config.groupToSend,
            lastModified: new Date()
        });
    }

    /**
     * Clean up duplicate rules and keep only the main rule
     */
    public async cleanupForwardingRules(): Promise<void> {
        // Keep only the main rule, deactivate others
        const mainRule = await this.getOrCreateMainForwardingRule();
        
        this.config.forwardingRules = this.config.forwardingRules.map(rule => {
            if (rule.id !== mainRule.id) {
                return { ...rule, isActive: false };
            }
            return rule;
        });
        
        // Remove inactive rules
        this.config.forwardingRules = this.config.forwardingRules.filter(rule => 
            rule.id === mainRule.id || rule.isActive
        );
        
        await this.saveConfig();
    }
}

// Create and export singleton instance
const configManager = new ConfigManager();

// Initialize the config manager
configManager.initialize().catch(error => {
    console.error('Failed to initialize config manager:', error);
});

export { configManager };
export default ConfigManager;
