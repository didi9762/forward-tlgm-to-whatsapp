import express from 'express';
import cors from 'cors';
import path from 'path';
import whatsappApi from './whatsappApi';
import configApi from './configApi';
import telegramApi from './telegramApi';
import twitterApi from './twitterApi';
import aiApi from './aiApi';
import waToTgApi from './waToTgApi';
import { configManager } from './configManager';
import { forwardingManager, telegramInstance, whatsappInstance, twitterInstance, waToTgForwardingManager } from './sharedInstances';

const app = express();
const PORT = process.env.PORT || 1234;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/whatsapp', whatsappApi);
app.use('/telegram', telegramApi);
app.use('/twitter', twitterApi);
app.use('/config', configApi);
app.use('/ai', aiApi);
app.use('/wa-to-tg', waToTgApi);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize forwarding on server start (uses forwarding status saved in DB)
async function initializeForwarding() {
    try {
        // Ensure config is loaded from DB before checking forwarding status
        const config = await configManager.getConfig();
        if (!config.isActive) {
            console.log('Configuration is not active (from DB), skipping auto-start forwarding');
            return;
        }

        console.log('Configuration is active (from DB), waiting for clients to be ready...');
        
        // Wait for clients to be ready before starting forwarding
        const checkClientsAndStart = async (label: string) => {
            const telegramReady = telegramInstance.isReady();
            const whatsappReady = whatsappInstance.isReady();
            const twitterReady = twitterInstance.isReady();

            if (whatsappReady && (telegramReady || twitterReady)) {
                console.log(`[Forwarding/${label}] All required clients ready (WA=${whatsappReady} TG=${telegramReady} TW=${twitterReady}). Starting forwarding...`);
                await forwardingManager.startAllActiveConfigs();
                await waToTgForwardingManager.startAllActiveConfigs();
                console.log(`[Forwarding/${label}] Forwarding sessions started successfully`);
                return true;
            }

            // Log why we're still waiting
            const missing: string[] = [];
            if (!whatsappReady) missing.push('WhatsApp');
            if (!telegramReady && !twitterReady) missing.push('Telegram/Twitter (need at least one)');
            console.log(`[Forwarding/${label}] Not ready yet — waiting for: ${missing.join(', ')} (WA=${whatsappReady} TG=${telegramReady} TW=${twitterReady})`);
            return false;
        };
        
        // Try immediately
        const started = await checkClientsAndStart('init');
        
        // If not ready, poll every 5 seconds for up to 2 minutes, then fall back to slow polling
        if (!started) {
            let attempts = 0;
            const maxFastAttempts = 24; // 2 minutes (24 × 5 seconds)
            
            const fastInterval = setInterval(async () => {
                attempts++;
                const started = await checkClientsAndStart(`fast ${attempts}/${maxFastAttempts}`);
                if (started) {
                    clearInterval(fastInterval);
                } else if (attempts >= maxFastAttempts) {
                    clearInterval(fastInterval);
                    console.log('[Forwarding] Fast-poll window (2 min) expired. Switching to background checks every 2 min for up to 30 min...');

                    let slowAttempts = 0;
                    const maxSlowAttempts = 15; // 15 × 2 min = 30 minutes
                    const slowInterval = setInterval(async () => {
                        slowAttempts++;
                        const started = await checkClientsAndStart(`bg ${slowAttempts}/${maxSlowAttempts}`);
                        if (started) {
                            clearInterval(slowInterval);
                        } else if (slowAttempts >= maxSlowAttempts) {
                            console.log('[Forwarding] Background checks exhausted (32 min total). Use the UI to start forwarding manually.');
                            clearInterval(slowInterval);
                        }
                    }, 2 * 60 * 1000);
                }
            }, 5000);
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

console.log(PORT)
const server = app.listen(Number(PORT), process.env.HOST || '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    
    // Initialize forwarding after server starts
    initializeForwarding();
});

// Graceful shutdown for server close
server.on('close', () => {
    console.log('HTTP server closed');
});

export { server };
