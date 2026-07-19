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
        const engine = whatsappInstance.getEngineType();
        const pairingInfo = whatsappInstance.getPairingInfo();
        
        if (isReady) {
            clientInfo = await whatsappInstance.getClientInfo();
        }

        res.json({
            success: true,
            isReady: isReady,
            engine,
            hasQrCode: !!whatsappInstance.getCurrentQrCode(),
            pairingInfo,
            phoneNumber: 'getPhoneNumber' in whatsappInstance
                ? (whatsappInstance as any).getPhoneNumber()
                : null,
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
 * Pair with a phone number (returns pairing code).
 * Supported for both Baileys and whatsapp-web.js (optional alternative to QR).
 */
router.post('/pair', async (req, res) => {
    try {
        const phone = String(req.body?.phoneNumber || req.body?.phone || '').replace(/[^0-9]/g, '');
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: 'phoneNumber is required (digits only, with country code, e.g. 972501234567)'
            });
        }

        const code = await whatsappInstance.pairWithPhone(phone);
        res.json({
            success: true,
            message: 'Pairing initiated. Enter the code in WhatsApp → Linked Devices → Link with phone number.',
            pairingCode: code,
            phoneNumber: phone,
            engine: whatsappInstance.getEngineType()
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error starting pairing',
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
                description: (group as any).description || null
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
                message: whatsappInstance.getEngineType() === 'baileys'
                    ? 'Screenshots are not available with Baileys engine'
                    : 'Screenshot not available'
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

        // For Baileys without a phone number, don't auto-reinit (pair endpoint will)
        if (whatsappInstance.getEngineType() === 'wwebjs') {
            // resetInstance already reinitializes for wwebjs
        } else if ('getPhoneNumber' in whatsappInstance && (whatsappInstance as any).getPhoneNumber()) {
            await whatsappInstance.initialize();
        }
        
        res.json({
            success: true,
            message: whatsappInstance.getEngineType() === 'baileys'
                ? 'Baileys auth cleared. Enter a phone number to request a new pairing code.'
                : 'WhatsApp instance reset successfully. Scan the QR code, or enter a phone number for a pairing code.'
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
