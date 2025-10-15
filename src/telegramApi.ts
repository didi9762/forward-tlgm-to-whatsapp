import express from 'express';
import { TelegramMessage } from './telegramInstance';
import { configManager } from './configManager';
import { telegramInstance, whatsappInstance, forwardingManager } from './sharedInstances';
import { ListeningConfig } from './db';

const router = express.Router();

// Store for managing message listeners
const messageListeners: Map<string, (message: TelegramMessage) => void> = new Map();

// Auto-start forwarding when both clients are ready
let autoStartAttempted = false;
let autoStartInProgress = false;

async function attemptAutoStart() {
    if (autoStartAttempted || autoStartInProgress) return;
    
    if (telegramInstance.isReady() && whatsappInstance.isReady() && configManager.isActive()) {
        autoStartInProgress = true;
        autoStartAttempted = true;
        console.log('Both clients are ready, starting forwarding...');
        try {
            await startForwarding();
        } finally {
            autoStartInProgress = false;
        }
    }
}

async function startForwarding() {
    const config = configManager.getConfigSync();
    
    if (!config.whatsappGroupId || config.telegramChannelIds.length === 0) {
        console.log('Configuration not ready for forwarding');
        return false;
    }

    const listeningConfig: ListeningConfig = {
        id: 'main_config',
        whatsappGroupId: config.whatsappGroupId,
        telegramChannelIds: config.telegramChannelIds,
        isActive: true,
        createdAt: config.createdAt,
        lastModified: config.lastModified
    };

    const success = await forwardingManager.startForwardingConfig(listeningConfig);
    
    // Save forwarding status to DB
    if (success) {
        await configManager.setActive(true);
    }
    
    return success;
}

/**
 * Initialize Telegram client
 */
router.post('/initialize', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (telegramInstance.isReady()) {
            await attemptAutoStart();
            
            return res.json({ 
                success: true,
                message: 'Telegram client is already initialized and ready',
                isReady: true
            });
        }

        console.log('Initializing Telegram client...');
        await telegramInstance.initialize(phoneNumber);
        
        if (configManager.isActive()) {
            await attemptAutoStart();
        }

        res.json({ 
            success: true,
            message: 'Telegram client initialized successfully',
            isReady: telegramInstance.isReady()
        });
    } catch (error) {
        console.error('Error initializing Telegram client:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Get Telegram client status
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        isReady: telegramInstance.isReady()
    });
});

/**
 * Start forwarding
 */
