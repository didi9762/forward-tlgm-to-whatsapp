"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const sharedInstances_1 = require("./sharedInstances");
const router = express_1.default.Router();
// Note: WhatsApp is initialized in sharedInstances.ts, not here
/**
 * Get client status and info
 */
router.get('/status', async (req, res) => {
    try {
        const isReady = sharedInstances_1.whatsappInstance.isReady();
        let clientInfo = null;
        if (isReady) {
            clientInfo = await sharedInstances_1.whatsappInstance.getClientInfo();
        }
        res.json({
            success: true,
            isReady: isReady,
            hasQrCode: !!sharedInstances_1.whatsappInstance.getCurrentQrCode(),
            clientInfo: clientInfo
        });
    }
    catch (error) {
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
        await sharedInstances_1.whatsappInstance.restart();
        res.json({
            success: true,
            message: 'WhatsApp client restarted successfully'
        });
    }
    catch (error) {
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
        if (!sharedInstances_1.whatsappInstance.isReady()) {
            return res.status(400).json({
                success: false,
                message: 'WhatsApp client is not ready'
            });
        }
        const groups = await sharedInstances_1.whatsappInstance.getGroups();
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
    }
    catch (error) {
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
        const screenshot = await sharedInstances_1.whatsappInstance.takeScreenshot();
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
    }
    catch (error) {
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
        await sharedInstances_1.whatsappInstance.resetInstance();
        res.json({
            success: true,
            message: 'WhatsApp instance reset successfully. Auth and cache directories deleted.'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error resetting WhatsApp instance',
            error: error.message
        });
    }
});
exports.default = router;
//# sourceMappingURL=whatsappApi.js.map