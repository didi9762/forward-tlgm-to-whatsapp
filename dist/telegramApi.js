"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const configManager_1 = require("./configManager");
const sharedInstances_1 = require("./sharedInstances");
const router = express_1.default.Router();
// Store for managing message listeners (legacy support)
const messageListeners = new Map();
// Auto-start forwarding when both clients are ready
let autoStartAttempted = false;
async function attemptAutoStart() {
    if (autoStartAttempted)
        return;
    if (sharedInstances_1.telegramInstance.isReady() && sharedInstances_1.whatsappInstance.isReady() && configManager_1.configManager.getAutoStartForwarding()) {
        autoStartAttempted = true;
        console.log('Both clients are ready, starting configured forwarding rules...');
        await sharedInstances_1.forwardingManager.startAllActiveRules();
    }
}
/**
 * Initialize Telegram client
 */
router.post('/initialize', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        if (sharedInstances_1.telegramInstance.isReady()) {
            // Try auto-start if not attempted yet
            await attemptAutoStart();
            return res.json({
                success: true,
                message: 'Telegram client is already initialized',
                clientInfo: await sharedInstances_1.telegramInstance.getClientInfo()
            });
        }
        await sharedInstances_1.telegramInstance.initialize(phoneNumber);
        const clientInfo = await sharedInstances_1.telegramInstance.getClientInfo();
        // Try auto-start after initialization
        await attemptAutoStart();
        res.json({
            success: true,
            message: 'Telegram client initialized successfully',
            clientInfo
        });
    }
    catch (error) {
        console.error('Error initializing Telegram:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Restart Telegram client
 */
router.post('/restart', async (req, res) => {
    try {
        // Stop all forwarding rules before restart
        sharedInstances_1.forwardingManager.stopAllRules();
        await sharedInstances_1.telegramInstance.restart();
        const clientInfo = await sharedInstances_1.telegramInstance.getClientInfo();
        // Restart forwarding rules after successful restart
        if (configManager_1.configManager.getAutoStartForwarding()) {
            await sharedInstances_1.forwardingManager.startAllActiveRules();
        }
        res.json({
            success: true,
            message: 'Telegram client restarted successfully',
            clientInfo
        });
    }
    catch (error) {
        console.error('Error restarting Telegram:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Get all channels and groups
 */
router.get('/channels', async (req, res) => {
    try {
        if (!sharedInstances_1.telegramInstance.isReady()) {
            return res.status(400).json({
                success: false,
                error: 'Telegram client is not initialized'
            });
        }
        const channels = await sharedInstances_1.telegramInstance.getChannelsAndGroups();
        res.json({
            success: true,
            channels,
            count: channels.length
        });
    }
    catch (error) {
        console.error('Error getting channels:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Start listening to specific channels
 */
router.post('/listen', async (req, res) => {
    try {
        const { channelIds } = req.body;
        if (!Array.isArray(channelIds)) {
            return res.status(400).json({
                success: false,
                error: 'channelIds must be an array'
            });
        }
        if (!sharedInstances_1.telegramInstance.isReady()) {
            return res.status(400).json({
                success: false,
                error: 'Telegram client is not initialized'
            });
        }
        await sharedInstances_1.telegramInstance.startListening(channelIds);
        res.json({
            success: true,
            message: `Started listening to ${channelIds.length} channels`,
            listeningChannels: sharedInstances_1.telegramInstance.getListeningChannels()
        });
    }
    catch (error) {
        console.error('Error starting to listen:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Stop listening to specific channels
 */
router.post('/stop-listening', (req, res) => {
    try {
        const { channelIds } = req.body;
        if (!Array.isArray(channelIds)) {
            return res.status(400).json({
                success: false,
                error: 'channelIds must be an array'
            });
        }
        sharedInstances_1.telegramInstance.stopListening(channelIds);
        res.json({
            success: true,
            message: `Stopped listening to ${channelIds.length} channels`,
            listeningChannels: sharedInstances_1.telegramInstance.getListeningChannels()
        });
    }
    catch (error) {
        console.error('Error stopping listening:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Get currently listening channels
 */
router.get('/listening', (req, res) => {
    try {
        const listeningChannels = sharedInstances_1.telegramInstance.getListeningChannels();
        res.json({
            success: true,
            listeningChannels,
            count: listeningChannels.length
        });
    }
    catch (error) {
        console.error('Error getting listening channels:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Find a channel by ID or name
 */
router.get('/channel/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;
        if (!sharedInstances_1.telegramInstance.isReady()) {
            return res.status(400).json({
                success: false,
                error: 'Telegram client is not initialized'
            });
        }
        const channel = await sharedInstances_1.telegramInstance.findChannel(identifier);
        if (!channel) {
            return res.status(404).json({
                success: false,
                error: 'Channel not found'
            });
        }
        res.json({
            success: true,
            channel
        });
    }
    catch (error) {
        console.error('Error finding channel:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Add a flag to track if restart has been attempted
let restartAttempted = false;
/**
 * Get client info
 */
router.get('/info', async (req, res) => {
    try {
        if (!sharedInstances_1.telegramInstance.isReady()) {
            return res.json({
                success: true,
                isReady: false,
                message: 'Telegram client is not initialized'
            });
        }
        // Check if client is connected before getting info
        try {
            const clientInfo = await sharedInstances_1.telegramInstance.getClientInfo();
            // Reset restart flag on successful connection
            restartAttempted = false;
            res.json({
                success: true,
                isReady: true,
                clientInfo
            });
        }
        catch (error) {
            // If we can't get client info, the client is not properly connected
            console.log('Client info unavailable, client may be disconnected:', error.message);
            // Auto-restart once if not already attempted
            if (!restartAttempted && error.message && error.message.includes('Cannot send requests while disconnected')) {
                restartAttempted = true;
                console.log('Attempting to restart Telegram client automatically...');
                try {
                    await sharedInstances_1.telegramInstance.restart();
                    console.log('Telegram client restarted successfully');
                    // Try to get client info again after restart
                    const clientInfo = await sharedInstances_1.telegramInstance.getClientInfo();
                    res.json({
                        success: true,
                        isReady: true,
                        clientInfo,
                        message: 'Client restarted automatically'
                    });
                    return;
                }
                catch (restartError) {
                    console.error('Failed to restart Telegram client:', restartError);
                }
            }
            res.json({
                success: true,
                isReady: false,
                message: 'Telegram client is not connected'
            });
        }
    }
    catch (error) {
        console.error('Error getting client info:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Create a new forwarding rule
 */
router.post('/forwarding/create', async (req, res) => {
    try {
        const { name, telegramChannelIds, whatsappGroupId, isActive = true } = req.body;
        if (!name || !Array.isArray(telegramChannelIds) || !whatsappGroupId) {
            return res.status(400).json({
                success: false,
                error: 'name, telegramChannelIds (array), and whatsappGroupId are required'
            });
        }
        const channelIds = telegramChannelIds.map(id => id.startsWith('-') ? id : `-${id}`);
        // Create the forwarding rule
        const newRule = configManager_1.configManager.addForwardingRule({
            name,
            telegramChannelIds: channelIds,
            whatsappGroupId,
            isActive
        });
        // Start the rule if it's active and clients are ready
        if (isActive && sharedInstances_1.telegramInstance.isReady() && sharedInstances_1.whatsappInstance.isReady()) {
            await sharedInstances_1.forwardingManager.startForwardingRule(newRule);
        }
        res.json({
            success: true,
            message: 'Forwarding rule created successfully',
            rule: newRule
        });
    }
    catch (error) {
        console.error('Error creating forwarding rule:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Get all forwarding rules
 */
router.get('/forwarding/rules', (req, res) => {
    try {
        const rules = configManager_1.configManager.getForwardingRules();
        const activeSessions = sharedInstances_1.forwardingManager.getActiveSessionsInfo();
        const rulesWithStatus = rules.map(rule => ({
            ...rule,
            isRunning: activeSessions.some(session => session.ruleId === rule.id)
        }));
        res.json({
            success: true,
            rules: rulesWithStatus,
            count: rules.length,
            activeCount: activeSessions.length
        });
    }
    catch (error) {
        console.error('Error getting forwarding rules:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Update a forwarding rule
 */
router.put('/forwarding/rules/:ruleId', async (req, res) => {
    try {
        const { ruleId } = req.params;
        const updates = req.body;
        const updatedRule = configManager_1.configManager.updateForwardingRule(ruleId, updates);
        if (!updatedRule) {
            return res.status(404).json({
                success: false,
                error: 'Forwarding rule not found'
            });
        }
        // Restart the rule if it's currently running
        if (sharedInstances_1.forwardingManager.isRuleActive(ruleId)) {
            sharedInstances_1.forwardingManager.stopForwardingRule(ruleId);
            if (updatedRule.isActive && sharedInstances_1.telegramInstance.isReady() && sharedInstances_1.whatsappInstance.isReady()) {
                await sharedInstances_1.forwardingManager.startForwardingRule(updatedRule);
            }
        }
        else if (updatedRule.isActive && sharedInstances_1.telegramInstance.isReady() && sharedInstances_1.whatsappInstance.isReady()) {
            // Start the rule if it wasn't running but is now active
            await sharedInstances_1.forwardingManager.startForwardingRule(updatedRule);
        }
        res.json({
            success: true,
            message: 'Forwarding rule updated successfully',
            rule: updatedRule
        });
    }
    catch (error) {
        console.error('Error updating forwarding rule:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Delete a forwarding rule
 */
router.delete('/forwarding/rules/:ruleId', (req, res) => {
    try {
        const { ruleId } = req.params;
        // Stop the rule if it's currently running
        if (sharedInstances_1.forwardingManager.isRuleActive(ruleId)) {
            sharedInstances_1.forwardingManager.stopForwardingRule(ruleId);
        }
        const deleted = configManager_1.configManager.deleteForwardingRule(ruleId);
        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: 'Forwarding rule not found'
            });
        }
        res.json({
            success: true,
            message: 'Forwarding rule deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting forwarding rule:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Start a specific forwarding rule
 */
router.post('/forwarding/rules/:ruleId/start', async (req, res) => {
    try {
        const { ruleId } = req.params;
        const rule = configManager_1.configManager.getForwardingRule(ruleId);
        if (!rule) {
            return res.status(404).json({
                success: false,
                error: 'Forwarding rule not found'
            });
        }
        if (!rule.isActive) {
            return res.status(400).json({
                success: false,
                error: 'Cannot start inactive forwarding rule'
            });
        }
        const started = await sharedInstances_1.forwardingManager.startForwardingRule(rule);
        res.json({
            success: started,
            message: started ? 'Forwarding rule started successfully' : 'Failed to start forwarding rule'
        });
    }
    catch (error) {
        console.error('Error starting forwarding rule:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Stop a specific forwarding rule
 */
router.post('/forwarding/rules/:ruleId/stop', (req, res) => {
    try {
        const { ruleId } = req.params;
        const stopped = sharedInstances_1.forwardingManager.stopForwardingRule(ruleId);
        res.json({
            success: stopped,
            message: stopped ? 'Forwarding rule stopped successfully' : 'Forwarding rule was not running'
        });
    }
    catch (error) {
        console.error('Error stopping forwarding rule:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Start all active forwarding rules
 */
router.post('/forwarding/start-all', async (req, res) => {
    try {
        // Check if clients are ready first
        if (!sharedInstances_1.telegramInstance.isReady()) {
            return res.status(400).json({
                success: false,
                error: 'Telegram client is not ready',
                telegramReady: false,
                whatsappReady: sharedInstances_1.whatsappInstance.isReady()
            });
        }
        if (!sharedInstances_1.whatsappInstance.isReady()) {
            return res.status(400).json({
                success: false,
                error: 'WhatsApp client is not ready',
                telegramReady: true,
                whatsappReady: false
            });
        }
        const activeRules = configManager_1.configManager.getActiveForwardingRules();
        console.log(`Attempting to start ${activeRules.length} active forwarding rules...`);
        if (activeRules.length === 0) {
            return res.json({
                success: false,
                error: 'No active forwarding rules found',
                activeSessions: [],
                telegramReady: true,
                whatsappReady: true
            });
        }
        let successCount = 0;
        const errors = [];
        for (const rule of activeRules) {
            console.log(`Starting rule: ${rule.name} (${rule.id})`);
            const started = await sharedInstances_1.forwardingManager.startForwardingRule(rule);
            if (started) {
                successCount++;
                console.log(`✅ Successfully started rule: ${rule.name}`);
            }
            else {
                const error = `Failed to start rule: ${rule.name}`;
                console.error(`❌ ${error}`);
                errors.push(error);
            }
        }
        // Update Telegram listening channels based on all active rules
        const allChannelIds = configManager_1.configManager.getAllActiveChannelIds();
        if (allChannelIds.length > 0) {
            configManager_1.configManager.setTelegramListeningChannels(allChannelIds);
        }
        const activeSessions = sharedInstances_1.forwardingManager.getActiveSessionsInfo();
        console.log(`Forwarding start complete. Success: ${successCount}/${activeRules.length}, Active sessions: ${activeSessions.length}`);
        if (successCount > 0) {
            res.json({
                success: true,
                message: `Started ${successCount}/${activeRules.length} forwarding rules`,
                activeSessions,
                successCount,
                totalRules: activeRules.length,
                errors: errors.length > 0 ? errors : undefined
            });
        }
        else {
            res.status(400).json({
                success: false,
                error: `Failed to start any forwarding rules. Errors: ${errors.join(', ')}`,
                activeSessions,
                successCount: 0,
                totalRules: activeRules.length,
                errors
            });
        }
    }
    catch (error) {
        console.error('Error starting all forwarding rules:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Stop all forwarding rules
 */
router.post('/forwarding/stop-all', (req, res) => {
    try {
        sharedInstances_1.forwardingManager.stopAllRules();
        res.json({
            success: true,
            message: 'All forwarding rules stopped'
        });
    }
    catch (error) {
        console.error('Error stopping all forwarding rules:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Get forwarding status
 */
router.get('/forwarding/status', (req, res) => {
    try {
        const activeSessions = sharedInstances_1.forwardingManager.getActiveSessionsInfo();
        const activeRules = configManager_1.configManager.getActiveForwardingRules();
        res.json({
            success: true,
            isForwarding: activeSessions.length > 0,
            activeSessions,
            totalActiveRules: activeRules.length,
            telegramReady: sharedInstances_1.telegramInstance.isReady(),
            whatsappReady: sharedInstances_1.whatsappInstance.isReady(),
            autoStartEnabled: configManager_1.configManager.getAutoStartForwarding()
        });
    }
    catch (error) {
        console.error('Error getting forwarding status:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Cleanup forwarding rules - remove duplicates and sync with listening channels
 */
router.post('/forwarding/cleanup', async (req, res) => {
    try {
        // Clean up duplicate rules and create/update main rule
        configManager_1.configManager.cleanupForwardingRules();
        res.json({
            success: true,
            message: 'Forwarding rules cleaned up successfully'
        });
    }
    catch (error) {
        console.error('Error cleaning up forwarding rules:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Setup message forwarding to WhatsApp (legacy - now creates a forwarding rule)
 */
router.post('/setup-forwarding', async (req, res) => {
    try {
        const { channelIds, whatsappGroupId, ruleName } = req.body;
        if (!Array.isArray(channelIds) || !whatsappGroupId) {
            return res.status(400).json({
                success: false,
                error: 'channelIds (array) and whatsappGroupId are required'
            });
        }
        const telegramChannelIds = channelIds.map(id => id.startsWith('-') ? id : `-${id}`);
        // Create a new forwarding rule
        const newRule = configManager_1.configManager.addForwardingRule({
            name: ruleName || `Legacy Rule ${Date.now()}`,
            telegramChannelIds: telegramChannelIds,
            whatsappGroupId,
            isActive: true
        });
        // Start the rule if clients are ready
        if (sharedInstances_1.telegramInstance.isReady() && sharedInstances_1.whatsappInstance.isReady()) {
            await sharedInstances_1.forwardingManager.startForwardingRule(newRule);
        }
        res.json({
            success: true,
            message: `Setup forwarding from ${channelIds.length} Telegram channels to WhatsApp group`,
            ruleId: newRule.id,
            handlerId: `rule_${newRule.id}`, // For legacy compatibility
            listeningChannels: sharedInstances_1.telegramInstance.getListeningChannels()
        });
    }
    catch (error) {
        console.error('Error setting up forwarding:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Stop message forwarding (legacy)
 */
router.post('/stop-forwarding', (req, res) => {
    try {
        const { handlerId, ruleId } = req.body;
        if (!handlerId && !ruleId) {
            return res.status(400).json({
                success: false,
                error: 'handlerId or ruleId is required'
            });
        }
        let stopped = false;
        // Handle legacy handlerId format
        if (handlerId && handlerId.startsWith('rule_')) {
            const extractedRuleId = handlerId.replace('rule_', '');
            stopped = sharedInstances_1.forwardingManager.stopForwardingRule(extractedRuleId);
        }
        else if (ruleId) {
            stopped = sharedInstances_1.forwardingManager.stopForwardingRule(ruleId);
        }
        else {
            // Legacy handler - try to find in old messageListeners
            const handler = messageListeners.get(handlerId);
            if (handler) {
                sharedInstances_1.telegramInstance.removeMessageHandler(handler);
                messageListeners.delete(handlerId);
                stopped = true;
            }
        }
        res.json({
            success: stopped,
            message: stopped ? 'Stopped message forwarding' : 'No active forwarding found with provided ID'
        });
    }
    catch (error) {
        console.error('Error stopping forwarding:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Reset Telegram client (delete session)
 */
router.post('/reset', async (req, res) => {
    try {
        // Stop all forwarding rules before reset
        sharedInstances_1.forwardingManager.stopAllRules();
        await sharedInstances_1.telegramInstance.reset();
        // Clear all legacy message listeners
        messageListeners.clear();
        // Reset auto-start flag
        autoStartAttempted = false;
        restartAttempted = false;
        res.json({
            success: true,
            message: 'Telegram client reset successfully. Session deleted.'
        });
    }
    catch (error) {
        console.error('Error resetting Telegram:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Disconnect Telegram client
 */
router.post('/disconnect', async (req, res) => {
    try {
        // Stop all forwarding rules before disconnect
        sharedInstances_1.forwardingManager.stopAllRules();
        await sharedInstances_1.telegramInstance.disconnect();
        // Clear all legacy message listeners
        messageListeners.clear();
        res.json({
            success: true,
            message: 'Telegram client disconnected successfully'
        });
    }
    catch (error) {
        console.error('Error disconnecting Telegram:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Submit phone verification code
 */
router.post('/submit-code', (req, res) => {
    try {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Verification code is required'
            });
        }
        sharedInstances_1.telegramInstance.submitPhoneCode(code);
        res.json({
            success: true,
            message: 'Verification code submitted'
        });
    }
    catch (error) {
        console.error('Error submitting code:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Submit 2FA password
 */
router.post('/submit-password', (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({
                success: false,
                error: '2FA password is required'
            });
        }
        sharedInstances_1.telegramInstance.submitPassword(password);
        res.json({
            success: true,
            message: '2FA password submitted'
        });
    }
    catch (error) {
        console.error('Error submitting password:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Get authentication status
 */
router.get('/auth-status', (req, res) => {
    try {
        res.json({
            success: true,
            isAuthenticating: sharedInstances_1.telegramInstance.checkIsAuthenticating(),
            isWaitingForPhoneCode: sharedInstances_1.telegramInstance.isWaitingForPhoneCode(),
            isWaitingForPassword: sharedInstances_1.telegramInstance.isWaitingForPassword(),
            isReady: sharedInstances_1.telegramInstance.isReady()
        });
    }
    catch (error) {
        console.error('Error getting auth status:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
exports.default = router;
//# sourceMappingURL=telegramApi.js.map