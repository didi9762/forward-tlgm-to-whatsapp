"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const configManager_1 = require("./configManager");
const router = express_1.default.Router();
/**
 * Get all configuration
 */
router.get('/', (req, res) => {
    try {
        const config = configManager_1.configManager.getConfig();
        res.json({
            success: true,
            message: 'Configuration retrieved successfully',
            config: config
        });
    }
    catch (error) {
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
        configManager_1.configManager.setGroupToSend(groupToSend);
        res.json({
            success: true,
            message: 'WhatsApp group updated successfully',
            config: configManager_1.configManager.getConfig()
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error updating WhatsApp group',
            error: error.message
        });
    }
});
exports.default = router;
//# sourceMappingURL=configApi.js.map