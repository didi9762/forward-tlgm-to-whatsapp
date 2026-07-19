import * as dotenv from 'dotenv';
import { TelegramInstance } from './telegramInstance';
import { WhatsAppInstance } from './whatsappInstance';
import { BaileysWhatsAppInstance } from './baileysWhatsAppInstance';
import { TwitterInstance } from './twitterInstance';
import ForwardingManager from './forwardingManager';
import WaToTgForwardingManager from './waToTgForwardingManager';
import { WhatsAppEngine } from './whatsappEngine';

dotenv.config();

export type { WhatsAppEngine } from './whatsappEngine';

function createWhatsAppInstance(): WhatsAppEngine {
    const engine = (process.env.WHATSAPP_ENGINE || 'wwebjs').toLowerCase();
    if (engine === 'baileys') {
        console.log('[WhatsApp] Using Baileys engine (pairing code)');
        return new BaileysWhatsAppInstance();
    }
    console.log('[WhatsApp] Using whatsapp-web.js engine (QR or optional pairing code)');
    return new WhatsAppInstance();
}

// Create shared instances
export const telegramInstance = new TelegramInstance();
export const whatsappInstance = createWhatsAppInstance();
export const twitterInstance = new TwitterInstance();
export const forwardingManager = new ForwardingManager(telegramInstance, whatsappInstance, twitterInstance);
export const waToTgForwardingManager = new WaToTgForwardingManager(telegramInstance, whatsappInstance);

// Initialize WhatsApp on startup
whatsappInstance.initialize().catch((error) => {
    console.error('WhatsApp initialization failed:', error instanceof Error ? error.message : error);
});

// Initialize Twitter with automatic retry on transient failures
async function initializeTwitterWithRetry(maxAttempts = 10, baseDelayMs = 30000): Promise<void> {
    console.log(`[Twitter] Starting initialization (up to ${maxAttempts} attempts)...`);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await twitterInstance.initialize();
            // success log is already printed inside twitterInstance.initialize()
            return;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (attempt < maxAttempts) {
                const delay = Math.min(baseDelayMs * attempt, 5 * 60 * 1000); // cap at 5 min
                const delaySec = delay / 1000;
                console.error(`[Twitter] Initialization attempt ${attempt}/${maxAttempts} failed: ${msg}. Retrying in ${delaySec}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`[Twitter] Initialization failed after ${maxAttempts} attempts: ${msg}. Use the UI to reconnect manually.`);
            }
        }
    }
}

initializeTwitterWithRetry();
