import * as fs from 'fs';
import * as path from 'path';

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
    private configPath: string;
    private defaultConfig: AppConfig = {
        groupToSend: '',
        telegramListeningChannels: [],
        forwardingRules: [],
        autoStartForwarding: true
    };

    constructor(configPath: string = 'config.json') {
        this.configPath = path.resolve(configPath);
        this.config = this.loadConfig();
    }

    /**
     * Load configuration from JSON file
     */
    private loadConfig(): AppConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                const configData = fs.readFileSync(this.configPath, 'utf8');
                const parsedConfig = JSON.parse(configData);
                
                // Convert date strings back to Date objects for forwarding rules
                if (parsedConfig.forwardingRules) {
                    parsedConfig.forwardingRules = parsedConfig.forwardingRules.map((rule: any) => ({
                        ...rule,
                        createdAt: new Date(rule.createdAt),
                        lastModified: new Date(rule.lastModified)
                    }));
                }
                
                // Merge with default config to ensure all properties exist
                const config = { ...this.defaultConfig, ...parsedConfig };
                
                console.log('Configuration loaded from:', this.configPath);
                return config;
            } else {
                console.log('Config file not found, using default configuration');
                this.saveConfig(); // Create the file with default config
                return { ...this.defaultConfig };
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            console.log('Using default configuration');
            return { ...this.defaultConfig };
        }
    }

    /**
     * Save configuration to JSON file
     */
    private saveConfig(): void {
        try {
            const configData = JSON.stringify(this.config, null, 2);
            fs.writeFileSync(this.configPath, configData, 'utf8');
            console.log('Configuration saved to:', this.configPath);
        } catch (error) {
            console.error('Error saving configuration:', error);
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
    public set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
        this.config[key] = value;
        this.saveConfig();
    }

    /**
     * Update multiple configuration values
     */
    public update(updates: Partial<AppConfig>): void {
        this.config = { ...this.config, ...updates };
        this.saveConfig();
    }

    /**
     * Reset configuration to default values
     */
    public reset(): void {
        this.config = { ...this.defaultConfig };
        this.saveConfig();
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
    public setGroupToSend(groupJid: string): void {
        this.set('groupToSend', groupJid);
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
    public setTelegramListeningChannels(channelIds: string[]): void {
        channelIds = channelIds.map(id => id.startsWith('-') ? id : `-${id}`);
        this.set('telegramListeningChannels', [...channelIds]);
    }

    /**
     * Add Telegram channel to listening list
     */
    public addTelegramListeningChannel(channelId: string): void {
        const currentChannels = this.getTelegramListeningChannels();
        if (!currentChannels.includes(channelId)) {
            currentChannels.push(channelId);
            this.setTelegramListeningChannels(currentChannels);
        }
    }

    /**
     * Remove Telegram channel from listening list
     */
    public removeTelegramListeningChannel(channelId: string): void {
        const currentChannels = this.getTelegramListeningChannels();
        const filteredChannels = currentChannels.filter(id => id !== channelId);
        this.setTelegramListeningChannels(filteredChannels);
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
    public addForwardingRule(rule: Omit<ForwardingRule, 'id' | 'createdAt' | 'lastModified'>): ForwardingRule {
        const newRule: ForwardingRule = {
            ...rule,
            id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            createdAt: new Date(),
            lastModified: new Date()
        };

        this.config.forwardingRules.push(newRule);
        this.saveConfig();
        
        return newRule;
    }

    /**
     * Update an existing forwarding rule
     */
    public updateForwardingRule(ruleId: string, updates: Partial<Omit<ForwardingRule, 'id' | 'createdAt'>>): ForwardingRule | null {
        const ruleIndex = this.config.forwardingRules.findIndex(rule => rule.id === ruleId);
        
        if (ruleIndex === -1) {
            return null;
        }

        this.config.forwardingRules[ruleIndex] = {
            ...this.config.forwardingRules[ruleIndex],
            ...updates,
            lastModified: new Date()
        };

        this.saveConfig();
        return this.config.forwardingRules[ruleIndex];
    }

    /**
     * Delete a forwarding rule
     */
    public deleteForwardingRule(ruleId: string): boolean {
        const initialLength = this.config.forwardingRules.length;
        this.config.forwardingRules = this.config.forwardingRules.filter(rule => rule.id !== ruleId);
        
        if (this.config.forwardingRules.length < initialLength) {
            this.saveConfig();
            return true;
        }
        
        return false;
    }

    /**
     * Activate a forwarding rule
     */
    public activateForwardingRule(ruleId: string): boolean {
        const rule = this.getForwardingRule(ruleId);
        if (rule) {
            return !!this.updateForwardingRule(ruleId, { isActive: true });
        }
        return false;
    }

    /**
     * Deactivate a forwarding rule
     */
    public deactivateForwardingRule(ruleId: string): boolean {
        const rule = this.getForwardingRule(ruleId);
        if (rule) {
            return !!this.updateForwardingRule(ruleId, { isActive: false });
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
    public setAutoStartForwarding(autoStart: boolean): void {
        this.set('autoStartForwarding', autoStart);
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
    public getOrCreateMainForwardingRule(): ForwardingRule {
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
            this.saveConfig();
        }
        
        return mainRule;
    }

    /**
     * Update the main forwarding rule with current listening channels
     */
    public syncMainForwardingRule(): void {
        const mainRule = this.getOrCreateMainForwardingRule();
        
        // Update the rule with current listening channels and target group
        this.updateForwardingRule(mainRule.id, {
            telegramChannelIds: [...this.config.telegramListeningChannels],
            whatsappGroupId: this.config.groupToSend,
            lastModified: new Date()
        });
    }

    /**
     * Clean up duplicate rules and keep only the main rule
     */
    public cleanupForwardingRules(): void {
        // Keep only the main rule, deactivate others
        const mainRule = this.getOrCreateMainForwardingRule();
        
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
        
        this.saveConfig();
    }
}

// Export singleton instance
export const configManager = new ConfigManager();
export default ConfigManager;
