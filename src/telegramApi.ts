import express from 'express';
import { TelegramMessage } from './telegramInstance';
import { configManager } from './configManager';
import { telegramInstance, whatsappInstance, forwardingManager } from './sharedInstances';
import { ListeningConfig } from './db';
import { 
  saveListeningConfig, 
  updateListeningConfig, 
  getListeningConfig, 
  getAllListeningConfigs, 
  getActiveListeningConfigs, 
  deleteListeningConfig 
} from './db';

const router = express.Router();

// Store for managing message listeners (legacy support)
const messageListeners: Map<string, (message: TelegramMessage) => void> = new Map();

// Auto-start forwarding when both clients are ready
let autoStartAttempted = false;
let autoStartInProgress = false; // Add this flag

async function attemptAutoStart() {
    if (autoStartAttempted || autoStartInProgress) return;
    
    if (telegramInstance.isReady() && whatsappInstance.isReady() && configManager.getAutoStartForwarding()) {
        autoStartInProgress = true; // Set flag to prevent concurrent starts
        autoStartAttempted = true;
        console.log('Both clients are ready, starting configured forwarding rules...');
        try {
            await forwardingManager.startAllActiveConfigs();
        } finally {
            autoStartInProgress = false; // Reset flag
        }
    }
}

/**
 * Initialize Telegram client
 */
