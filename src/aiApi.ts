import express from 'express';
import { database } from './db';
import { askModel } from './openRouter';

const router = express.Router();

export interface SystemPrompt {
    id: string;
    prompt: string;
    model?: string;
    temperature?: number;
}

/**
 * Get the current system prompt and settings
 */
router.get('/system-prompt', async (req, res) => {
    try {
        const dbResult = await database('system_prompts');
        if (!dbResult) {
            return res.status(500).json({
                success: false,
                message: 'Database connection failed'
            });
        }

        const { conn, coll } = dbResult;
        
        try {
            const prompt = await coll.findOne({});
            
            if (!prompt) {
                // Return default prompt if none exists
                const defaultPrompt = {
                    id: 'main',
                    prompt: 'You are a helpful assistant that translates and processes messages. Translate the following message while maintaining its original meaning and tone:',
                    model: 'anthropic/claude-3.5-sonnet',
                    temperature: 0.0
                };
                
                return res.json({
                    success: true,
                    message: 'System prompt retrieved successfully',
                    prompt: defaultPrompt
                });
            }
            
            res.json({
                success: true,
                message: 'System prompt retrieved successfully',
                prompt: prompt
            });
        } finally {
            await conn.close();
        }
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error retrieving system prompt',
            error: error.message
        });
    }
});

/**
 * Update the system prompt
 */
router.put('/system-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;

        const dbResult = await database('system_prompts');
        if (!dbResult) {
            return res.status(500).json({
                success: false,
                message: 'Database connection failed'
            });
        }

        const { conn, coll } = dbResult;
        
        try {
            // Check if a prompt already exists
            const existingPrompt = await coll.findOne({});
            
            const promptData: SystemPrompt = {
                id: 'main',
                prompt: prompt,
                model: 'anthropic/claude-3.5-sonnet',
                temperature: 0.0
            };

            if (existingPrompt) {
                // Update existing prompt, preserve model and temperature
                await coll.updateOne(
                    {},
                    { $set: { ...promptData, model: existingPrompt.model || 'anthropic/claude-3.5-sonnet', temperature: existingPrompt.temperature || 0.0 } }
                );
            } else {
                // Create new prompt with defaults
                promptData.model = 'anthropic/claude-3.5-sonnet';
                promptData.temperature = 0.0;
                await coll.insertOne(promptData);
            }

            const updatedPrompt = await coll.findOne({});
            
            res.json({
                success: true,
                message: 'System prompt updated successfully',
                prompt: updatedPrompt
            });
        } finally {
            await conn.close();
        }
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error updating system prompt',
            error: error.message
        });
    }
});

/**
 * Update AI model and temperature settings
 */
router.put('/ai-settings', async (req, res) => {
    try {
        const { model, temperature } = req.body;
        
        if (!model) {
            return res.status(400).json({
                success: false,
                message: 'Model is required'
            });
        }

        if (temperature === undefined || temperature < 0 || temperature > 2) {
            return res.status(400).json({
                success: false,
                message: 'Temperature must be between 0 and 2'
            });
        }

        const dbResult = await database('system_prompts');
        if (!dbResult) {
            return res.status(500).json({
                success: false,
                message: 'Database connection failed'
            });
        }

        const { conn, coll } = dbResult;
        
        try {
            // Check if a prompt already exists
            const existingPrompt = await coll.findOne({});
            
            if (existingPrompt) {
                // Update existing settings
                await coll.updateOne(
                    {},
                    { $set: { model: model, temperature: temperature } }
                );
            } else {
                // Create new document with defaults
                const defaultPrompt = {
                    id: 'main',
                    prompt: 'You are a helpful assistant that translates and processes messages. Translate the following message while maintaining its original meaning and tone:',
                    model: model,
                    temperature: temperature
                };
                await coll.insertOne(defaultPrompt);
            }

            const updatedPrompt = await coll.findOne({});
            
            res.json({
                success: true,
                message: 'AI settings updated successfully',
                prompt: updatedPrompt
            });
        } finally {
            await conn.close();
        }
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error updating AI settings',
            error: error.message
        });
    }
});

/**
 * Test translation with the current system prompt
 */
router.post('/test-translation', async (req, res) => {
    try {
        const { message, model, temperature } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Message is required'
            });
        }

        // Get the current system prompt
        const dbResult = await database('system_prompts');
        if (!dbResult) {
            return res.status(500).json({
                success: false,
                message: 'Database connection failed'
            });
        }

        const { conn, coll } = dbResult;
        
        try {
            const promptDoc = await coll.findOne({});
            
            if (!promptDoc) {
                return res.status(500).json({
                    success: false,
                    message: 'System prompt not found'
                });
            }

            if (!promptDoc.prompt) {
                return res.status(500).json({
                    success: false,
                    message: 'System prompt is empty'
                });
            }
            
            let systemPrompt = promptDoc.prompt;
            
            // Use provided model and temperature, or fall back to database values
            const useModel = model || promptDoc.model || 'anthropic/claude-3.5-sonnet';
            const useTemperature = temperature !== undefined ? temperature : (promptDoc.temperature || 0.0);

            // Combine system prompt with the message
            const fullPrompt = `${systemPrompt}\n\nMessage to translate: ${message}`;

            // Call OpenRouter API
            const translation = await askModel(fullPrompt, useModel, useTemperature);
            
            if (!translation) {
                return res.status(500).json({
                    success: false,
                    message: 'Translation failed - no response from AI model'
                });
            }

            res.json({
                success: true,
                message: 'Translation completed successfully',
                data: {
                    originalMessage: message,
                    systemPrompt: systemPrompt,
                    translation: translation,
                    model: useModel,
                    temperature: useTemperature
                }
            });
        } finally {
            await conn.close();
        }
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error testing translation',
            error: error.message
        });
    }
});

export default router;
