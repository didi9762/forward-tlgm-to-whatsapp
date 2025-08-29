const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require('qrcode');

class WhatsAppClient {
  constructor(clientId = 'default', socketIO = null) {
    this.clientId = clientId;
    this.client = null;
    this.isReady = false;
    this.isAuthenticated = false;
    this.chats = [];
    this.groups = [];
    this.contacts = [];
    this.socketIO = socketIO;
    this.currentQRCode = null;
    this.authRetries = 0;
    this.maxAuthRetries = 5;
  }

  async initialize() {
    try {
      // Create WhatsApp client with authentication strategy
      this.client = new Client({
        authStrategy: new LocalAuth({ clientId: this.clientId }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--disable-extensions',
            '--disable-default-apps'
          ],
          //depened on os
          executablePath: process.platform === 'darwin' ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome"
        }
      });
      // Event handlers
      this.setupEventHandlers();

      // Initialize the client
      await this.client.initialize();
      
      return this;
    } catch (error) {
      console.error('Error initializing WhatsApp client:', error);
      this.emitToClient('whatsapp_error', { error: error.message });
      throw error;
    }
  }

  setupEventHandlers() {
    // QR Code event
    this.client.on('qr', async (qr) => {
      try {
        console.log('WhatsApp QR Code received');
        this.currentQRCode = qr;
        
        // Generate QR code as base64 image
        const qrImageDataURL = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          quality: 0.92,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          width: 300
        });
        
        // Emit QR code to all connected clients
        this.emitToClient('whatsapp_qr', { 
          qrCode: qrImageDataURL,
          message: 'Scan this QR code with your WhatsApp mobile app'
        });
        
        console.log('QR Code sent to clients');
      } catch (error) {
        console.error('Error generating QR code:', error);
        this.emitToClient('whatsapp_error', { error: 'Failed to generate QR code' });
      }
    });

    // Ready event
    this.client.on('ready', async () => {
      console.log('WhatsApp client is ready!');
      this.isReady = true;
      this.isAuthenticated = true;
      this.currentQRCode = null;
      this.authRetries = 0;
      
      // Emit ready status
      this.emitToClient('whatsapp_ready', { 
        message: 'WhatsApp connected successfully!' 
      });
      
      // Take screenshot after a short delay
      setTimeout(() => {
        this.takeScreenshot();
      }, 3000);
      
      // Load initial data
      await this.loadInitialData();
    });

    // Authentication success
    this.client.on('authenticated', () => {
      console.log('WhatsApp authenticated successfully!');
      this.isAuthenticated = true;
      this.emitToClient('whatsapp_authenticated', { 
        message: 'Authentication successful' 
      });
    });

    // Authentication failure
    this.client.on('auth_failure', (msg) => {
      console.error('WhatsApp authentication failed:', msg);
      this.isAuthenticated = false;
      this.authRetries++;
      
      if (this.authRetries >= this.maxAuthRetries) {
        this.emitToClient('whatsapp_auth_failed', { 
          error: 'Authentication failed after multiple attempts. Please restart the application.',
          retries: this.authRetries
        });
      } else {
        this.emitToClient('whatsapp_auth_failed', { 
          error: `Authentication failed: ${msg}. Retry ${this.authRetries}/${this.maxAuthRetries}`,
          retries: this.authRetries
        });
      }
    });

    // Disconnected event
    this.client.on('disconnected', (reason) => {
      console.log('WhatsApp client was logged out:', reason);
      this.isReady = false;
      this.isAuthenticated = false;
      this.currentQRCode = null;
      
      this.emitToClient('whatsapp_disconnected', { 
        reason: reason,
        message: 'WhatsApp disconnected. Please refresh to reconnect.'
      });
    });

    // Loading screen event
    this.client.on('loading_screen', (percent, message) => {
      console.log('WhatsApp loading:', percent, message);
      this.emitToClient('whatsapp_loading', { 
        percent: percent,
        message: message 
      });
    });
  }

  async takeScreenshot() {
    try {
      if (!this.client || !this.isReady) {
        return;
      }

      // Ensure puppeteer page is available
      if (!this.client.pupPage) {
        console.log('Puppeteer page not available for screenshot');
        return;
      }

      // Wait for WhatsApp to fully load
      await this.client.pupPage.waitForTimeout(2000);

      // Take screenshot
      const screenshot = await this.client.pupPage.screenshot({
        encoding: 'base64'
      });

      // Convert to base64
      const screenshotBase64 = `data:image/png;base64,${screenshot}`;

      // Emit screenshot to clients
      this.emitToClient('whatsapp_screenshot', {
        screenshot: screenshotBase64,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error taking screenshot:', error);
      this.emitToClient('whatsapp_error', { 
        error: 'Failed to capture WhatsApp screenshot' 
      });
    }
  }

  emitToClient(event, data) {
    if (this.socketIO) {
      this.socketIO.emit(event, data);
    }
  }

  async loadInitialData() {
    try {
      console.log('Loading WhatsApp data...');
      
      // Load all chats
      this.chats = await this.getAllChats();
      
      // Load all groups
      this.groups = await this.getAllGroups();
      
      // Load contacts
      this.contacts = await this.client.getContacts();
      
      console.log(`Loaded ${this.chats.length} chats, ${this.groups.length} groups, ${this.contacts.length} contacts`);
      
      // Emit updated status
      this.emitToClient('whatsapp_data_loaded', {
        chatsCount: this.chats.length,
        groupsCount: this.groups.length,
        contactsCount: this.contacts.length
      });
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
  }

  async getAllChats() {
    try {
      if (!this.isReady) {
        throw new Error('WhatsApp client is not ready');
      }

      const chats = await this.client.getChats();
      
      // Filter and format chats
      const formattedChats = chats.map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        isReadOnly: chat.isReadOnly,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
        lastMessage: chat.lastMessage ? {
          body: chat.lastMessage.body,
          timestamp: chat.lastMessage.timestamp,
          from: chat.lastMessage.from
        } : null
      }));

      // Store for future reference
      this.chats = formattedChats;
      
      return formattedChats;
    } catch (error) {
      console.error('Error getting all chats:', error);
      return [];
    }
  }

  async getAllGroups() {
    try {
      if (!this.isReady) {
        throw new Error('WhatsApp client is not ready');
      }

      const chats = await this.client.getChats();
      
      // Filter only groups
      const groups = chats
        .filter(chat => chat.isGroup)
        .map(group => ({
          id: group.id._serialized,
          name: group.name,
          description: group.description,
          participantCount: group.participants ? group.participants.length : 0,
          participants: group.participants ? group.participants.map(p => ({
            id: p.id._serialized,
            isAdmin: p.isAdmin,
            isSuperAdmin: p.isSuperAdmin
          })) : [],
          createdAt: group.createdAt,
          owner: group.owner ? group.owner._serialized : null,
          unreadCount: group.unreadCount,
          timestamp: group.timestamp,
          lastMessage: group.lastMessage ? {
            body: group.lastMessage.body,
            timestamp: group.lastMessage.timestamp,
            from: group.lastMessage.from
          } : null
        }));

      // Store for future reference
      this.groups = groups;
      
      return groups;
    } catch (error) {
      console.error('Error getting all groups:', error);
      return [];
    }
  }

  async getPrivateChats() {
    try {
      const chats = await this.getAllChats();
      return chats.filter(chat => !chat.isGroup);
    } catch (error) {
      console.error('Error getting private chats:', error);
      return [];
    }
  }

  async getChatById(chatId) {
    try {
      if (!this.isReady) {
        throw new Error('WhatsApp client is not ready');
      }

      const chat = await this.client.getChatById(chatId);
      return {
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
        lastMessage: chat.lastMessage
      };
    } catch (error) {
      console.error('Error getting chat by ID:', error);
      return null;
    }
  }

  async searchChats(query) {
    try {
      const allChats = await this.getAllChats();
      return allChats.filter(chat => 
        chat.name && chat.name.toLowerCase().includes(query.toLowerCase())
      );
    } catch (error) {
      console.error('Error searching chats:', error);
      return [];
    }
  }

  async searchGroups(query) {
    try {
      const allGroups = await this.getAllGroups();
      return allGroups.filter(group => 
        group.name && group.name.toLowerCase().includes(query.toLowerCase())
      );
    } catch (error) {
      console.error('Error searching groups:', error);
      return [];
    }
  }

  async sendMessage(chatId, message) {
    try {
      if (!this.isReady) {
        throw new Error('WhatsApp client is not ready');
      }

      const result = await this.client.sendMessage(chatId, message);
      console.log('Message sent successfully');
      return result;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async getContacts() {
    try {
      if (!this.isReady) {
        throw new Error('WhatsApp client is not ready');
      }

      const contacts = await this.client.getContacts();
      return contacts.map(contact => ({
        id: contact.id._serialized,
        name: contact.name,
        number: contact.number,
        pushname: contact.pushname,
        shortName: contact.shortName,
        isMe: contact.isMe,
        isUser: contact.isUser,
        isGroup: contact.isGroup,
        isWAContact: contact.isWAContact,
        profilePicUrl: contact.profilePicUrl
      }));
    } catch (error) {
      console.error('Error getting contacts:', error);
      return [];
    }
  }

  async refreshData() {
    try {
      await this.client.destroy();
      await this.initialize();
    } catch (error) {
      console.error('Error refreshing data:', error);
      throw error;
    }
  }

  async requestScreenshot() {
    await this.takeScreenshot();
  }

  getStatus() {
    return {
      isReady: this.isReady,
      isAuthenticated: this.isAuthenticated,
      clientId: this.clientId,
      chatsCount: this.chats.length,
      groupsCount: this.groups.length,
      contactsCount: this.contacts.length,
      hasQRCode: !!this.currentQRCode,
      authRetries: this.authRetries
    };
  }

  async logout() {
    try {
      if (this.client) {
        await this.client.logout();
        this.isReady = false;
        this.isAuthenticated = false;
        this.currentQRCode = null;
        console.log('WhatsApp client logged out successfully');
        
        this.emitToClient('whatsapp_logged_out', {
          message: 'WhatsApp logged out successfully'
        });
      }
    } catch (error) {
      console.error('Error logging out:', error);
      throw error;
    }
  }

  async destroy() {
    try {
      if (this.client) {
        await this.client.destroy();
        this.isReady = false;
        this.isAuthenticated = false;
        this.currentQRCode = null;
        console.log('WhatsApp client destroyed successfully');
      }
    } catch (error) {
      console.error('Error destroying client:', error);
      throw error;
    }
  }
}

// Utility function to wait
async function wait(sec) {
  return new Promise((resolve) => {
    setTimeout(resolve, sec * 1000);
  });
}

// Legacy function for backward compatibility
async function startCheckerBot(checkerId, socketIO = null) {
  const whatsappClient = new WhatsAppClient(checkerId, socketIO);
  await whatsappClient.initialize();
  return whatsappClient;
}

module.exports = { 
  WhatsAppClient, 
  startCheckerBot,
  wait 
};
