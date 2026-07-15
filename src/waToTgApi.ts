import express from 'express';
import { telegramInstance, whatsappInstance, waToTgForwardingManager } from './sharedInstances';
import {
    WaToTgConfig,
    saveWaToTgConfig,
    updateWaToTgConfig,
    getWaToTgConfig,
    getAllWaToTgConfigs,
    getActiveWaToTgConfigs,
    deleteWaToTgConfig
} from './db';

const router = express.Router();

/**
 * Get all WA→TG forwarding configs
 */
router.get('/configs', async (req, res) => {
    try {
        const configs = await getAllWaToTgConfigs();
        res.json({ success: true, configs });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get a specific config by ID
 */
router.get('/configs/:id', async (req, res) => {
    try {
        const config = await getWaToTgConfig(req.params.id);
        if (!config) {
            return res.status(404).json({ success: false, error: 'Config not found' });
        }
        res.json({ success: true, config });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Create a new WA→TG forwarding config
 */
router.post('/configs', async (req, res) => {
    try {
        const { whatsappGroupIds, telegramChatId, isActive } = req.body;

        if (!Array.isArray(whatsappGroupIds) || whatsappGroupIds.length === 0) {
            return res.status(400).json({ success: false, error: 'whatsappGroupIds must be a non-empty array' });
        }
        if (!telegramChatId || typeof telegramChatId !== 'string') {
            return res.status(400).json({ success: false, error: 'telegramChatId is required' });
        }

        const config = await saveWaToTgConfig({
            whatsappGroupIds,
            telegramChatId,
            isActive: isActive !== false
        });

        if (!config) {
            return res.status(500).json({ success: false, error: 'Failed to save config' });
        }

        if (config.isActive && whatsappInstance.isReady() && telegramInstance.isReady()) {
            await waToTgForwardingManager.startForwardingConfig(config);
        }

        res.json({ success: true, config });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Update an existing config
 */
router.put('/configs/:id', async (req, res) => {
    try {
        const { whatsappGroupIds, telegramChatId, isActive } = req.body;
        const updates: Partial<Omit<WaToTgConfig, 'id' | 'createdAt'>> = {};

        if (whatsappGroupIds !== undefined) updates.whatsappGroupIds = whatsappGroupIds;
        if (telegramChatId !== undefined) updates.telegramChatId = telegramChatId;
        if (isActive !== undefined) updates.isActive = isActive;

        const success = await updateWaToTgConfig(req.params.id, updates);
        if (!success) {
            return res.status(404).json({ success: false, error: 'Config not found or no changes' });
        }

        // Restart the forwarding session for this config
        waToTgForwardingManager.stopForwardingConfig(req.params.id);
        const updatedConfig = await getWaToTgConfig(req.params.id);
        if (updatedConfig && updatedConfig.isActive && whatsappInstance.isReady() && telegramInstance.isReady()) {
            await waToTgForwardingManager.startForwardingConfig(updatedConfig);
        }

        res.json({ success: true, config: updatedConfig });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Delete a config
 */
router.delete('/configs/:id', async (req, res) => {
    try {
        waToTgForwardingManager.stopForwardingConfig(req.params.id);
        const success = await deleteWaToTgConfig(req.params.id);

        if (!success) {
            return res.status(404).json({ success: false, error: 'Config not found' });
        }

        res.json({ success: true, message: 'Config deleted' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Start all active forwarding configs
 */
router.post('/start-all', async (req, res) => {
    try {
        if (!whatsappInstance.isReady()) {
            return res.status(400).json({ success: false, error: 'WhatsApp client is not ready' });
        }
        if (!telegramInstance.isReady()) {
            return res.status(400).json({ success: false, error: 'Telegram client is not ready' });
        }

        await waToTgForwardingManager.startAllActiveConfigs();
        res.json({ success: true, message: 'All active WA→TG forwarding configs started' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Stop all forwarding configs
 */
router.post('/stop-all', async (req, res) => {
    try {
        waToTgForwardingManager.stopAllConfigs();
        res.json({ success: true, message: 'All WA→TG forwarding configs stopped' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Restart all forwarding configs
 */
router.post('/restart-all', async (req, res) => {
    try {
        await waToTgForwardingManager.restartAllConfigs();
        res.json({ success: true, message: 'All WA→TG forwarding configs restarted' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get forwarding status
 */
router.get('/status', async (req, res) => {
    try {
        const sessions = await waToTgForwardingManager.getActiveSessionsInfo();
        res.json({
            success: true,
            activeSessions: sessions.length,
            sessions,
            whatsappReady: whatsappInstance.isReady(),
            telegramReady: telegramInstance.isReady()
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
