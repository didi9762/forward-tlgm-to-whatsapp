import { database } from './db';

export interface AppConfig {
    whatsappGroupId: string;
    telegramChannelIds: string[];
    isActive: boolean;
    createdAt: Date;
    lastModified: Date;
}

class ConfigManager {
    private config: AppConfig;
    private readonly CONFIG_ID = 'app_config';
    private defaultConfig: AppConfig = {
        whatsappGroupId: '',
        telegramChannelIds: [],
        isActive: true,
        createdAt: new Date(),
        lastModified: new Date()
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
                    // Convert date strings back to Date objects
                    const config = {
                        ...this.defaultConfig,
                        ...configDoc,
                        createdAt: new Date(configDoc.createdAt),
                        lastModified: new Date(configDoc.lastModified)
                    };
                    delete (config as any).configId;
                    delete (config as any).lastSaved;
                    delete (config as any)._id;
                    
                    console.log('Configuration loaded from database');
                    this.config = config;
                } else {
                    console.log('Config document not found in database, creating with default configuration');
                    await this.saveConfig();
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
    public async getConfig(): Promise<AppConfig> {
        await this.ensureInitialized();
        return { ...this.config };
    }

    /**
     * Get the entire configuration object (synchronous)
     */
    public getConfigSync(): AppConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    public async updateConfig(updates: Partial<Omit<AppConfig, 'createdAt'>>): Promise<void> {
        await this.ensureInitialized();
        this.config = {
            ...this.config,
            ...updates,
            lastModified: new Date()
        };
        await this.saveConfig();
    }

    /**
     * Get WhatsApp group ID
     */
    public getWhatsAppGroupId(): string {
        return this.config.whatsappGroupId;
    }

    /**
     * Set WhatsApp group ID
     */
    public async setWhatsAppGroupId(groupId: string): Promise<void> {
        await this.updateConfig({ whatsappGroupId: groupId });
    }

    /**
     * Get Telegram channel IDs
     */
    public getTelegramChannelIds(): string[] {
        return [...this.config.telegramChannelIds];
    }

    /**
     * Set Telegram channel IDs
     */
    public async setTelegramChannelIds(channelIds: string[]): Promise<void> {
        const formattedIds = channelIds.map(id => id.startsWith('-') ? id : `-${id}`);
        await this.updateConfig({ telegramChannelIds: formattedIds });
    }

    /**
     * Add Telegram channel ID
     */
    public async addTelegramChannelId(channelId: string): Promise<void> {
        const formattedId = channelId.startsWith('-') ? channelId : `-${channelId}`;
        const currentIds = this.getTelegramChannelIds();
        if (!currentIds.includes(formattedId)) {
            currentIds.push(formattedId);
            await this.setTelegramChannelIds(currentIds);
        }
    }

    /**
     * Remove Telegram channel ID
     */
    public async removeTelegramChannelId(channelId: string): Promise<void> {
        const currentIds = this.getTelegramChannelIds();
        const filteredIds = currentIds.filter(id => id !== channelId);
        await this.setTelegramChannelIds(filteredIds);
    }

    /**
     * Check if configuration is active
     */
    public isActive(): boolean {
        return this.config.isActive;
    }

    /**
     * Set configuration active/inactive
     */
    public async setActive(active: boolean): Promise<void> {
        await this.updateConfig({ isActive: active });
    }

    /**
     * Reset configuration to default values
     */
    public async reset(): Promise<void> {
        await this.ensureInitialized();
        this.config = { 
            ...this.defaultConfig,
            createdAt: new Date(),
            lastModified: new Date()
        };
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
