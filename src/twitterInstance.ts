import { TwitterApi, ETwitterStreamEvent, TweetV2, UserV2 } from 'twitter-api-v2';
import * as fs from 'fs';
import * as path from 'path';
import { configManager, TwitterAccount } from './configManager';
import { getActiveListeningConfigs } from './db';

export interface TwitterMessage {
    id: string;
    text: string;
    date: Date;
    authorId: string;
    authorName: string;
    authorUsername: string;
    isRetweet: boolean;
    retweetedFrom?: string;
    mediaType?: 'photo' | 'video' | 'gif';
    hasMedia: boolean;
    mediaUrls?: string[];
    replyToTweetId?: string;
    replyToUserId?: string;
    hashtags?: string[];
    mentions?: string[];
    urls?: string[];
}

export class TwitterInstance {
    private client: TwitterApi | null = null;
    private isInitialized: boolean = false;
    private isStreaming: boolean = false;
    private currentStream: any = null;
    private listeningAccounts: Set<string> = new Set();
    private messageHandlers: ((message: TwitterMessage) => void)[] = [];
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private keepAliveInterval: NodeJS.Timeout | null = null;
    private isKeepAliveActive: boolean = false;

    constructor() {
        this.loadListeningAccountsFromConfig();
    }

    /**
     * Initialize the Twitter client
     */
    public async initialize(): Promise<void> {
        try {
            const apiKey = process.env.TWITTER_API_KEY;
            const apiSecret = process.env.TWITTER_API_SECRET;
            const accessToken = process.env.TWITTER_ACCESS_TOKEN;
            const accessSecret = process.env.TWITTER_ACCESS_SECRET;

            if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
                throw new Error('Twitter API credentials not found. Please set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, and TWITTER_ACCESS_SECRET environment variables.');
            }

            this.client = new TwitterApi({
                appKey: apiKey,
                appSecret: apiSecret,
                accessToken: accessToken,
                accessSecret: accessSecret,
            });

            // Test the connection
            const user = await this.client.currentUser();
            console.log(`Twitter client initialized successfully. Logged in as: @${user.screen_name}`);

            this.isInitialized = true;

            // Auto-start listening if there are configured accounts
            if (this.listeningAccounts.size > 0) {
                console.log(`Auto-starting listening to ${this.listeningAccounts.size} configured accounts`);
                if (this.hasActiveForwardingRules()) {
                    this.startKeepAlive();
                }
            }

        } catch (error) {
            console.error('Error initializing Twitter client:', error);
            throw error;
        }
    }

    /**
     * Load listening accounts from config
     */
    private loadListeningAccountsFromConfig(): void {
        const configAccounts = configManager.getTwitterAccountIds();
        this.listeningAccounts = new Set(configAccounts);
        if (configAccounts.length > 0) {
            console.log(`Loaded ${configAccounts.length} listening accounts from config:`, configAccounts);
        }
    }

    /**
     * Save listening accounts to config
     */
    private async saveListeningAccountsToConfig(): Promise<void> {
        try {
            const accountArray = Array.from(this.listeningAccounts);
            await configManager.setTwitterAccountIds(accountArray);
            console.log(`Saved ${accountArray.length} listening accounts to config`);
        } catch (error) {
            console.error('Error saving listening accounts to config:', error);
        }
    }

    /**
     * Search for accounts by username
     */
    public async searchAccounts(query: string): Promise<TwitterAccount[]> {
        try {
            if (!this.isInitialized || !this.client) {
                throw new Error('Twitter client is not initialized');
            }

            console.log(`Searching for accounts: ${query}`);
            if (query.startsWith('@')) {
                query = query.slice(1);
            }
            const users = await this.client.v2.userByUsername(query, {
                'user.fields': ['id', 'username', 'name', 'public_metrics', 'verified']
            });

            const accounts: TwitterAccount[] = users.data ? [{
                id: users.data.id,
                username: users.data.username,
                name: users.data.name
            }] : [];

            console.log(`Found ${accounts.length} accounts for query: ${query}`);
            return accounts;
        } catch (error: any) {
            if (error.code === 429 && error.rateLimit) {
                throw new Error(this.logRateLimitError(error, 'Error searching accounts:'));
            } else {
                throw new Error(this.logRateLimitError(error, 'Error searching accounts:'));
            }
        }
    }

    /**
     * Start listening to tweets from specific accounts
     */
    public async startListening(accounts: TwitterAccount[], saveToConfig: boolean = true): Promise<void> {
        try {
            if (!this.isInitialized || !this.client) {
                throw new Error('Twitter client is not initialized');
            }

            // Add account IDs to listening set
            accounts.forEach(account => this.listeningAccounts.add(account.id));

            // Save to config if requested
            if (saveToConfig) {
                // Update config with full account information
                for (const account of accounts) {
                    await configManager.addTwitterAccount(account);
                }
            }

            // Start streaming if not already active
            if (!this.isStreaming) {
                await this.startStreaming();
            }

            // Start keep-alive if we now have forwarding rules and it's not already active
            if (this.hasActiveForwardingRules() && !this.isKeepAliveActive) {
                this.startKeepAlive();
            }

            console.log(`Started listening to ${accounts.length} accounts:`, accounts.map(a => `@${a.username}`));
        } catch (error) {
            console.error('Error starting to listen to accounts:', error);
            throw error;
        }
    }

    /**
     * Stop listening to tweets from specific accounts
     */
    public stopListening(accountIds: string[], saveToConfig: boolean = true): void {
        accountIds.forEach(id => this.listeningAccounts.delete(id));

        // Save to config if requested
        if (saveToConfig) {
            accountIds.forEach(id => configManager.removeTwitterAccount(id));
        }

        // Stop streaming if no more accounts to listen to
        if (this.listeningAccounts.size === 0 && this.isStreaming) {
            this.stopStreaming();
        }

        // Stop keep-alive if no more forwarding rules
        if (!this.hasActiveForwardingRules() && this.isKeepAliveActive) {
            this.stopKeepAlive();
        }

        console.log(`Stopped listening to ${accountIds.length} accounts`);
    }

    /**
     * Get list of accounts currently being listened to
     */
    public getListeningAccounts(): TwitterAccount[] {
        const allAccounts = configManager.getTwitterAccounts();
        // return allAccounts.filter(account => this.listeningAccounts.has(account.id));
        return allAccounts;
    }

    private getLastSinceId(): string | null {
        const lastSinceId = configManager.getLastSinceId();
        return lastSinceId ? lastSinceId : null;
    }

    private setLastSinceId(sinceId: string): void {
        configManager.setLastSinceId(sinceId);
    }


    /**
     * Add a message handler
     */
    public onMessage(handler: (message: TwitterMessage) => void): void {
        this.messageHandlers.push(handler);

        // Start keep-alive if we now have forwarding rules and it's not already active
        if (this.hasActiveForwardingRules() && !this.isKeepAliveActive) {
            this.startKeepAlive();
        }
    }

    /**
     * Remove a message handler
     */
    public removeMessageHandler(handler: (message: TwitterMessage) => void): void {
        const index = this.messageHandlers.indexOf(handler);
        if (index > -1) {
            this.messageHandlers.splice(index, 1);
        }

        // Stop keep-alive if no more forwarding rules
        if (!this.hasActiveForwardingRules() && this.isKeepAliveActive) {
            this.stopKeepAlive();
        }
    }

    /**
     * Start streaming tweets
     */
    private async startStreaming(): Promise<void> {
        try {
            if (!this.client || this.isStreaming) {
                return;
            }

            const accountIds = Array.from(this.listeningAccounts);
            if (accountIds.length === 0) {
                console.log('No accounts to listen to');
                return;
            }

            console.log(`Starting Twitter monitoring for ${accountIds.length} accounts...`);

            // Instead of streaming, we'll use polling with search API
            // This approach works with OAuth 1.0a User Context
            this.startPolling();
            this.isStreaming = true;
            console.log('Twitter monitoring started successfully');

        } catch (error) {
            console.error('Error starting Twitter monitoring:', error);
            throw error;
        }
    }

    /**
     * Start polling for new tweets
     */
    private startPolling(): void {
        // Poll every 30 seconds for new tweets
        this.currentStream = setInterval(async () => {
            try {
                await this.fetchRecentTweetsFromUsers();
            } catch (error) {
                console.error('Error checking for new tweets:', error);
            }
        }, 1000 * 60 * 2); // 5 minutes
    }

    /**
     * Check for new tweets from monitored accounts
     */
    private async checkForNewTweets(): Promise<void> {
        if (!this.client) return;

        const accountIds = Array.from(this.listeningAccounts);
        if (accountIds.length === 0) return;

        try {
            // Calculate the cutoff time (3 hours ago)
            const threeHoursAgo = new Date();
            threeHoursAgo.setHours(threeHoursAgo.getHours() - 3);

            // Get tweets from each account
            for (const accountId of accountIds) {
                const tweets = await this.client.v2.userTimeline(accountId, {
                    'tweet.fields': ['id', 'text', 'created_at', 'author_id', 'public_metrics', 'referenced_tweets', 'entities', 'attachments'],
                    'user.fields': ['id', 'username', 'name', 'verified'],
                    'media.fields': ['type', 'url', 'preview_image_url'],
                    'expansions': ['author_id', 'attachments.media_keys', 'referenced_tweets.id', 'referenced_tweets.id.author_id'],
                    max_results: 10 // Increased to account for filtering
                });

                for await (const tweet of tweets) {
                    // Check if tweet is newer than 3 hours
                    if (!tweet.created_at) {
                        console.log(`Skipping tweet ${tweet.id} - no creation date`);
                        continue;
                    }

                    const tweetDate = new Date(tweet.created_at);
                    if (tweetDate < threeHoursAgo) {
                        console.log(`Skipping tweet from @${tweet.author_id} (${tweet.id}) - older than 3 hours`);
                        continue;
                    }

                    await this.handleTweet(tweet, tweets.includes);
                }
            }
        } catch (error: any) {
            if (error.code === 429 && error.rateLimit) {
                console.error(this.logRateLimitError(error, 'Error fetching tweets:'));
            } else {
                console.error('Error fetching tweets:', error);
            }
        }
    }

    private async fetchRecentTweetsFromUsers(sinceMinutes = 3): Promise<void> {
        if (!this.client) return;

        const accounts = this.getListeningAccounts();
        if (accounts.length === 0) return;

        // Build OR query: from:user1 OR from:user2 ...
        const query = accounts.map(u => `from:${u.username}`).join(' OR ');

        // Cutoff timestamp (sinceMinutes ago)
        const startTime = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();

        try {
            const params: any = {
                'tweet.fields': ['id', 'text', 'created_at', 'author_id', 'public_metrics', 'referenced_tweets', 'entities', 'attachments'],
                'user.fields': ['id', 'username', 'name', 'verified'],
                'media.fields': ['type', 'url', 'preview_image_url'],
                'expansions': ['author_id', 'attachments.media_keys', 'referenced_tweets.id', 'referenced_tweets.id.author_id'],
                max_results: 100, // up to 100
            }
            const sinceId = this.getLastSinceId();

            if (sinceId) {
                params.since_id = sinceId;
            } else {
                params.start_time = startTime;
            }

            const res = await this.client.v2.search(query, params);
            console.log('Fetched tweets from users:', res.tweets.length);


            for await (const tweet of res) {
                await this.handleTweet(tweet, res.includes);
            }

            const lastTweet = res.tweets.sort((a: TweetV2, b: TweetV2) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime())[0];
            this.setLastSinceId(lastTweet?.id || '');

        } catch (error: any) {
            if (error.code === 429 && error.rateLimit) {
                console.error(this.logRateLimitError(error, 'Error fetching tweets:'));
            } else {
                console.error('Error fetching tweets:', error);
            }
        }
    }

    /**
     * Handle incoming tweet
     */
    private async handleTweet(tweet: TweetV2, includes?: any): Promise<void> {
        try {
            // Get author information
            const author = includes?.users?.find((user: any) => user.id === tweet.author_id);
            if (!author) {
                console.log('Author information not found for tweet:', tweet.id);
                return;
            }

            // Check if this is a retweet
            const isRetweet = tweet.referenced_tweets?.some((ref: any) => ref.type === 'retweeted');
            let retweetedFrom: string | undefined;

            if (isRetweet) {
                const retweetRef = tweet.referenced_tweets?.find((ref: any) => ref.type === 'retweeted');
                if (retweetRef) {
                    const originalAuthor = includes?.users?.find((user: any) => user.id === retweetRef.id);
                    retweetedFrom = originalAuthor ? `@${originalAuthor.username}` : 'Unknown';
                }
            }

            // Extract media information
            const media = includes?.media || [];
            const hasMedia = media.length > 0;
            const mediaType = hasMedia ? this.getMediaType(media[0]) : undefined;
            const mediaUrls = media.map((m: any) => m.url || m.preview_image_url).filter(Boolean);

            // Extract hashtags and mentions
            const hashtags = tweet.entities?.hashtags?.map((h: any) => h.tag) || [];
            const mentions = tweet.entities?.mentions?.map((m: any) => m.username) || [];
            const urls = tweet.entities?.urls?.map((u: any) => u.expanded_url || u.url) || [];

            // Create Twitter message object
            const twitterMessage: TwitterMessage = {
                id: tweet.id,
                text: tweet.text,
                date: new Date(tweet.created_at || ''),
                authorId: author.id,
                authorName: author.name,
                authorUsername: author.username,
                isRetweet: isRetweet || false,
                retweetedFrom: retweetedFrom,
                mediaType: mediaType,
                hasMedia: hasMedia,
                mediaUrls: mediaUrls,
                replyToTweetId: tweet.in_reply_to_user_id ? tweet.referenced_tweets?.find((ref: any) => ref.type === 'replied_to')?.id : undefined,
                replyToUserId: tweet.in_reply_to_user_id,
                hashtags: hashtags,
                mentions: mentions,
                urls: urls
            };

            console.log(`New tweet from @${twitterMessage.authorUsername}: ${twitterMessage.text.substring(0, 100)}${twitterMessage.text.length > 100 ? '...' : ''}`);

            // Call all message handlers
            this.messageHandlers.forEach((handler, index) => {
                try {
                    handler(twitterMessage);
                } catch (error) {
                    console.error(`Error in message handler ${index + 1}:`, error);
                }
            });

        } catch (error) {
            console.error('Error processing tweet:', error);
        }
    }

    /**
     * Stop streaming tweets
     */
    private stopStreaming(): void {
        if (this.currentStream) {
            clearInterval(this.currentStream);
            this.currentStream = null;
        }
        this.isStreaming = false;
        console.log('Twitter monitoring stopped');
    }

    /**
     * Get media type from media object
     */
    private getMediaType(media: any): TwitterMessage['mediaType'] {
        if (!media) return undefined;

        switch (media.type) {
            case 'photo':
                return 'photo';
            case 'video':
                return 'video';
            case 'animated_gif':
                return 'gif';
            default:
                return undefined;
        }
    }

    /**
     * Start keep-alive mechanism
     */
    public startKeepAlive(): void {
        if (this.isKeepAliveActive) {
            console.log('Twitter keep-alive is already active');
            return;
        }

        this.isKeepAliveActive = true;
        console.log('Starting Twitter keep-alive mechanism...');

        // Check connection every 5 minutes
        this.keepAliveInterval = setInterval(async () => {
            try {
                if (this.isInitialized && this.client && this.hasActiveForwardingRules()) {
                    console.log('Checking Twitter connection...');
                    await this.client.currentUser();
                    console.log('Twitter connection is healthy');
                    this.reconnectAttempts = 0; // Reset reconnect attempts on successful check
                }
            } catch (error) {
                console.error('Twitter keep-alive check failed:', error);
                // Don't immediately reconnect on check failure, let stream error handling handle it
            }
        }, 5 * 60 * 1000); // 5 minutes

        console.log('Twitter keep-alive mechanism started');
    }

    /**
     * Stop keep-alive mechanism
     */
    public stopKeepAlive(): void {
        if (!this.isKeepAliveActive) {
            return;
        }

        this.isKeepAliveActive = false;

        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }

        if (this.reconnectInterval) {
            clearTimeout(this.reconnectInterval);
            this.reconnectInterval = null;
        }

        console.log('Twitter keep-alive mechanism stopped');
    }

    /**
     * Check if there are active forwarding rules that require the connection
     */
    private hasActiveForwardingRules(): boolean {
        // Check if there are listening accounts configured
        if (this.listeningAccounts.size === 0) {
            return false;
        }

        // Check if there are message handlers (indicating active forwarding)
        if (this.messageHandlers.length === 0) {
            return false;
        }

        return true;
    }

    /**
     * Get client info
     */
    public async getClientInfo(): Promise<any> {
        try {
            if (!this.isInitialized || !this.client) {
                throw new Error('Twitter client is not initialized');
            }

            const user = await this.client.currentUser();
            return {
                id: user.id_str,
                username: user.screen_name,
                name: user.name,
                followersCount: user.followers_count,
                verified: user.verified
            };
        } catch (error) {
            console.error('Error getting client info:', error);
            throw error;
        }
    }

    /**
     * Disconnect the client
     */
    public async disconnect(): Promise<void> {
        try {
            // Stop keep-alive first
            this.stopKeepAlive();

            // Stop streaming
            this.stopStreaming();

            this.isInitialized = false;
            this.client = null;
            console.log('Twitter client disconnected');
        } catch (error) {
            console.error('Error disconnecting client:', error);
            throw error;
        }
    }

    /**
     * Check if client is ready
     */
    public isReady(): boolean {
        return this.isInitialized;
    }

    /**
     * Restart the Twitter client
     */
    public async restart(): Promise<void> {
        try {
            console.log('Restarting Twitter client...');

            await this.disconnect();
            await this.initialize();

            console.log('Twitter client restarted successfully');
        } catch (error) {
            console.error('Error restarting Twitter client:', error);
            throw error;
        }
    }

    /**
     * Get keep-alive status
     */
    public getKeepAliveStatus(): {
        isActive: boolean;
        hasForwardingRules: boolean;
        reconnectAttempts: number;
        isStreaming: boolean;
    } {
        return {
            isActive: this.isKeepAliveActive,
            hasForwardingRules: this.hasActiveForwardingRules(),
            reconnectAttempts: this.reconnectAttempts,
            isStreaming: this.isStreaming
        };
    }

    private logRateLimitError(error: any, prefix: string): string {
        const { limit, remaining, reset } = error.rateLimit;
        const now = Math.floor(Date.now() / 1000); // current time in seconds
        const secondsLeft = reset - now;

        let timeStr;
        if (secondsLeft < 3600) {
            const minutes = Math.ceil(secondsLeft / 60);
            timeStr = `${minutes}m`;
        } else {
            const hours = Math.floor(secondsLeft / 3600);
            const minutes = Math.ceil((secondsLeft % 3600) / 60);
            timeStr = `${hours}h ${minutes}m`;
        }

        return `${prefix} Error 429: rate limit reached. Limit=${limit}, Remaining=${remaining}, Reset in ${timeStr}`
    }
}

// Export default instance
export default TwitterInstance;
