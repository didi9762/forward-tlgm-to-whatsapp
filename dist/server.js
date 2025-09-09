"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const whatsappApi_1 = __importDefault(require("./whatsappApi"));
const configApi_1 = __importDefault(require("./configApi"));
const telegramApi_1 = __importDefault(require("./telegramApi"));
const configManager_1 = require("./configManager");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Serve static files
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// API Routes
app.use('/whatsapp', whatsappApi_1.default);
app.use('/telegram', telegramApi_1.default);
app.use('/config', configApi_1.default);
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});
// Default route
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/index.html'));
});
// Initialize forwarding on server start
async function initializeForwarding() {
    try {
        if (configManager_1.configManager.getAutoStartForwarding()) {
            console.log('Auto-start forwarding is enabled, will start forwarding when clients are ready...');
        }
    }
    catch (error) {
        console.error('Error during forwarding initialization:', error);
    }
}
// Graceful shutdown function
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    try {
        // Try to cleanup clients via API endpoints
        console.log('Cleaning up clients...');
        // Reset WhatsApp instance
        try {
            const fetch = (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
            await fetch(`http://localhost:${PORT}/whatsapp/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            console.log('WhatsApp client reset');
        }
        catch (error) {
            console.log('Could not reset WhatsApp via API (this is normal if server is shutting down)');
        }
        console.log('Graceful shutdown completed');
        process.exit(0);
    }
    catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
}
// Handle process termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API endpoints available at http://localhost:${PORT}/api/whatsapp`);
    // Initialize forwarding after server starts
    initializeForwarding();
});
exports.server = server;
// Graceful shutdown for server close
server.on('close', () => {
    console.log('HTTP server closed');
});
//# sourceMappingURL=server.js.map