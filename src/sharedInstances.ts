import { TelegramInstance } from './telegramInstance';
import { WhatsAppInstance } from './whatsappInstance';
import { TwitterInstance } from './twitterInstance';
import ForwardingManager from './forwardingManager';

// Create shared instances
export const telegramInstance = new TelegramInstance();
export const whatsappInstance = new WhatsAppInstance();
export const twitterInstance = new TwitterInstance();
export const forwardingManager = new ForwardingManager(telegramInstance, whatsappInstance, twitterInstance);

// Initialize WhatsApp and Twitter on startup
whatsappInstance.initialize().catch(console.error);
twitterInstance.initialize().catch(console.error);
