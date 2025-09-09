import express from 'express';
import { configManager } from './configManager';

const router = express.Router();

/**
 * Get all configuration
 */
router.get('/', (req, res) => {
    try {
        const config = configManager.getConfig();
        
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
router.post('/updateWaGroup', (req, res) => {
    try {
        const { groupToSend } = req.body;
        
        if (!groupToSend) {
            return res.status(400).json({
                success: false,
                message: 'groupToSend is required'
            });
        }

        configManager.setGroupToSend(groupToSend);
        
        res.json({
            success: true,
            message: 'WhatsApp group updated successfully',
            config: configManager.getConfig()
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error updating WhatsApp group',
            error: error.message
        });
    }
});

export default router;
