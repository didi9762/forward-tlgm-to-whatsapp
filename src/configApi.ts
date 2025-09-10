import express from 'express';
import { configManager } from './configManager';

const router = express.Router();

/**
 * Get all configuration
 */
router.get('/', async (req, res) => {
    try {
        const config = await configManager.getConfig();
        
        res.json({
            success: true,
            message: 'Configuration retrieved successfully',
            config: config
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error retrieving configuration',
            error: error.message
        });
    }
});

/**
 * Update WhatsApp group to send messages to
 */
router.post('/updateWaGroup', async (req, res) => {
    try {
        const { groupToSend } = req.body;
        
        if (!groupToSend) {
            return res.status(400).json({
                success: false,
                message: 'groupToSend is required'
            });
        }

        await configManager.setWhatsAppGroupId(groupToSend);
        
        res.json({
            success: true,
            message: 'WhatsApp group updated successfully',
            config: await configManager.getConfig()
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error updating WhatsApp group',
            error: error.message
        });
    }
});

/**
 * Update Telegram channels
 */
router.post('/updateTelegramChannels', async (req, res) => {
    try {
        const { channelIds } = req.body;
        
        if (!Array.isArray(channelIds)) {
            return res.status(400).json({
                success: false,
                message: 'channelIds must be an array'
            });
        }

        await configManager.setTelegramChannelIds(channelIds);
        
        res.json({
            success: true,
            message: 'Telegram channels updated successfully',
            config: await configManager.getConfig()
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error updating Telegram channels',
            error: error.message
        });
    }
});

/**
 * Set configuration active/inactive
 */
router.post('/setActive', async (req, res) => {
    try {
        const { active } = req.body;
        
        if (typeof active !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'active must be a boolean'
            });
        }

        await configManager.setActive(active);
        
        res.json({
            success: true,
            message: `Configuration ${active ? 'activated' : 'deactivated'} successfully`,
            config: await configManager.getConfig()
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error updating configuration status',
            error: error.message
        });
    }
});

export default router;
