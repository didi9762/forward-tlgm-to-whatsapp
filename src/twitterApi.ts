import express from 'express';
import { TwitterMessage } from './twitterInstance';
import { configManager } from './configManager';
import { twitterInstance, whatsappInstance, forwardingManager } from './sharedInstances';
import { ListeningConfig } from './db';

const router = express.Router();

// Store for managing message listeners
const messageListeners: Map<string, (message: TwitterMessage) => void> = new Map();

// Auto-start forwarding when both clients are ready
let autoStartAttempted = false;
let autoStartInProgress = false;

async function attemptAutoStart() {
    if (autoStartAttempted || autoStartInProgress) return;
    
    if (twitterInstance.isReady() && whatsappInstance.isReady() && configManager.isActive()) {
        autoStartInProgress = true;
        autoStartAttempted = true;
        console.log('Both Twitter and WhatsApp clients are ready, starting forwarding...');
        try {
            await startForwarding();
        } finally {
            autoStartInProgress = false;
        }
    }
}

async function startForwarding() {
    const config = configManager.getConfigSync();
    
    if (!config.isActive || !config.whatsappGroupId || config.twitterAccounts.length === 0) {
        console.log('Configuration not ready for Twitter forwarding');
        return false;
    }

    const listeningConfig: ListeningConfig = {
        id: 'twitter_config',
        whatsappGroupId: config.whatsappGroupId,
        telegramChannelIds: [], // Not used for Twitter
        isActive: config.isActive,
        createdAt: config.createdAt,
        lastModified: config.lastModified,
    };

    return await forwardingManager.startTwitterForwardingConfig(listeningConfig, config.twitterAccounts.map(acc => acc.id));
}

/**
 * Initialize Twitter client
 */
router.post('/initialize', async (req, res) => {
    try {
        if (twitterInstance.isReady()) {
            await attemptAutoStart();
            
            return res.json({ 
                success: true,
                message: 'Twitter client is already initialized and ready',
                isReady: true
            });
        }

        console.log('Initializing Twitter client...');
        await twitterInstance.initialize();
        
        if (configManager.isActive()) {
            await attemptAutoStart();
        }

        res.json({ 
            success: true,
            message: 'Twitter client initialized successfully',
            isReady: twitterInstance.isReady()
        });
    } catch (error) {
        console.error('Error initializing Twitter client:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Get Twitter client status
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        isReady: twitterInstance.isReady(),
        isStreaming: twitterInstance.getKeepAliveStatus().isStreaming
    });
});

/**
 * Start forwarding
 */
