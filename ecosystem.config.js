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
    max_restarts: 10,
    min_uptime: '10s',
    // Logging
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // Process management
    kill_timeout: 5000,
    listen_timeout: 3000,
    // Monitoring
    monitoring: false
  }]
};