router.post('/initialize', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (telegramInstance.isReady()) {
            // Try auto-start if not attempted yet
            await attemptAutoStart();
            
            return res.json({ 
                success: true, 
                message: 'Telegram client is already initialized',
                clientInfo: await telegramInstance.getClientInfo()
            });
        }

        await telegramInstance.initialize(phoneNumber);
        const clientInfo = await telegramInstance.getClientInfo();
        
        // Try auto-start after initialization
        await attemptAutoStart();
        
        res.json({ 
            success: true, 
            message: 'Telegram client initialized successfully',
            clientInfo
        });
    } catch (error) {
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
        forwardingManager.stopAllConfigs();
        
        await telegramInstance.restart();
        const clientInfo = await telegramInstance.getClientInfo();
        
        // Restart forwarding rules after successful restart
        if (configManager.getAutoStartForwarding()) {
            await forwardingManager.startAllActiveConfigs();
        }
        
        res.json({ 
            success: true, 
            message: 'Telegram client restarted successfully',
            clientInfo
        });
    } catch (error) {
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
        if (!telegramInstance.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Telegram client is not initialized' 
            });
        }

        const channels = await telegramInstance.getChannelsAndGroups();
        res.json({ 
            success: true, 
            channels,
            count: channels.length
        });
    } catch (error) {
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

        if (!telegramInstance.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Telegram client is not initialized' 
            });
        }

        await telegramInstance.startListening(channelIds);
        
        res.json({ 
            success: true, 
            message: `Started listening to ${channelIds.length} channels`,
            listeningChannels: telegramInstance.getListeningChannels()
        });
    } catch (error) {
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

        telegramInstance.stopListening(channelIds);
        
        res.json({ 
            success: true, 
            message: `Stopped listening to ${channelIds.length} channels`,
            listeningChannels: telegramInstance.getListeningChannels()
        });
    } catch (error) {
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
        const listeningChannels = telegramInstance.getListeningChannels();
        res.json({ 
            success: true, 
            listeningChannels,
            count: listeningChannels.length
        });
    } catch (error) {
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
        
        if (!telegramInstance.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Telegram client is not initialized' 
            });
        }

        const channel = await telegramInstance.findChannel(identifier);
        
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
    } catch (error) {
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
        if (!telegramInstance.isReady()) {
            return res.json({ 
                success: true, 
                isReady: false,
                message: 'Telegram client is not initialized'
            });
        }

        // Check if client is connected before getting info
        try {
            const clientInfo = await telegramInstance.getClientInfo();
            
            // Reset restart flag on successful connection
            restartAttempted = false;
            
            res.json({ 
                success: true, 
                isReady: true,
                clientInfo
            });
        } catch (error: any) {
            // If we can't get client info, the client is not properly connected
            console.log('Client info unavailable, client may be disconnected:', error.message);
            
            // Auto-restart once if not already attempted
            if (!restartAttempted && error.message && error.message.includes('Cannot send requests while disconnected')) {
                restartAttempted = true;
                console.log('Attempting to restart Telegram client automatically...');
                
                try {
                    await telegramInstance.restart();
                    console.log('Telegram client restarted successfully');
                    
                    // Try to get client info again after restart
                    const clientInfo = await telegramInstance.getClientInfo();
                    res.json({ 
                        success: true, 
                        isReady: true,
                        clientInfo,
                        message: 'Client restarted automatically'
                    });
                    return;
                } catch (restartError) {
                    console.error('Failed to restart Telegram client:', restartError);
                }
            }
            
            res.json({ 
                success: true, 
                isReady: false,
                message: 'Telegram client is not connected'
            });
        }
    } catch (error) {
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
        const newRule = await configManager.addForwardingRule({
            name,
            telegramChannelIds: channelIds,
            whatsappGroupId,
            isActive
        });

        // Start the rule if it's active and clients are ready
        if (isActive && telegramInstance.isReady() && whatsappInstance.isReady()) {
            const listeningConfig: ListeningConfig = {
                id: newRule.id,
                whatsappGroupId: newRule.whatsappGroupId,
                telegramSources: newRule.telegramChannelIds,
                isEnabled: newRule.isActive,
                createdAt: newRule.createdAt,
                lastModified: newRule.lastModified
            };
            await forwardingManager.startForwardingConfig(listeningConfig);
        }

        res.json({ 
            success: true, 
            message: 'Forwarding rule created successfully',
            rule: newRule
        });
    } catch (error) {
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
router.get('/forwarding/rules', async (req, res) => {
    try {
        const rules = configManager.getForwardingRules();
        const activeSessions = await forwardingManager.getActiveSessionsInfo();
        
        const rulesWithStatus = rules.map(rule => ({
            ...rule,
            isRunning: activeSessions.some(session => session.configId === rule.id)
        }));

        res.json({ 
            success: true, 
            rules: rulesWithStatus,
            count: rules.length,
            activeCount: activeSessions.length
        });
    } catch (error) {
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

        const updatedRule = await configManager.updateForwardingRule(ruleId, updates);
        
        if (!updatedRule) {
            return res.status(404).json({ 
                success: false, 
                error: 'Forwarding rule not found' 
            });
        }

        // Restart the rule if it's currently running
        if (forwardingManager.isConfigActive(ruleId)) {
            forwardingManager.stopForwardingConfig(ruleId);
            if (updatedRule.isActive && telegramInstance.isReady() && whatsappInstance.isReady()) {
                const listeningConfig: ListeningConfig = {
                    id: updatedRule.id,
                    whatsappGroupId: updatedRule.whatsappGroupId,
                    telegramSources: updatedRule.telegramChannelIds,
                    isEnabled: updatedRule.isActive,
                    createdAt: updatedRule.createdAt,
                    lastModified: updatedRule.lastModified
                };
                await forwardingManager.startForwardingConfig(listeningConfig);
            }
        } else if (updatedRule.isActive && telegramInstance.isReady() && whatsappInstance.isReady()) {
            // Start the rule if it wasn't running but is now active
            const listeningConfig: ListeningConfig = {
                id: updatedRule.id,
                whatsappGroupId: updatedRule.whatsappGroupId,
                telegramSources: updatedRule.telegramChannelIds,
                isEnabled: updatedRule.isActive,
                createdAt: updatedRule.createdAt,
                lastModified: updatedRule.lastModified
            };
            await forwardingManager.startForwardingConfig(listeningConfig);
        }

        res.json({ 
            success: true, 
            message: 'Forwarding rule updated successfully',
            rule: updatedRule
        });
    } catch (error) {
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
router.delete('/forwarding/rules/:ruleId', async (req, res) => {
    try {
        const { ruleId } = req.params;

        // Stop the rule if it's currently running
        if (forwardingManager.isConfigActive(ruleId)) {
            forwardingManager.stopForwardingConfig(ruleId);
        }

        const deleted = await configManager.deleteForwardingRule(ruleId);
        
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
    } catch (error) {
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
        
        const rule = configManager.getForwardingRule(ruleId);
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

        const listeningConfig: ListeningConfig = {
            id: rule.id,
            whatsappGroupId: rule.whatsappGroupId,
            telegramSources: rule.telegramChannelIds,
            isEnabled: rule.isActive,
            createdAt: rule.createdAt,
            lastModified: rule.lastModified
        };
        const started = await forwardingManager.startForwardingConfig(listeningConfig);
        
        res.json({ 
            success: started, 
            message: started ? 'Forwarding rule started successfully' : 'Failed to start forwarding rule'
        });
    } catch (error) {
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
        
        const stopped = forwardingManager.stopForwardingConfig(ruleId);
        
        res.json({ 
            success: stopped, 
            message: stopped ? 'Forwarding rule stopped successfully' : 'Forwarding rule was not running'
        });
    } catch (error) {
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
        if (!telegramInstance.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Telegram client is not ready',
                telegramReady: false,
                whatsappReady: whatsappInstance.isReady()
            });
        }

        if (!whatsappInstance.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'WhatsApp client is not ready',
                telegramReady: true,
                whatsappReady: false
            });
        }

        const activeRules = configManager.getActiveForwardingRules();
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
        const errors: string[] = [];

        for (const rule of activeRules) {
            console.log(`Starting rule: ${rule.name} (${rule.id})`);
            const listeningConfig: ListeningConfig = {
                id: rule.id,
                whatsappGroupId: rule.whatsappGroupId,
                telegramSources: rule.telegramChannelIds,
                isEnabled: rule.isActive,
                createdAt: rule.createdAt,
                lastModified: rule.lastModified
            };
            const started = await forwardingManager.startForwardingConfig(listeningConfig);
            if (started) {
                successCount++;
                console.log(`✅ Successfully started rule: ${rule.name}`);
            } else {
                const error = `Failed to start rule: ${rule.name}`;
                console.error(`❌ ${error}`);
                errors.push(error);
            }
        }

        // Update Telegram listening channels based on all active rules
        const allChannelIds = configManager.getAllActiveChannelIds();
        if (allChannelIds.length > 0) {
            await configManager.setTelegramListeningChannels(allChannelIds);
        }

        const activeSessions = await forwardingManager.getActiveSessionsInfo();
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
        } else {
            res.status(400).json({ 
                success: false, 
                error: `Failed to start any forwarding rules. Errors: ${errors.join(', ')}`,
                activeSessions,
                successCount: 0,
                totalRules: activeRules.length,
                errors
            });
        }
    } catch (error) {
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
        forwardingManager.stopAllConfigs();
        
        res.json({ 
            success: true, 
            message: 'All forwarding rules stopped'
        });
    } catch (error) {
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
router.get('/forwarding/status', async (req, res) => {
    try {
        const activeSessions = await forwardingManager.getActiveSessionsInfo();
        const activeRules = configManager.getActiveForwardingRules();
        
        res.json({ 
            success: true, 
            isForwarding: activeSessions.length > 0,
            activeSessions,
            totalActiveRules: activeRules.length,
            telegramReady: telegramInstance.isReady(),
            whatsappReady: whatsappInstance.isReady(),
            autoStartEnabled: configManager.getAutoStartForwarding()
        });
    } catch (error) {
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
        await configManager.cleanupForwardingRules();
        
        res.json({ 
            success: true, 
            message: 'Forwarding rules cleaned up successfully'
        });
    } catch (error) {
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
        const newRule = await configManager.addForwardingRule({
            name: ruleName || `Legacy Rule ${Date.now()}`,
            telegramChannelIds: telegramChannelIds,
            whatsappGroupId,
            isActive: true
        });

        // Start the rule if clients are ready
        if (telegramInstance.isReady() && whatsappInstance.isReady()) {
            const listeningConfig: ListeningConfig = {
                id: newRule.id,
                whatsappGroupId: newRule.whatsappGroupId,
                telegramSources: newRule.telegramChannelIds,
                isEnabled: newRule.isActive,
                createdAt: newRule.createdAt,
                lastModified: newRule.lastModified
            };
            await forwardingManager.startForwardingConfig(listeningConfig);
        }

        res.json({ 
            success: true, 
            message: `Setup forwarding from ${channelIds.length} Telegram channels to WhatsApp group`,
            ruleId: newRule.id,
            handlerId: `rule_${newRule.id}`, // For legacy compatibility
            listeningChannels: telegramInstance.getListeningChannels()
        });
    } catch (error) {
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
            stopped = forwardingManager.stopForwardingConfig(extractedRuleId);
        } else if (ruleId) {
            stopped = forwardingManager.stopForwardingConfig(ruleId);
        } else {
            // Legacy handler - try to find in old messageListeners
            const handler = messageListeners.get(handlerId);
            if (handler) {
                telegramInstance.removeMessageHandler(handler);
                messageListeners.delete(handlerId);
                stopped = true;
            }
        }
        
        res.json({ 
            success: stopped, 
            message: stopped ? 'Stopped message forwarding' : 'No active forwarding found with provided ID'
        });
    } catch (error) {
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
        forwardingManager.stopAllConfigs();
        
        await telegramInstance.reset();
        
        // Clear all legacy message listeners
        messageListeners.clear();
        
        // Reset auto-start flag
        autoStartAttempted = false;
        restartAttempted = false;
        
        res.json({ 
            success: true, 
            message: 'Telegram client reset successfully. Session deleted.'
        });
    } catch (error) {
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
        forwardingManager.stopAllConfigs();
        
        await telegramInstance.disconnect();
        
        // Clear all legacy message listeners
        messageListeners.clear();
        
        res.json({ 
            success: true, 
            message: 'Telegram client disconnected successfully'
        });
    } catch (error) {
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

        telegramInstance.submitPhoneCode(code);
        
        res.json({ 
            success: true, 
            message: 'Verification code submitted'
        });
    } catch (error) {
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

        telegramInstance.submitPassword(password);
        
        res.json({ 
            success: true, 
            message: '2FA password submitted'
        });
    } catch (error) {
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
            isAuthenticating: telegramInstance.checkIsAuthenticating(),
            isWaitingForPhoneCode: telegramInstance.isWaitingForPhoneCode(),
            isWaitingForPassword: telegramInstance.isWaitingForPassword(),
            isReady: telegramInstance.isReady()
        });
    } catch (error) {
        console.error('Error getting auth status:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// ============================================================================
// LISTENING CONFIGURATION API ENDPOINTS
// ============================================================================

/**
 * Create a new listening configuration
 */
router.post('/listening-config/create', async (req, res) => {
    try {
        const { whatsappGroupId, telegramSources, isEnabled = true } = req.body;
        
        if (!whatsappGroupId || !Array.isArray(telegramSources) || telegramSources.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'whatsappGroupId and telegramSources (non-empty array) are required' 
            });
        }

        // Ensure telegram sources have proper format (with - prefix)
        const formattedSources = telegramSources.map((id: string) => 
            id.startsWith('-') ? id : `-${id}`
        );

        const config = {
            whatsappGroupId,
            telegramSources: formattedSources,
            isEnabled
        };

        const result = await saveListeningConfig(config);
        
        if (!result) {
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to create listening configuration' 
            });
        }

        // Start the config if it's enabled and clients are ready
        if (isEnabled && telegramInstance.isReady() && whatsappInstance.isReady()) {
            await forwardingManager.startForwardingConfig(result);
        }

        res.json({ 
            success: true, 
            message: 'Listening configuration created successfully',
            config: result
        });
    } catch (error) {
        console.error('Error creating listening configuration:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Get all listening configurations
 */
router.get('/listening-config/list', async (req, res) => {
    try {
        const configs = await getAllListeningConfigs();
        const activeSessions = await forwardingManager.getActiveSessionsInfo();
        
        const configsWithStatus = configs.map((config: ListeningConfig) => ({
            ...config,
            isRunning: activeSessions.some(session => session.configId === config.id)
        }));

        res.json({ 
            success: true, 
            configs: configsWithStatus,
            count: configs.length,
            activeCount: activeSessions.length
        });
    } catch (error) {
        console.error('Error getting listening configurations:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Get active listening configurations
 */
router.get('/listening-config/active', async (req, res) => {
    try {
        const activeConfigs = await getActiveListeningConfigs();
        const activeSessions = await forwardingManager.getActiveSessionsInfo();
        
        const configsWithStatus = activeConfigs.map((config: ListeningConfig) => ({
            ...config,
            isRunning: activeSessions.some(session => session.configId === config.id)
        }));

        res.json({ 
            success: true, 
            configs: configsWithStatus,
            count: activeConfigs.length
        });
    } catch (error) {
        console.error('Error getting active listening configurations:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Get a specific listening configuration
 */
router.get('/listening-config/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const config = await getListeningConfig(id);
        
        if (!config) {
            return res.status(404).json({ 
                success: false, 
                error: 'Listening configuration not found' 
            });
        }

        const activeSessions = await forwardingManager.getActiveSessionsInfo();
        const configWithStatus = {
            ...config,
            isRunning: activeSessions.some(session => session.configId === config.id)
        };

        res.json({ 
            success: true, 
            config: configWithStatus
        });
    } catch (error) {
        console.error('Error getting listening configuration:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Update a listening configuration
 */
router.put('/listening-config/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { whatsappGroupId, telegramSources, isEnabled } = req.body;
        
        const updates: any = {};
        if (whatsappGroupId !== undefined) updates.whatsappGroupId = whatsappGroupId;
        if (telegramSources !== undefined) {
            if (!Array.isArray(telegramSources)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'telegramSources must be an array' 
                });
            }
            // Format telegram sources
            updates.telegramSources = telegramSources.map((id: string) => 
                id.startsWith('-') ? id : `-${id}`
            );
        }
        if (isEnabled !== undefined) updates.isEnabled = isEnabled;

        const success = await updateListeningConfig(id, updates);
        
        if (!success) {
            return res.status(404).json({ 
                success: false, 
                error: 'Listening configuration not found or update failed' 
            });
        }

        // Restart the config if it's currently running
        if (forwardingManager.isConfigActive(id)) {
            forwardingManager.stopForwardingConfig(id);
            
            if (isEnabled !== false) { // Only restart if not explicitly disabled
                const updatedConfig = await getListeningConfig(id);
                if (updatedConfig && updatedConfig.isEnabled) {
                    await forwardingManager.startForwardingConfig(updatedConfig);
                }
            }
        }

        const updatedConfig = await getListeningConfig(id);
        res.json({ 
            success: true, 
            message: 'Listening configuration updated successfully',
            config: updatedConfig
        });
    } catch (error) {
        console.error('Error updating listening configuration:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Delete a listening configuration
 */
router.delete('/listening-config/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Stop the config if it's currently running
        if (forwardingManager.isConfigActive(id)) {
            forwardingManager.stopForwardingConfig(id);
        }
        
        const success = await deleteListeningConfig(id);
        
        if (!success) {
            return res.status(404).json({ 
                success: false, 
                error: 'Listening configuration not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Listening configuration deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting listening configuration:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Enable a listening configuration
 */
router.post('/listening-config/:id/enable', async (req, res) => {
    try {
        const { id } = req.params;
        
        const success = await updateListeningConfig(id, { isEnabled: true });
        
        if (!success) {
            return res.status(404).json({ 
                success: false, 
                error: 'Listening configuration not found' 
            });
        }

        // Start the config if clients are ready
        if (telegramInstance.isReady() && whatsappInstance.isReady()) {
            const config = await getListeningConfig(id);
            if (config) {
                await forwardingManager.startForwardingConfig(config);
            }
        }

        res.json({ 
            success: true, 
            message: 'Listening configuration enabled successfully'
        });
    } catch (error) {
        console.error('Error enabling listening configuration:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Disable a listening configuration
 */
router.post('/listening-config/:id/disable', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Stop the config if it's currently running
        if (forwardingManager.isConfigActive(id)) {
            forwardingManager.stopForwardingConfig(id);
        }
        
        const success = await updateListeningConfig(id, { isEnabled: false });
        
        if (!success) {
            return res.status(404).json({ 
                success: false, 
                error: 'Listening configuration not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Listening configuration disabled successfully'
        });
    } catch (error) {
        console.error('Error disabling listening configuration:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Start all active configurations
 */
router.post('/listening-config/start-all', async (req, res) => {
    try {
        if (!telegramInstance.isReady() || !whatsappInstance.isReady()) {
            return res.status(503).json({ 
                success: false, 
                error: 'Telegram or WhatsApp client not ready' 
            });
        }

        await forwardingManager.startAllActiveConfigs();

        res.json({ 
            success: true, 
            message: 'All active listening configurations started successfully'
        });
    } catch (error) {
        console.error('Error starting all configurations:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Stop all active configurations
 */
router.post('/listening-config/stop-all', async (req, res) => {
    try {
        forwardingManager.stopAllConfigs();

        res.json({ 
            success: true, 
            message: 'All listening configurations stopped successfully'
        });
    } catch (error) {
        console.error('Error stopping all configurations:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Get active sessions status
 */
router.get('/listening-config/sessions/status', async (req, res) => {
    try {
        const activeSessions = await forwardingManager.getActiveSessionsInfo();

        res.json({ 
            success: true, 
            sessions: activeSessions,
            count: activeSessions.length
        });
    } catch (error) {
        console.error('Error getting session status:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

export default router;