router.post('/start-forwarding', async (req, res) => {
    try {
        if (!twitterInstance.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Twitter client is not ready' 
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
                message: 'Twitter forwarding started successfully'
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Failed to start Twitter forwarding - check configuration' 
            });
        }
    } catch (error) {
        console.error('Error starting Twitter forwarding:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Stop forwarding
 */
router.post('/stop-forwarding', (req, res) => {
    try {
        forwardingManager.stopTwitterForwardingConfig('twitter_config');
        
        res.json({ 
            success: true, 
            message: 'Twitter forwarding stopped successfully'
        });
    } catch (error) {
        console.error('Error stopping Twitter forwarding:', error);
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
        const isActive = forwardingManager.isTwitterConfigActive('twitter_config');
        
        res.json({ 
            success: true,
            isActive,
            config: config,
            twitterReady: twitterInstance.isReady(),
            whatsappReady: whatsappInstance.isReady()
        });
    } catch (error) {
        console.error('Error getting Twitter forwarding status:', error);
        res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

/**
 * Get accounts that Twitter is currently listening to
 */
router.get('/listening-accounts', (req, res) => {
    try {
        const accounts = twitterInstance.getListeningAccounts();
        res.json({
            success: true,
            accounts: accounts
        });
    } catch (error) {
        console.error('Error getting listening accounts:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Search for accounts by username
 */
router.get('/search-accounts', async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || typeof query !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Query parameter is required'
            });
        }

        if (!twitterInstance.isReady()) {
            return res.status(400).json({
                success: false,
                error: 'Twitter client is not ready'
            });
        }

        const accounts = await twitterInstance.searchAccounts(query);
        
        res.json({
            success: true,
            accounts: accounts
        });
    } catch (error) {
        console.error('Error searching accounts:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Start listening to specific accounts
 */
router.post('/listen', async (req, res) => {
    try {
        const { accounts } = req.body;
        
        if (!Array.isArray(accounts)) {
            return res.status(400).json({
                success: false,
                error: 'accounts must be an array'
            });
        }

        await twitterInstance.startListening(accounts);

        res.json({
            success: true,
            message: `Started listening to ${accounts.length} accounts`
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
 * Stop listening to specific accounts
 */
router.post('/stop-listening', async (req, res) => {
    try {
        const { accountIds } = req.body;
        
        if (!Array.isArray(accountIds)) {
            return res.status(400).json({
                success: false,
                error: 'accountIds must be an array'
            });
        }

        twitterInstance.stopListening(accountIds);

        res.json({
            success: true,
            message: `Stopped listening to ${accountIds.length} accounts`
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
 * Get listening accounts (alias for compatibility)
 */
router.get('/listening', async (req, res) => {
    try {
        const accounts = configManager.getTwitterAccounts();
        res.json({
            success: true,
            listeningAccounts: accounts
        });
    } catch (error) {
        console.error('Error getting listening accounts:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Restart Twitter client
 */
router.post('/restart', async (req, res) => {
    try {
        await twitterInstance.restart();
        
        res.json({
            success: true,
            message: 'Twitter client restarted successfully'
        });
    } catch (error) {
        console.error('Error restarting Twitter:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Disconnect Twitter client
 */
router.post('/disconnect', async (req, res) => {
    try {
        await twitterInstance.disconnect();
        
        res.json({
            success: true,
            message: 'Twitter client disconnected successfully'
        });
    } catch (error) {
        console.error('Error disconnecting Twitter:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get keep-alive status
 */
router.get('/keep-alive-status', (req, res) => {
    try {
        const status = twitterInstance.getKeepAliveStatus();
        res.json({
            success: true,
            status: status
        });
    } catch (error) {
        console.error('Error getting keep-alive status:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Set WhatsApp groups for a specific Twitter account
 */
router.post('/accounts/:accountId/whatsapp-groups', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { groupIds } = req.body;
        
        if (!Array.isArray(groupIds)) {
            return res.status(400).json({
                success: false,
                error: 'groupIds must be an array'
            });
        }

        await configManager.setTwitterAccountWhatsAppGroups(accountId, groupIds);
        
        res.json({
            success: true,
            message: `WhatsApp groups updated for Twitter account ${accountId}`
        });
    } catch (error) {
        console.error('Error setting WhatsApp groups for Twitter account:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get WhatsApp groups for a specific Twitter account
 */
router.get('/accounts/:accountId/whatsapp-groups', (req, res) => {
    try {
        const { accountId } = req.params;
        const groupIds = configManager.getTwitterAccountWhatsAppGroups(accountId);
        
        res.json({
            success: true,
            groupIds: groupIds
        });
    } catch (error) {
        console.error('Error getting WhatsApp groups for Twitter account:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Add a WhatsApp group to a specific Twitter account
 */
router.post('/accounts/:accountId/whatsapp-groups/add', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { groupId } = req.body;
        
        if (!groupId || typeof groupId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'groupId is required'
            });
        }

        await configManager.addWhatsAppGroupToTwitterAccount(accountId, groupId);
        
        res.json({
            success: true,
            message: `WhatsApp group ${groupId} added to Twitter account ${accountId}`
        });
    } catch (error) {
        console.error('Error adding WhatsApp group to Twitter account:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Remove a WhatsApp group from a specific Twitter account
 */
router.post('/accounts/:accountId/whatsapp-groups/remove', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { groupId } = req.body;
        
        if (!groupId || typeof groupId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'groupId is required'
            });
        }

        await configManager.removeWhatsAppGroupFromTwitterAccount(accountId, groupId);
        
        res.json({
            success: true,
            message: `WhatsApp group ${groupId} removed from Twitter account ${accountId}`
        });
    } catch (error) {
        console.error('Error removing WhatsApp group from Twitter account:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;
