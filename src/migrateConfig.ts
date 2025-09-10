import * as fs from 'fs';
import { configManager } from './configManager';
import { database } from './db';

interface OldAppConfig {
    groupToSend: string;
    telegramListeningChannels: string[];
    forwardingRules: any[];
    autoStartForwarding: boolean;
}

async function migrateConfigFromFileToDatabase(): Promise<void> {
    const configFilePath = 'config.json';
    
    try {
        // Check if config.json exists
        if (!fs.existsSync(configFilePath)) {
            console.log('No config.json file found, nothing to migrate');
            return;
        }

        // Read the existing config file
        const configData = fs.readFileSync(configFilePath, 'utf8');
        const oldConfig: OldAppConfig = JSON.parse(configData);
        
        console.log('Found existing config.json, migrating to database...');
        console.log('Old config:', oldConfig);

        // Initialize the config manager (this will create default config in DB if none exists)
        await configManager.initialize();

        // Update the database with the old config data
        await configManager.update({
            groupToSend: oldConfig.groupToSend,
            telegramListeningChannels: oldConfig.telegramListeningChannels,
            forwardingRules: oldConfig.forwardingRules.map(rule => ({
                ...rule,
                createdAt: new Date(rule.createdAt),
                lastModified: new Date(rule.lastModified)
            })),
            autoStartForwarding: oldConfig.autoStartForwarding
        });

        console.log('✅ Configuration successfully migrated to database!');
        
        // Optionally backup the old config file
        const backupPath = `config.json.backup.${Date.now()}`;
        fs.renameSync(configFilePath, backupPath);
        console.log(`📦 Old config file backed up as: ${backupPath}`);

        // Verify the migration
        const newConfig = await configManager.getConfig();
        console.log('✅ Verification - New database config:', newConfig);

    } catch (error) {
        console.error('❌ Error during migration:', error);
        throw error;
    }
}

// Run migration if this file is executed directly
if (require.main === module) {
    migrateConfigFromFileToDatabase()
        .then(() => {
            console.log('Migration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration failed:', error);
            process.exit(1);
        });
}

export { migrateConfigFromFileToDatabase };
