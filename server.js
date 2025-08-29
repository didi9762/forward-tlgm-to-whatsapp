require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { WhatsAppClient } = require('./whatsappSession');
const { MessageMedia } = require('whatsapp-web.js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

let bot = null;
let whatsappClient = null;

let telegramBotStatus = {
    isRunning: false,
    hasError: false,
    errorMessage: null,
    lastError: null
};

let config = {
    telegramBotToken: '',
    telegramChatId: '',
    whatsappGroups: '',
    port: 3000
};

// Initialize WhatsApp client
async function initWhatsAppClient() {
    try {
        console.log('Initializing WhatsApp client...');
        whatsappClient = new WhatsAppClient('telegram-forwarder', io);
        await whatsappClient.initialize();
        console.log('WhatsApp client initialized successfully');
    } catch (error) {
        console.error('Failed to initialize WhatsApp client:', error);
        // Emit error to all connected clients
        io.emit('whatsapp_init_error', { 
            error: error.message,
            message: 'Failed to initialize WhatsApp client'
        });
    }
}

// Add after existing variables
function loadConfigFromEnv() {
    config = {
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
        telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
        whatsappGroups: process.env.WHATSAPP_GROUPS || '',
        port: process.env.PORT || 3000
    };
    console.log('Configuration loaded from environment');
}

// Add this function to apply new configuration
function applyNewConfiguration(newConfig) {
    const oldConfig = { ...config };
    
    // Update config object
    config = {
        ...config,
        ...newConfig
    };
    
    // Update .env file
    updateEnvFile(newConfig);
    
    // Check if Telegram configuration changed
    const telegramChanged = oldConfig.telegramBotToken !== config.telegramBotToken || 
                           oldConfig.telegramChatId !== config.telegramChatId;
    
    if (telegramChanged) {
        console.log('Telegram configuration changed, restarting bot...');
        stopTelegramBot();
        setTimeout(() => {
            initTelegramBot();
        }, 1000);
    }
    
    // Emit configuration update to all clients
    io.emit('config_updated', {
        config: getPublicConfig(),
        message: 'Configuration updated successfully'
    });
    
    console.log('Configuration applied successfully');
}

// Add this function to get safe config for client
function getPublicConfig() {
    return {
        telegramBotToken: config.telegramBotToken,
        telegramChatId: config.telegramChatId,
        whatsappGroups: config.whatsappGroups,
        isConfigured: !!(config.telegramBotToken && config.telegramChatId)
    };
}

// Initialize Telegram bot if configuration exists
function initTelegramBot() {
    const token = config.telegramBotToken;
    const chatId = config.telegramChatId;
    
    if (token && chatId) {
        console.log('Initializing Telegram bot...');
        
        try {
            bot = new TelegramBot(token, { 
                polling: {
                    interval: 1000,
                    autoStart: true,
                    params: {
                        timeout: 10
                    }
                }
            });
            
            // Listen for all messages in the specified chat
            bot.on('message', (msg) => {
                if (msg.chat.id.toString() === chatId) {
                    console.log('Received message from Telegram:', {
                        from: msg.from.username || msg.from.first_name,
                        text: msg.text || msg.caption,
                        date: new Date(msg.date * 1000)
                    });
                    
                    // Forward to WhatsApp
                    forwardToWhatsApp(msg);
                }
            });
            
            bot.on('error', (error) => {
                console.error('Telegram bot error:', error);
            });
            
            // Handle polling errors
            bot.on('polling_error', (error) => {
                console.error('Telegram polling error:', error);
                
                telegramBotStatus = {
                    isRunning: false,
                    hasError: true,
                    errorMessage: error.message,
                    lastError: new Date().toISOString()
                };
                
                // Emit error to all connected clients
                io.emit('telegram_error', {
                    error: error.message,
                    code: error.code,
                    timestamp: telegramBotStatus.lastError,
                    message: 'Telegram bot encountered an error and has been stopped'
                });
                
                // Stop the bot to prevent continuous errors
                stopTelegramBot();
            });
            
            // Handle successful connection
            bot.getMe().then((botInfo) => {
                console.log(`Telegram bot connected successfully: @${botInfo.username}`);
                telegramBotStatus = {
                    isRunning: true,
                    hasError: false,
                    errorMessage: null,
                    lastError: null,
                    botInfo: {
                        username: botInfo.username,
                        firstName: botInfo.first_name,
                        id: botInfo.id
                    }
                };
                
                io.emit('telegram_connected', {
                    botInfo: telegramBotStatus.botInfo,
                    chatId: chatId,
                    message: `Bot @${botInfo.username} is listening to chat ID: ${chatId}`
                });
                
                console.log(`Bot is listening to chat ID: ${chatId}`);
            }).catch((error) => {
                console.error('Failed to get bot info:', error);
                telegramBotStatus = {
                    isRunning: false,
                    hasError: true,
                    errorMessage: 'Invalid bot token or API error',
                    lastError: new Date().toISOString()
                };
                
                io.emit('telegram_error', {
                    error: error.message,
                    message: 'Failed to connect to Telegram bot. Please check your bot token.'
                });
                
                stopTelegramBot();
            });
        } catch (error) {
            console.error('Failed to initialize Telegram bot:', error);
            telegramBotStatus = {
                isRunning: false,
                hasError: true,
                errorMessage: error.message,
                lastError: new Date().toISOString()
            };
            io.emit('telegram_error', {
                error: error.message,
                message: 'Failed to initialize Telegram bot'
            });
        }
    } else {
        console.log('Telegram bot not configured. Please set up configuration via web interface.');
        telegramBotStatus = {
            isRunning: false,
            hasError: false,
            errorMessage: null,
            lastError: null
        };
        io.emit('telegram_not_configured', {
            message: 'Telegram bot not configured. Please set up configuration via web interface.'
        });
    }
}

// Forward message to WhatsApp groups
async function forwardToWhatsApp(telegramMessage) {
    try {
        if (!whatsappClient || !whatsappClient.isReady) {
            console.log('WhatsApp client not ready, message not forwarded');
            return;
        }

        const whatsappGroupIds = config.whatsappGroups;
        if (!whatsappGroupIds) {
            console.log('WhatsApp groups not configured');
            return;
        }

        // Parse group IDs (comma-separated)
        const groupIds = whatsappGroupIds.split(',').map(id => id.trim()).filter(id => id);
        
        if (groupIds.length === 0) {
            console.log('No WhatsApp groups configured');
            return;
        }

        let messageContent = null;
        let mediaContent = null;

        // Handle different message types
        if (telegramMessage.text) {
            // Text message - forward as-is
            messageContent = telegramMessage.text;
        } else if (telegramMessage.photo) {
            // Photo message
            const photo = telegramMessage.photo[telegramMessage.photo.length - 1]; // Get highest resolution
            const fileLink = await bot.getFileLink(photo.file_id);
            mediaContent = await MessageMedia.fromUrl(fileLink);
            messageContent = telegramMessage.caption || '';
        } else if (telegramMessage.video) {
            // Video message
            const fileLink = await bot.getFileLink(telegramMessage.video.file_id);
            mediaContent = await MessageMedia.fromUrl(fileLink);
            messageContent = telegramMessage.caption || '';
        } else if (telegramMessage.document) {
            // Document message
            const fileLink = await bot.getFileLink(telegramMessage.document.file_id);
            mediaContent = await MessageMedia.fromUrl(fileLink);
            mediaContent.filename = telegramMessage.document.file_name;
            messageContent = telegramMessage.caption || '';
        } else if (telegramMessage.audio) {
            // Audio message
            const fileLink = await bot.getFileLink(telegramMessage.audio.file_id);
            mediaContent = await MessageMedia.fromUrl(fileLink);
            messageContent = telegramMessage.caption || '';
        } else if (telegramMessage.voice) {
            // Voice message
            const fileLink = await bot.getFileLink(telegramMessage.voice.file_id);
            mediaContent = await MessageMedia.fromUrl(fileLink);
            messageContent = telegramMessage.caption || '';
        } else if (telegramMessage.sticker) {
            // Sticker message
            const fileLink = await bot.getFileLink(telegramMessage.sticker.file_id);
            mediaContent = await MessageMedia.fromUrl(fileLink);
            messageContent = '';
        } else if (telegramMessage.video_note) {
            // Video note (circle video)
            const fileLink = await bot.getFileLink(telegramMessage.video_note.file_id);
            mediaContent = await MessageMedia.fromUrl(fileLink);
            messageContent = '';
        } else {
            // Unsupported message type
            messageContent = '[Unsupported message type]';
        }
        
        // Send to all configured groups
        const sendPromises = groupIds.map(async (groupId) => {
            try {
                if (mediaContent) {
                    console.log('Sending media with caption:', messageContent);
                    // Send media with optional caption
                    await whatsappClient.sendMessage(groupId, mediaContent, { caption: messageContent });
                } else {
                    // Send text message
                    await whatsappClient.sendMessage(groupId, messageContent);
                }
                console.log(`Message forwarded to WhatsApp group: ${groupId}`);
                return { groupId, success: true };
            } catch (error) {
                console.error(`Failed to forward to group ${groupId}:`, error);
                return { groupId, success: false, error: error.message };
            }
        });

        const results = await Promise.all(sendPromises);
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log(`Message forwarding complete: ${successful} successful, ${failed} failed`);
        
        if (failed > 0) {
            console.log('Failed groups:', results.filter(r => !r.success));
        }
        
    } catch (error) {
        console.error('Error in forwardToWhatsApp:', error);
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send current WhatsApp status to newly connected client
    if (whatsappClient) {
        const status = whatsappClient.getStatus();
        socket.emit('whatsapp_status_update', status);
        
        // If authenticated, take a screenshot
        if (status.isAuthenticated && status.isReady) {
            setTimeout(() => {
                whatsappClient.requestScreenshot();
            }, 1000);
        }
    }
    
    // Handle client requests
    socket.on('request_screenshot', () => {
        if (whatsappClient && whatsappClient.isReady) {
            whatsappClient.requestScreenshot();
        }
    });
    
    socket.on('request_status', () => {
        if (whatsappClient) {
            socket.emit('whatsapp_status_update', whatsappClient.getStatus());
        }
    });

    socket.on('request_telegram_restart', () => {
        restartTelegramBot();
    });

    socket.on('request_telegram_status', () => {
        socket.emit('telegram_status_update', telegramBotStatus);
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

app.get('/api/config', (req, res) => {
    res.json(getPublicConfig());
});

// WhatsApp specific routes
app.get('/api/whatsapp/status', (req, res) => {
    if (!whatsappClient) {
        return res.json({ ready: false, message: 'WhatsApp client not initialized' });
    }
    
    res.json(whatsappClient.getStatus());
});

app.get('/api/whatsapp/chats', async (req, res) => {
    try {
        if (!whatsappClient || !whatsappClient.isReady) {
            return res.status(400).json({ error: 'WhatsApp client not ready' });
        }
        
        const chats = await whatsappClient.getAllChats();
        res.json(chats);
    } catch (error) {
        console.error('Error getting chats:', error);
        res.status(500).json({ error: 'Failed to get chats' });
    }
});

app.get('/api/whatsapp/groups', async (req, res) => {
    try {
        if (!whatsappClient || !whatsappClient.isReady) {
            return res.status(400).json({ error: 'WhatsApp client not ready' });
        }
        
        const groups = await whatsappClient.getAllGroups();
        res.json(groups);
    } catch (error) {
        console.error('Error getting groups:', error);
        res.status(500).json({ error: 'Failed to get groups' });
    }
});

app.get('/api/whatsapp/private-chats', async (req, res) => {
    try {
        if (!whatsappClient || !whatsappClient.isReady) {
            return res.status(400).json({ error: 'WhatsApp client not ready' });
        }
        
        const privateChats = await whatsappClient.getPrivateChats();
        res.json(privateChats);
    } catch (error) {
        console.error('Error getting private chats:', error);
        res.status(500).json({ error: 'Failed to get private chats' });
    }
});

app.get('/api/whatsapp/contacts', async (req, res) => {
    try {
        if (!whatsappClient || !whatsappClient.isReady) {
            return res.status(400).json({ error: 'WhatsApp client not ready' });
        }
        
        const contacts = await whatsappClient.getContacts();
        res.json(contacts);
    } catch (error) {
        console.error('Error getting contacts:', error);
        res.status(500).json({ error: 'Failed to get contacts' });
    }
});

app.post('/api/whatsapp/search-chats', async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!whatsappClient || !whatsappClient.isReady) {
            return res.status(400).json({ error: 'WhatsApp client not ready' });
        }
        
        const results = await whatsappClient.searchChats(query);
        res.json(results);
    } catch (error) {
        console.error('Error searching chats:', error);
        res.status(500).json({ error: 'Failed to search chats' });
    }
});

app.post('/api/whatsapp/search-groups', async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!whatsappClient || !whatsappClient.isReady) {
            return res.status(400).json({ error: 'WhatsApp client not ready' });
        }
        
        const results = await whatsappClient.searchGroups(query);
        res.json(results);
    } catch (error) {
        console.error('Error searching groups:', error);
        res.status(500).json({ error: 'Failed to search groups' });
    }
});

