module.exports = {
  apps: [{
    name: 'bot-tlgrm-wsp',
    script: 'npm start',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    // Auto-restart configuration
    restart_delay: 1000,
    max_restarts: 4,
    min_uptime: '20s',
    // Logging
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // Process management
    kill_timeout: 5000,
    listen_timeout: 3000,
    // Monitoring
    monitoring: false
  }]
};
