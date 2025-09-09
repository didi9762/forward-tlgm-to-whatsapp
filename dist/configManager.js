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
exports.configManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ConfigManager {
    constructor(configPath = 'config.json') {
        this.defaultConfig = {
            groupToSend: '',
            telegramListeningChannels: [],
            forwardingRules: [],
            autoStartForwarding: true
        };
        this.configPath = path.resolve(configPath);
        this.config = this.loadConfig();
    }
    /**
     * Load configuration from JSON file
     */
    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const configData = fs.readFileSync(this.configPath, 'utf8');
                const parsedConfig = JSON.parse(configData);
                // Convert date strings back to Date objects for forwarding rules
                if (parsedConfig.forwardingRules) {
                    parsedConfig.forwardingRules = parsedConfig.forwardingRules.map((rule) => ({
                        ...rule,
                        createdAt: new Date(rule.createdAt),
                        lastModified: new Date(rule.lastModified)
                    }));
                }
                // Merge with default config to ensure all properties exist
                const config = { ...this.defaultConfig, ...parsedConfig };
                console.log('Configuration loaded from:', this.configPath);
                return config;
            }
            else {
                console.log('Config file not found, using default configuration');
                this.saveConfig(); // Create the file with default config
                return { ...this.defaultConfig };
            }
        }
        catch (error) {
            console.error('Error loading configuration:', error);
            console.log('Using default configuration');
            return { ...this.defaultConfig };
        }
    }
    /**
     * Save configuration to JSON file
     */
    saveConfig() {
        try {
            const configData = JSON.stringify(this.config, null, 2);
            fs.writeFileSync(this.configPath, configData, 'utf8');
            console.log('Configuration saved to:', this.configPath);
        }
        catch (error) {
            console.error('Error saving configuration:', error);
            throw error;
        }
    }
    /**
     * Get the entire configuration object
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get a specific configuration value
     */
    get(key) {
        return this.config[key];
    }
    /**
     * Set a specific configuration value
     */
    set(key, value) {
        this.config[key] = value;
        this.saveConfig();
    }
    /**
     * Update multiple configuration values
     */
    update(updates) {
        this.config = { ...this.config, ...updates };
        this.saveConfig();
    }
    /**
     * Reset configuration to default values
     */
    reset() {
        this.config = { ...this.defaultConfig };
        this.saveConfig();
    }
    /**
     * Get group to send messages to
     */
    getGroupToSend() {
        return this.config.groupToSend;
    }
    /**
     * Set group to send messages to
     */
    setGroupToSend(groupJid) {
        this.set('groupToSend', groupJid);
    }
    /**
     * Get Telegram channels to listen to
     */
    getTelegramListeningChannels() {
        return [...this.config.telegramListeningChannels];
    }
    /**
     * Set Telegram channels to listen to
     */
    setTelegramListeningChannels(channelIds) {
        channelIds = channelIds.map(id => id.startsWith('-') ? id : `-${id}`);
        this.set('telegramListeningChannels', [...channelIds]);
    }
    /**
     * Add Telegram channel to listening list
     */
    addTelegramListeningChannel(channelId) {
        const currentChannels = this.getTelegramListeningChannels();
        if (!currentChannels.includes(channelId)) {
            currentChannels.push(channelId);
            this.setTelegramListeningChannels(currentChannels);
        }
    }
    /**
     * Remove Telegram channel from listening list
     */
    removeTelegramListeningChannel(channelId) {
        const currentChannels = this.getTelegramListeningChannels();
        const filteredChannels = currentChannels.filter(id => id !== channelId);
        this.setTelegramListeningChannels(filteredChannels);
    }
    // Forwarding Rules Management
    /**
     * Get all forwarding rules
     */
    getForwardingRules() {
        return [...this.config.forwardingRules];
    }
    /**
     * Get active forwarding rules
     */
    getActiveForwardingRules() {
        return this.config.forwardingRules.filter(rule => rule.isActive);
    }
    /**
     * Get forwarding rule by ID
     */
    getForwardingRule(ruleId) {
        return this.config.forwardingRules.find(rule => rule.id === ruleId) || null;
    }
    /**
     * Add a new forwarding rule
     */
    addForwardingRule(rule) {
        const newRule = {
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
    updateForwardingRule(ruleId, updates) {
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
    deleteForwardingRule(ruleId) {
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
    activateForwardingRule(ruleId) {
        const rule = this.getForwardingRule(ruleId);
        if (rule) {
            return !!this.updateForwardingRule(ruleId, { isActive: true });
        }
        return false;
    }
    /**
     * Deactivate a forwarding rule
     */
    deactivateForwardingRule(ruleId) {
        const rule = this.getForwardingRule(ruleId);
        if (rule) {
            return !!this.updateForwardingRule(ruleId, { isActive: false });
        }
        return false;
    }
    /**
     * Get auto start forwarding setting
     */
    getAutoStartForwarding() {
        return this.config.autoStartForwarding;
    }
    /**
     * Set auto start forwarding setting
     */
    setAutoStartForwarding(autoStart) {
        this.set('autoStartForwarding', autoStart);
    }
    /**
     * Get all unique Telegram channel IDs from active forwarding rules
     */
    getAllActiveChannelIds() {
        const channelIds = new Set();
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
    getOrCreateMainForwardingRule() {
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
    syncMainForwardingRule() {
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
    cleanupForwardingRules() {
        // Keep only the main rule, deactivate others
        const mainRule = this.getOrCreateMainForwardingRule();
        this.config.forwardingRules = this.config.forwardingRules.map(rule => {
            if (rule.id !== mainRule.id) {
                return { ...rule, isActive: false };
            }
            return rule;
        });
        // Remove inactive rules
        this.config.forwardingRules = this.config.forwardingRules.filter(rule => rule.id === mainRule.id || rule.isActive);
        this.saveConfig();
    }
}
// Export singleton instance
exports.configManager = new ConfigManager();
exports.default = ConfigManager;
//# sourceMappingURL=configManager.js.map