app.post('/api/whatsapp/refresh', async (req, res) => {
    try {
        if (!whatsappClient || !whatsappClient.isReady) {
            return res.status(400).json({ error: 'WhatsApp client not ready' });
        }
        
        const data = await whatsappClient.refreshData();
        res.json(data);
    } catch (error) {
        console.error('Error refreshing WhatsApp data:', error);
        res.status(500).json({ error: 'Failed to refresh data' });
    }
});

app.post('/api/whatsapp/screenshot', async (req, res) => {
    try {
        if (!whatsappClient || !whatsappClient.isReady) {
            return res.status(400).json({ error: 'WhatsApp client not ready' });
        }
        
        await whatsappClient.requestScreenshot();
        res.json({ success: true, message: 'Screenshot requested' });
    } catch (error) {
        console.error('Error requesting screenshot:', error);
        res.status(500).json({ error: 'Failed to capture screenshot' });
    }
});

app.post('/api/config', (req, res) => {
    const { telegramBotToken, telegramChatId, whatsappGroups } = req.body;
    
    if (!telegramBotToken || !telegramChatId) {
        return res.status(400).json({ error: 'Both Telegram bot token and chat ID are required' });
    }
    
    try {
        // Update .env file
        const envUpdate = {
            TELEGRAM_BOT_TOKEN: telegramBotToken,
            TELEGRAM_CHAT_ID: telegramChatId
        };
        
        if (whatsappGroups !== undefined) {
            envUpdate.WHATSAPP_GROUPS = whatsappGroups;
        }
        
        updateEnvFile(envUpdate);
        
        // Apply configuration without restart
        applyNewConfiguration({
            telegramBotToken,
            telegramChatId,
            whatsappGroups: whatsappGroups || ''
        });
        
        res.json({ 
            success: true, 
            message: 'Configuration updated successfully without restart!' 
        });
        
    } catch (error) {
        console.error('Error saving configuration:', error);
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// Test telegram connection endpoint
app.post('/api/test-telegram', async (req, res) => {
    const { telegramBotToken } = req.body;
    
    if (!telegramBotToken) {
        return res.status(400).json({ error: 'Telegram bot token is required' });
    }
    
    try {
        const testBot = new TelegramBot(telegramBotToken);
        const botInfo = await testBot.getMe();
        res.json({ 
            success: true, 
            botInfo: {
                username: botInfo.username,
                firstName: botInfo.first_name,
                id: botInfo.id
            }
        });
    } catch (error) {
        console.error('Telegram bot test failed:', error);
        res.status(400).json({ error: 'Invalid Telegram bot token or API error' });
    }
});

app.get('/api/telegram/status', (req, res) => {
    res.json(telegramBotStatus);
});

app.post('/api/telegram/restart', (req, res) => {
    restartTelegramBot();
    res.json({ success: true, message: 'Telegram bot restart initiated' });
});

function updateEnvFile(newVars) {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    // Read existing .env file if it exists
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Parse existing variables
    const envVars = {};
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            envVars[key.trim()] = valueParts.join('=').trim();
        }
    });
    
    // Update with new variables
    Object.assign(envVars, newVars);
    
    // Write back to file
    const newContent = Object.entries(envVars)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    
    fs.writeFileSync(envPath, newContent);
}

