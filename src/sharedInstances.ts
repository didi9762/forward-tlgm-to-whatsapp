import { TelegramInstance } from './telegramInstance';
import { WhatsAppInstance } from './whatsappInstance';
import ForwardingManager from './forwardingManager';

// Create shared instances
export const telegramInstance = new TelegramInstance();
export const whatsappInstance = new WhatsAppInstance();
export const forwardingManager = new ForwardingManager(telegramInstance, whatsappInstance);

// Initialize WhatsApp on startup
whatsappInstance.initialize().catch(console.error);