router.post('/start-forwarding', async (req, res) => {
    try {
        if (!telegramInstance.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Telegram client is not ready' 
            });
        }

        if (!whatsappInstance.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'WhatsApp client is not ready' 
            });
        }

        const success = await startForwarding();
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Forwarding started successfully'
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Failed to start forwarding - check configuration' 
            });
        }
    } catch (error) {
        console.error('Error starting forwarding:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Stop forwarding
 */
router.post('/stop-forwarding', async (req, res) => {
    try {
        forwardingManager.stopForwardingConfig('main_config');
        
        // Save stopped status to DB
        await configManager.setActive(false);
        
        res.json({ 
            success: true, 
            message: 'Forwarding stopped successfully'
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
 * Get forwarding status
 */
router.get('/forwarding-status', async (req, res) => {
    try {
        const config = await configManager.getConfig();
        const isActive = forwardingManager.isConfigActive('main_config');
        
        res.json({ 
            success: true,
            isActive,
            config: config,
            telegramReady: telegramInstance.isReady(),
            whatsappReady: whatsappInstance.isReady()
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
 * Update configuration and restart forwarding if needed
 */
router.post('/update-config', async (req, res) => {
    try {
        const { whatsappGroupId, telegramChannelIds, isActive } = req.body;
        
        const updates: any = {};
        if (whatsappGroupId !== undefined) updates.whatsappGroupId = whatsappGroupId;
        if (telegramChannelIds !== undefined) updates.telegramChannelIds = telegramChannelIds;
        if (isActive !== undefined) updates.isActive = isActive;

        await configManager.updateConfig(updates);

        // Restart forwarding if it was active
        if (forwardingManager.isConfigActive('main_config')) {
            forwardingManager.stopForwardingConfig('main_config');
            if (configManager.isActive()) {
                await startForwarding();
            }
        }

        res.json({
            success: true,
            message: 'Configuration updated successfully',
            config: await configManager.getConfig()
        });
    } catch (error) {
        console.error('Error updating configuration:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Set WhatsApp groups for a specific Telegram channel
 */
router.post('/channels/:channelId/whatsapp-groups', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { groupIds } = req.body;
        
        if (!Array.isArray(groupIds)) {
            return res.status(400).json({
                success: false,
                error: 'groupIds must be an array'
            });
        }

        await configManager.setTelegramChannelWhatsAppGroups(channelId, groupIds);
        
        res.json({
            success: true,
            message: `WhatsApp groups updated for Telegram channel ${channelId}`
        });
    } catch (error) {
        console.error('Error setting WhatsApp groups for Telegram channel:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get WhatsApp groups for a specific Telegram channel
 */
router.get('/channels/:channelId/whatsapp-groups', (req, res) => {
    try {
        const { channelId } = req.params;
        const groupIds = configManager.getTelegramChannelWhatsAppGroups(channelId);
        
        res.json({
            success: true,
            groupIds: groupIds
        });
    } catch (error) {
        console.error('Error getting WhatsApp groups for Telegram channel:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Add a WhatsApp group to a specific Telegram channel
 */
router.post('/channels/:channelId/whatsapp-groups/add', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { groupId } = req.body;
        
        if (!groupId || typeof groupId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'groupId is required'
            });
        }

        await configManager.addWhatsAppGroupToTelegramChannel(channelId, groupId);
        
        res.json({
            success: true,
            message: `WhatsApp group ${groupId} added to Telegram channel ${channelId}`
        });
    } catch (error) {
        console.error('Error adding WhatsApp group to Telegram channel:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Remove a WhatsApp group from a specific Telegram channel
 */
router.post('/channels/:channelId/whatsapp-groups/remove', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { groupId } = req.body;
        
        if (!groupId || typeof groupId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'groupId is required'
            });
        }

        await configManager.removeWhatsAppGroupFromTelegramChannel(channelId, groupId);
        
        res.json({
            success: true,
            message: `WhatsApp group ${groupId} removed from Telegram channel ${channelId}`
        });
    } catch (error) {
        console.error('Error removing WhatsApp group from Telegram channel:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get channels that Telegram is currently listening to
 */
router.get('/listening-channels', (req, res) => {
    try {
        const channels = telegramInstance.getListeningChannels();
        res.json({
            success: true,
            channels: channels
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
 * Get available channels and groups
 */
router.get('/channels', async (req, res) => {
    try {
        if (!telegramInstance.isReady()) {
            return res.status(400).json({
                success: false,
                error: 'Telegram client is not ready'
            });
        }

        const channels = await telegramInstance.getChannelsAndGroups();
        
        res.json({
            success: true,
            channels: channels
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
 * Get client info
 */
router.get('/info', async (req, res) => {
    try {
        const isReady = telegramInstance.isReady();
        let clientInfo = null;
        
        if (isReady) {
            clientInfo = await telegramInstance.getClientInfo();
        }

        res.json({
            success: true,
            isReady: isReady,
            clientInfo: clientInfo
        });
    } catch (error) {
        console.error('Error getting client info:', error);
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

        // Get current config and add new channels
        const currentChannels = configManager.getTelegramChannelIds();
        const newChannels = [...new Set([...currentChannels, ...channelIds])];
        
        await configManager.setTelegramChannelIds(newChannels);
        await telegramInstance.startListening(channelIds);

        res.json({
            success: true,
            message: `Started listening to ${channelIds.length} channels`
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
router.post('/stop-listening', async (req, res) => {
    try {
        const { channelIds } = req.body;
        
        if (!Array.isArray(channelIds)) {
            return res.status(400).json({
                success: false,
                error: 'channelIds must be an array'
            });
        }

        // Get current config and remove channels
        const currentChannels = configManager.getTelegramChannelIds();
        const newChannels = currentChannels.filter(id => !channelIds.includes(id));
        
        await configManager.setTelegramChannelIds(newChannels);
        await telegramInstance.stopListening(channelIds);

        res.json({
            success: true,
            message: `Stopped listening to ${channelIds.length} channels`
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
 * Get listening channels (alias for compatibility)
 */
router.get('/listening', async (req, res) => {
    try {
        const channels = configManager.getTelegramChannelIds();
        res.json({
            success: true,
            listeningChannels: channels
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
 * Restart Telegram client
 */
router.post('/restart', async (req, res) => {
    try {
        await telegramInstance.disconnect();
        await telegramInstance.restart();
        
        res.json({
            success: true,
            message: 'Telegram client restarted successfully'
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
 * Reset Telegram session
 */
router.post('/reset', async (req, res) => {
    try {
        await telegramInstance.reset();
        
        res.json({
            success: true,
            message: 'Telegram session reset successfully'
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
 * Submit verification code
 */
router.post('/submit-code', async (req, res) => {
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
            message: 'Verification code submitted successfully'
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
router.post('/submit-password', async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({
                success: false,
                error: '2FA password is required'
            });
        }

        await telegramInstance.submitPassword(password);
        
        res.json({
            success: true,
            message: '2FA password submitted successfully'
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
router.get('/auth-status', async (req, res) => {
    try {
        const isReady = telegramInstance.isReady();
        const isWaitingForPhoneCode = telegramInstance.isWaitingForPhoneCode();
        const isWaitingForPassword = telegramInstance.isWaitingForPassword();
        const isAuthenticating = telegramInstance.checkIsAuthenticating();
        
        // Add cache control headers to prevent caching
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        res.json({
            success: true,
            isReady: isReady,
            isWaitingForPhoneCode: isWaitingForPhoneCode,
            isWaitingForPassword: isWaitingForPassword,
            isAuthenticating: isAuthenticating
        });
    } catch (error) {
        console.error('Error getting auth status:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;
