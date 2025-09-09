import express from 'express';
import { whatsappInstance } from './sharedInstances';

const router = express.Router();

// Note: WhatsApp is initialized in sharedInstances.ts, not here

/**
 * Get client status and info
 */
router.get('/status', async (req, res) => {
    try {
        const isReady = whatsappInstance.isReady();
        let clientInfo = null;
        
        if (isReady) {
            clientInfo = await whatsappInstance.getClientInfo();
        }

        res.json({
            success: true,
            isReady: isReady,
            hasQrCode: !!whatsappInstance.getCurrentQrCode(),
            clientInfo: clientInfo
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error getting client status',
            error: error.message
        });
    }
});

/**
 * Restart WhatsApp client
 */
router.post('/restart', async (req, res) => {
    try {
        await whatsappInstance.restart();
        
        res.json({
            success: true,
            message: 'WhatsApp client restarted successfully'
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error restarting WhatsApp client',
            error: error.message
        });
    }
});

/**
 * Get all groups
 */
router.get('/groups', async (req, res) => {
    try {
        if (!whatsappInstance.isReady()) {
            return res.status(400).json({
                success: false,
                message: 'WhatsApp client is not ready'
            });
        }

        const groups = await whatsappInstance.getGroups();
        if (typeof groups === 'string') {
            return res.status(400).json({
                success: false,
                message: groups
            });
        }
        
        res.json({
            success: true,
            message: `Found ${groups.length} groups`,
            groups: groups.map(group => ({
                id: group.id._serialized,
                name: group.name,
                participantsCount: group.participants?.length || 0,
                description: group.description || null
            }))
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error getting groups',
            error: error.message
        });
    }
});

/**
 * Take screenshot of WhatsApp Web
 */
router.get('/screenshot', async (req, res) => {
    try {
        const screenshot = await whatsappInstance.takeScreenshot();
        
        if (!screenshot) {
            return res.status(400).json({
                success: false,
                message: 'Screenshot not available'
            });
        }

        res.json({
            success: true,
            message: 'Screenshot taken successfully',
            screenshot: screenshot
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error taking screenshot',
            error: error.message
        });
    }
});

/**
 * Reset WhatsApp instance (delete auth/cache and restart)
 */
router.post('/reset', async (req, res) => {
    try {
        await whatsappInstance.resetInstance();
        
        res.json({
            success: true,
            message: 'WhatsApp instance reset successfully. Auth and cache directories deleted.'
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error resetting WhatsApp instance',
            error: error.message
        });
    }
});

export default router;
