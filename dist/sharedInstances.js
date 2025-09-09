"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.forwardingManager = exports.whatsappInstance = exports.telegramInstance = void 0;
const telegramInstance_1 = require("./telegramInstance");
const whatsappInstance_1 = require("./whatsappInstance");
const forwardingManager_1 = __importDefault(require("./forwardingManager"));
// Create shared instances
exports.telegramInstance = new telegramInstance_1.TelegramInstance();
exports.whatsappInstance = new whatsappInstance_1.WhatsAppInstance();
exports.forwardingManager = new forwardingManager_1.default(exports.telegramInstance, exports.whatsappInstance);
// Initialize WhatsApp on startup
exports.whatsappInstance.initialize().catch(console.error);
//# sourceMappingURL=sharedInstances.js.map