function stopTelegramBot() {
    if (bot) {
        try {
            bot.stopPolling();
            console.log('Telegram bot polling stopped');
        } catch (error) {
            console.error('Error stopping Telegram bot:', error);
        }
        bot = null;
    }
    
    telegramBotStatus.isRunning = false;
    io.emit('telegram_stopped', {
        message: 'Telegram bot has been stopped'
    });
}

function restartTelegramBot() {
    console.log('Restarting Telegram bot...');
    stopTelegramBot();
    setTimeout(() => {
        initTelegramBot();
    }, 2000);
}

// Start server
loadConfigFromEnv();

server.listen(PORT, process.env.HOST || '0.0.0.0', async () => {
    console.log(`Configuration server running on http://${process.env.HOST || '0.0.0.0'}:${PORT}`);
    
    // Load configuration from environment
    
    // Initialize WhatsApp client first
    await initWhatsAppClient();
    
    // Then initialize Telegram bot
    initTelegramBot();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    
    if (bot) {
        bot.stopPolling();
    }
    
    if (whatsappClient) {
        await whatsappClient.destroy();
    }
    
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    
    if (bot) {
        bot.stopPolling();
    }
    
    if (whatsappClient) {
        await whatsappClient.destroy();
    }
    
    server.close(() => {
        process.exit(0);
    });
});

// Export for use in other modules
module.exports = { whatsappClient };
