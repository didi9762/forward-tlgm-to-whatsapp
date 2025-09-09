import express from 'express';
import cors from 'cors';
import path from 'path';
import whatsappApi from './whatsappApi';
import configApi from './configApi';
import telegramApi from './telegramApi';
import { configManager } from './configManager';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/whatsapp', whatsappApi);
app.use('/telegram', telegramApi);
app.use('/config', configApi);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize forwarding on server start
async function initializeForwarding() {
    try {
        if (configManager.getAutoStartForwarding()) {
            console.log('Auto-start forwarding is enabled, will start forwarding when clients are ready...');
        }
    } catch (error) {
        console.error('Error during forwarding initialization:', error);
    }
}

// Graceful shutdown function
async function gracefulShutdown(signal: string) {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    try {
        // Try to cleanup clients via API endpoints
        console.log('Cleaning up clients...');
        
        // Reset WhatsApp instance
        try {
            const fetch = (await import('node-fetch')).default;
            await fetch(`http://localhost:${PORT}/whatsapp/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            console.log('WhatsApp client reset');
        } catch (error) {
            console.log('Could not reset WhatsApp via API (this is normal if server is shutting down)');
        }

        console.log('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
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

// Graceful shutdown for server close
server.on('close', () => {
    console.log('HTTP server closed');
});

export { server };
