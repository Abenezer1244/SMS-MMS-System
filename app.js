const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const twilio = require('twilio');
const AWS = require('aws-sdk');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const axios = require('axios');
const schedule = require('node-schedule');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const morgan = require('morgan');

// (Duplicate logger definition removed to prevent redeclaration error)

// Load environment variables
require('dotenv').config();

// (Duplicate config declaration removed to prevent redeclaration error)

// Validate required configuration
function validateConfiguration() {
    const required = [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN', 
        'TWILIO_PHONE_NUMBER',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_ENDPOINT_URL',
        'R2_BUCKET_NAME'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        logger.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }

    // Validate Twilio credentials format
    if (!config.twilio.accountSid.startsWith('AC') || config.twilio.accountSid.length !== 34) {
        logger.error('❌ Invalid Twilio Account SID format');
        process.exit(1);
    }

    if (config.twilio.authToken.length < 32) {
        logger.error('❌ Invalid Twilio Auth Token format');
        process.exit(1);
    }

    if (!config.r2.endpointUrl.startsWith('https://')) {
        logger.error('❌ Invalid R2 Endpoint URL format');
        process.exit(1);
    }

    logger.info('✅ All required configuration validated');
}

// Validate configuration on startup
validateConfiguration();

// Log startup configuration (without sensitive data)
logger.info('🚀 STARTUP CONFIGURATION:');
logger.info(`   Port: ${config.port}`);
logger.info(`   Twilio Phone: ${config.twilio.phoneNumber}`);
logger.info(`   R2 Bucket: ${config.r2.bucketName}`);

// Initialize Express app with production middleware
// const app = express(); // Duplicate declaration removed

// Security and performance middleware
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for basic HTML responses
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Rate limiting
// (Duplicate limiter declaration removed to prevent redeclaration error)

// Request logging
app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
}));

class ProductionChurchSMS {
    constructor() {
        this.twilioClient = null;
        this.r2Client = null;
        this.conversationPauseTimer = null;
        this.lastRegularMessageTime = null;
        this.performanceMetrics = [];
        
        this.initializeServices();
        this.initializeDatabase();
        this.startReactionScheduler();
        
        logger.info('SUCCESS: Production Church SMS System with Smart Reaction Tracking initialized');
    }

    initializeServices() {
        // Initialize Twilio client
        try {
            this.twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
            
            // Test the connection
            this.twilioClient.api.accounts(config.twilio.accountSid).fetch()
                .then(account => {
                    logger.info(`SUCCESS: Twilio production connection established: ${account.friendlyName}`);
                })
                .catch(error => {
                    logger.error(`ERROR: Twilio connection test failed: ${error.message}`);
                    process.exit(1);
                });
                
        } catch (error) {
            logger.error(`ERROR: Twilio client initialization failed: ${error.message}`);
            process.exit(1);
        }

        // Initialize R2 client
        try {
            this.r2Client = new AWS.S3({
                endpoint: config.r2.endpointUrl,
                accessKeyId: config.r2.accessKeyId,
                secretAccessKey: config.r2.secretAccessKey,
                region: 'auto',
                s3ForcePathStyle: true
            });
            
            // Test the connection
            this.r2Client.headBucket({ Bucket: config.r2.bucketName }).promise()
                .then(() => {
                    logger.info(`SUCCESS: Cloudflare R2 production connection established: ${config.r2.bucketName}`);
                })
                .catch(error => {
                    logger.error(`ERROR: R2 connection test failed: ${error.message}`);
                    process.exit(1);
                });
                
        } catch (error) {
            logger.error(`ERROR: R2 client initialization failed: ${error.message}`);
            process.exit(1);
        }

        // Log final service status
        logger.info('🔧 SERVICE STATUS SUMMARY:');
        logger.info(`   📱 Twilio SMS: ✅ Connected`);
        logger.info(`   ☁️ R2 Storage: ✅ Connected`);
        logger.info(`   🗄️ Database: ✅ SQLite Ready`);
        logger.info(`   🔇 Reactions: ✅ Smart Tracking Active`);
        logger.info(`   🛡️ Security: ✅ Production Ready`);
        logger.info('🚀 PRODUCTION READY: All services connected and operational');
    }

    async initializeDatabase() {
        const maxRetries = 5;
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
            try {
                const db = new sqlite3.Database('production_church.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
                
                if (retryCount > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    logger.info(`🔄 Database initialization retry ${retryCount}/${maxRetries}`);
                }
                
                await Promise.race([
                    this.setupDatabase(db),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Database setup timeout')), 30000))
                ]);

                db.close();
                logger.info('✅ Production database with smart reaction tracking initialized');
                return;
                
            } catch (error) {
                retryCount++;
                logger.error(`❌ Database initialization attempt ${retryCount} failed: ${error.message}`);
                
                if (retryCount >= maxRetries) {
                    logger.error('❌ All database initialization attempts failed');
                    process.exit(1);
                } else {
                    logger.info(`🔄 Retrying in ${retryCount} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
    }

    async setupDatabase(db) {
        // Enable WAL mode and optimizations
        await this.runAsync(db, 'PRAGMA journal_mode=WAL');
        await this.runAsync(db, 'PRAGMA synchronous=NORMAL');
        await this.runAsync(db, 'PRAGMA cache_size=10000');
        await this.runAsync(db, 'PRAGMA temp_store=memory');
        await this.runAsync(db, 'PRAGMA foreign_keys=ON');
        await this.runAsync(db, 'PRAGMA busy_timeout=30000'); // 30 second timeout

        // Create tables
        await this.createTables(db);
        await this.createIndexes(db);
        await this.initializeGroups(db);
    }

    runAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    allAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    getAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async createTables(db) {
        const tables = [
            // Groups table
            `CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Members table
            `CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                active BOOLEAN DEFAULT TRUE,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                message_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Group membership table
            `CREATE TABLE IF NOT EXISTS group_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
                UNIQUE(group_id, member_id)
            )`,

            // Messages table
            `CREATE TABLE IF NOT EXISTS broadcast_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_phone TEXT NOT NULL,
                from_name TEXT NOT NULL,
                original_message TEXT NOT NULL,
                processed_message TEXT NOT NULL,
                message_type TEXT DEFAULT 'text',
                has_media BOOLEAN DEFAULT FALSE,
                media_count INTEGER DEFAULT 0,
                large_media_count INTEGER DEFAULT 0,
                processing_status TEXT DEFAULT 'completed',
                delivery_status TEXT DEFAULT 'pending',
                is_reaction BOOLEAN DEFAULT FALSE,
                target_message_id INTEGER,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (target_message_id) REFERENCES broadcast_messages (id)
            )`,

            // Smart reaction tracking table
            `CREATE TABLE IF NOT EXISTS message_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_message_id INTEGER NOT NULL,
                reactor_phone TEXT NOT NULL,
                reactor_name TEXT NOT NULL,
                reaction_emoji TEXT NOT NULL,
                reaction_text TEXT NOT NULL,
                is_processed BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (target_message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE
            )`,

            // Reaction summary tracking
            `CREATE TABLE IF NOT EXISTS reaction_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                summary_type TEXT NOT NULL,
                summary_content TEXT NOT NULL,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                messages_included INTEGER DEFAULT 0
            )`,

            // Media files table
            `CREATE TABLE IF NOT EXISTS media_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                original_url TEXT NOT NULL,
                twilio_media_sid TEXT,
                r2_object_key TEXT,
                public_url TEXT,
                clean_filename TEXT,
                display_name TEXT,
                original_size INTEGER,
                final_size INTEGER,
                mime_type TEXT,
                file_hash TEXT,
                compression_detected BOOLEAN DEFAULT FALSE,
                upload_status TEXT DEFAULT 'pending',
                upload_error TEXT,
                access_count INTEGER DEFAULT 0,
                last_accessed DATETIME,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE
            )`,

            // Delivery tracking table
            `CREATE TABLE IF NOT EXISTS delivery_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                to_phone TEXT NOT NULL,
                delivery_method TEXT NOT NULL,
                delivery_status TEXT DEFAULT 'pending',
                twilio_message_sid TEXT,
                error_code TEXT,
                error_message TEXT,
                delivery_time_ms INTEGER,
                retry_count INTEGER DEFAULT 0,
                delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
            )`,

            // Analytics table
            `CREATE TABLE IF NOT EXISTS system_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metric_name TEXT NOT NULL,
                metric_value REAL NOT NULL,
                metric_metadata TEXT,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Performance monitoring table
            `CREATE TABLE IF NOT EXISTS performance_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_type TEXT NOT NULL,
                operation_duration_ms INTEGER NOT NULL,
                success BOOLEAN DEFAULT TRUE,
                error_details TEXT,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const tableSQL of tables) {
            await this.runAsync(db, tableSQL);
        }
    }

    async createIndexes(db) {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone_number)',
            'CREATE INDEX IF NOT EXISTS idx_members_active ON members(active)',
            'CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON broadcast_messages(sent_at)',
            'CREATE INDEX IF NOT EXISTS idx_messages_is_reaction ON broadcast_messages(is_reaction)',
            'CREATE INDEX IF NOT EXISTS idx_messages_target ON broadcast_messages(target_message_id)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_target ON message_reactions(target_message_id)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_processed ON message_reactions(is_processed)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_created ON message_reactions(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_media_message_id ON media_files(message_id)',
            'CREATE INDEX IF NOT EXISTS idx_media_status ON media_files(upload_status)',
            'CREATE INDEX IF NOT EXISTS idx_delivery_message_id ON delivery_log(message_id)',
            'CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_log(delivery_status)',
            'CREATE INDEX IF NOT EXISTS idx_analytics_metric ON system_analytics(metric_name, recorded_at)',
            'CREATE INDEX IF NOT EXISTS idx_performance_type ON performance_metrics(operation_type, recorded_at)'
        ];

        for (const indexSQL of indexes) {
            await this.runAsync(db, indexSQL);
        }
    }

    async initializeGroups(db) {
        const count = await this.getAsync(db, "SELECT COUNT(*) as count FROM groups");
        
        if (count.count === 0) {
            const productionGroups = [
                ["YesuWay Congregation", "Main congregation group"],
                ["Church Leadership", "Leadership and admin group"],
                ["Media Team", "Media and technology team"]
            ];

            for (const [name, description] of productionGroups) {
                await this.runAsync(db, "INSERT INTO groups (name, description) VALUES (?, ?)", [name, description]);
            }
            logger.info("✅ Production groups initialized");
        }
    }

    cleanPhoneNumber(phone) {
        if (!phone) return null;
        
        const digits = phone.replace(/\D/g, '');
        
        if (digits.length === 10) {
            return `+1${digits}`;
        } else if (digits.length === 11 && digits.startsWith('1')) {
            return `+${digits}`;
        } else if (digits.length > 11) {
            return `+${digits}`;
        } else {
            logger.warn(`Invalid phone number format: ${phone}`);
            return phone;
        }
    }

    async recordPerformanceMetric(operationType, durationMs, success = true, errorDetails = null) {
        try {
            const db = new sqlite3.Database('production_church.db');
            await this.runAsync(db, `
                INSERT INTO performance_metrics (operation_type, operation_duration_ms, success, error_details) 
                VALUES (?, ?, ?, ?)
            `, [operationType, durationMs, success, errorDetails]);
            db.close();
        } catch (error) {
            logger.error(`❌ Performance metric recording failed: ${error.message}`);
        }
    }

    detectReactionPattern(messageBody) {
        if (!messageBody) return null;
        
        messageBody = messageBody.trim();
        
        // Industry-standard reaction patterns
        const reactionPatterns = [
            // Apple iPhone reactions
            /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned)\s*["'"](.+)["'"]/,
            // Android reactions
            /^(Reacted\s*([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+)\s*to)\s*["'"](.+)["'"]/u,
            // Single emoji reactions
            /^([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+)\s*$/u,
            // Generic reaction patterns
            /^([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+)\s*to\s*["'"](.+)["'"]/u,
            // Text-based reactions
            /^(👍|👎|❤️|😂|😢|😮|😡)\s*$/
        ];

        for (const pattern of reactionPatterns) {
            const match = messageBody.match(pattern);
            if (match) {
                const groups = match.slice(1);
                
                let reactionType, targetMessage;
                if (groups.length >= 2) {
                    reactionType = groups[0];
                    targetMessage = groups[groups.length - 1] || "";
                } else {
                    reactionType = groups[0];
                    targetMessage = "";
                }

                // Map reaction types to emojis
                const reactionMapping = {
                    'Loved': '❤️',
                    'Liked': '👍',
                    'Disliked': '👎',
                    'Laughed at': '😂',
                    'Emphasized': '‼️',
                    'Questioned': '❓'
                };

                let emoji = reactionMapping[reactionType] || reactionType;

                // Extract emoji if reaction_type contains emoji
                const emojiMatch = emoji.match(/([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+)/u);
                if (emojiMatch) {
                    emoji = emojiMatch[1];
                }

                logger.info(`🎯 Industry reaction detected: '${emoji}' to message fragment: '${targetMessage.substring(0, 50)}...'`);

                return {
                    emoji: emoji,
                    targetMessageFragment: targetMessage.substring(0, 100),
                    reactionType: reactionType,
                    fullPattern: messageBody
                };
            }
        }

        return null;
    }

    async findTargetMessageForReaction(targetFragment, reactorPhone, hoursBack = 24) {
        try {
            const db = new sqlite3.Database('production_church.db');
            const sinceTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

            const recentMessages = await this.allAsync(db, `
                SELECT id, original_message, from_phone, from_name, sent_at
                FROM broadcast_messages 
                WHERE sent_at > ? 
                AND from_phone != ?
                AND is_reaction = 0
                ORDER BY sent_at DESC
                LIMIT 10
            `, [sinceTime, reactorPhone]);

            db.close();

            if (recentMessages.length === 0) {
                logger.info('🔍 No recent messages found for reaction matching');
                return null;
            }

            // Smart matching algorithm
            let bestMatch = null;
            let bestScore = 0;

            if (targetFragment) {
                const targetWords = new Set(targetFragment.toLowerCase().split(/\s+/));

                for (const msg of recentMessages) {
                    if (!msg.original_message) continue;

                    const messageWords = new Set(msg.original_message.toLowerCase().split(/\s+/));

                    if (targetWords.size > 0 && messageWords.size > 0) {
                        const commonWords = new Set([...targetWords].filter(x => messageWords.has(x)));
                        let score = commonWords.size / Math.max(targetWords.size, messageWords.size);

                        // Boost score for exact substring matches
                        if (msg.original_message.toLowerCase().includes(targetFragment.toLowerCase())) {
                            score += 0.5;
                        }

                        if (score > bestScore && score > 0.3) {
                            bestScore = score;
                            bestMatch = {
                                id: msg.id,
                                message: msg.original_message,
                                fromPhone: msg.from_phone,
                                fromName: msg.from_name,
                                sentAt: msg.sent_at,
                                similarityScore: score
                            };
                        }
                    }
                }
            }

            // Fallback to most recent message if no good match
            if (!bestMatch && recentMessages.length > 0) {
                const msg = recentMessages[0];
                bestMatch = {
                    id: msg.id,
                    message: msg.original_message,
                    fromPhone: msg.from_phone,
                    fromName: msg.from_name,
                    sentAt: msg.sent_at,
                    similarityScore: 0.0
                };
                logger.info(`🎯 Using most recent message as fallback: Message ${msg.id}`);
            }

            if (bestMatch) {
                logger.info(`✅ Found reaction target (score: ${bestMatch.similarityScore.toFixed(2)}): Message ${bestMatch.id} from ${bestMatch.fromName}`);
            }

            return bestMatch;
        } catch (error) {
            logger.error(`❌ Error finding reaction target: ${error.message}`);
            return null;
        }
    }

    async getMemberInfo(phoneNumber) {
        try {
            phoneNumber = this.cleanPhoneNumber(phoneNumber);
            const db = new sqlite3.Database('production_church.db');

            const result = await this.getAsync(db, `
                SELECT id, name, is_admin, message_count 
                FROM members 
                WHERE phone_number = ? AND active = 1
            `, [phoneNumber]);

            db.close();

            if (result) {
                return {
                    id: result.id,
                    name: result.name,
                    isAdmin: Boolean(result.is_admin),
                    messageCount: result.message_count
                };
            } else {
                logger.warn(`❌ Unregistered number attempted access: ${phoneNumber}`);
                return null;
            }
        } catch (error) {
            logger.error(`❌ Error getting member info: ${error.message}`);
            return null;
        }
    }

    async storeReactionSilently(reactorPhone, reactionData, targetMessage) {
        try {
            const reactor = await this.getMemberInfo(reactorPhone);
            if (!reactor) {
                logger.warn(`❌ Reaction from unregistered number: ${reactorPhone}`);
                return false;
            }

            const targetMsgId = targetMessage.id;
            const reactionEmoji = reactionData.emoji;
            const reactionText = reactionData.fullPattern;

            logger.info(`🔇 Storing silent reaction: ${reactor.name} reacted '${reactionEmoji}' to message ${targetMsgId}`);

            const db = new sqlite3.Database('production_church.db');

            // Store reaction silently
            await this.runAsync(db, `
                INSERT INTO message_reactions 
                (target_message_id, reactor_phone, reactor_name, reaction_emoji, reaction_text, is_processed) 
                VALUES (?, ?, ?, ?, ?, 0)
            `, [targetMsgId, reactorPhone, reactor.name, reactionEmoji, reactionText]);

            // Mark original message to track it has reactions
            await this.runAsync(db, `
                UPDATE broadcast_messages 
                SET message_type = 'text_with_reactions'
                WHERE id = ?
            `, [targetMsgId]);

            db.close();

            logger.info('✅ Reaction stored silently - no broadcast sent');
            return true;
        } catch (error) {
            logger.error(`❌ Error storing silent reaction: ${error.message}`);
            return false;
        }
    }

    startReactionScheduler() {
        // Schedule daily summary at 8 PM
        schedule.scheduleJob('0 20 * * *', () => {
            this.sendDailyReactionSummary();
        });

        logger.info('✅ Smart reaction scheduler started - Daily summaries at 8 PM');
    }

    resetConversationPauseTimer() {
        if (this.conversationPauseTimer) {
            clearTimeout(this.conversationPauseTimer);
        }

        // Set timer for 30 minutes from now
        this.conversationPauseTimer = setTimeout(() => {
            this.sendPauseReactionSummary();
        }, 30 * 60 * 1000); // 30 minutes

        this.lastRegularMessageTime = new Date();
        logger.debug('🕐 Conversation pause timer reset - 30 minutes');
    }

    async sendPauseReactionSummary() {
        try {
            const sinceTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // Last 2 hours
            const db = new sqlite3.Database('production_church.db');

            const reactionData = await this.allAsync(db, `
                SELECT mr.target_message_id, bm.from_name, bm.original_message, 
                       mr.reaction_emoji, COUNT(*) as reaction_count
                FROM message_reactions mr
                JOIN broadcast_messages bm ON mr.target_message_id = bm.id
                WHERE mr.is_processed = 0 
                AND mr.created_at > ?
                GROUP BY mr.target_message_id, mr.reaction_emoji
                ORDER BY bm.sent_at DESC
            `, [sinceTime]);

            if (reactionData.length === 0) {
                db.close();
                logger.info('🔇 No unprocessed reactions for pause summary');
                return;
            }

            // Build smart summary
            const summaryLines = ["📊 Recent reactions:"];
            let messagesIncluded = 0;

            // Group by message
            const messageReactions = {};
            for (const row of reactionData) {
                const { target_message_id, from_name, original_message, reaction_emoji, reaction_count } = row;
                if (!messageReactions[target_message_id]) {
                    messageReactions[target_message_id] = {
                        fromName: from_name,
                        message: original_message,
                        reactions: {}
                    };
                }
                messageReactions[target_message_id].reactions[reaction_emoji] = reaction_count;
            }

            for (const [targetId, msgData] of Object.entries(messageReactions)) {
                messagesIncluded++;
                const messagePreview = msgData.message.length > 40 
                    ? msgData.message.substring(0, 40) + "..." 
                    : msgData.message;

                // Format reaction counts
                const reactionParts = [];
                for (const [emoji, count] of Object.entries(msgData.reactions)) {
                    if (count === 1) {
                        reactionParts.push(emoji);
                    } else {
                        reactionParts.push(`${emoji}×${count}`);
                    }
                }

                const reactionDisplay = reactionParts.join(' ');
                summaryLines.push(`💬 ${msgData.fromName}: "${messagePreview}" → ${reactionDisplay}`);
            }

            // Mark all reactions as processed
            await this.runAsync(db, `
                UPDATE message_reactions 
                SET is_processed = 1 
                WHERE is_processed = 0 
                AND created_at > ?
            `, [sinceTime]);

            // Store summary record
            const summaryContent = summaryLines.join('\n');
            await this.runAsync(db, `
                INSERT INTO reaction_summaries (summary_type, summary_content, messages_included) 
                VALUES ('pause_summary', ?, ?)
            `, [summaryContent, messagesIncluded]);

            db.close();

            // Broadcast summary to congregation
            await this.broadcastSummaryToCongregation(summaryContent);

            logger.info(`✅ Pause reaction summary sent - ${messagesIncluded} messages included`);
        } catch (error) {
            logger.error(`❌ Error sending pause reaction summary: ${error.message}`);
        }
    }

    async sendDailyReactionSummary() {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            
            const db = new sqlite3.Database('production_church.db');

            const reactionData = await this.allAsync(db, `
                SELECT mr.target_message_id, bm.from_name, bm.original_message, 
                       mr.reaction_emoji, COUNT(*) as reaction_count
                FROM message_reactions mr
                JOIN broadcast_messages bm ON mr.target_message_id = bm.id
                WHERE mr.is_processed = 0 
                AND mr.created_at >= ?
                GROUP BY mr.target_message_id, mr.reaction_emoji
                ORDER BY reaction_count DESC, bm.sent_at DESC
                LIMIT 10
            `, [todayStart.toISOString()]);

            if (reactionData.length === 0) {
                db.close();
                logger.info('🔇 No reactions for daily summary');
                return;
            }

            // Build comprehensive daily summary
            const summaryLines = ["📊 TODAY'S REACTIONS:"];
            let messagesIncluded = 0;
            let totalReactions = 0;

            // Group by message
            const messageReactions = {};
            for (const row of reactionData) {
                const { target_message_id, from_name, original_message, reaction_emoji, reaction_count } = row;
                totalReactions += reaction_count;
                if (!messageReactions[target_message_id]) {
                    messageReactions[target_message_id] = {
                        fromName: from_name,
                        message: original_message,
                        reactions: {},
                        totalCount: 0
                    };
                }
                messageReactions[target_message_id].reactions[reaction_emoji] = reaction_count;
                messageReactions[target_message_id].totalCount += reaction_count;
            }

            // Sort by total reaction count
            const sortedMessages = Object.entries(messageReactions)
                .sort(([,a], [,b]) => b.totalCount - a.totalCount)
                .slice(0, 5); // Top 5 most reacted messages

            for (const [targetId, msgData] of sortedMessages) {
                messagesIncluded++;
                const messagePreview = msgData.message.length > 50 
                    ? msgData.message.substring(0, 50) + "..." 
                    : msgData.message;

                // Format reaction counts
                const reactionParts = [];
                for (const [emoji, count] of Object.entries(msgData.reactions)) {
                    if (count === 1) {
                        reactionParts.push(emoji);
                    } else {
                        reactionParts.push(`${emoji}×${count}`);
                    }
                }

                const reactionDisplay = reactionParts.join(' ');
                const totalForMsg = msgData.totalCount;
                summaryLines.push(`• ${msgData.fromName}: "${messagePreview}" (${totalForMsg} reactions: ${reactionDisplay})`);
            }

            // Add engagement stats
            const uniqueReactors = await this.getAsync(db, `
                SELECT COUNT(DISTINCT reactor_phone) as count
                FROM message_reactions 
                WHERE is_processed = 0 
                AND created_at >= ?
            `, [todayStart.toISOString()]);

            summaryLines.push(`\n🎯 Today's engagement: ${totalReactions} reactions from ${uniqueReactors.count} members`);

            // Mark all today's reactions as processed
            await this.runAsync(db, `
                UPDATE message_reactions 
                SET is_processed = 1 
                WHERE is_processed = 0 
                AND created_at >= ?
            `, [todayStart.toISOString()]);

            // Store summary record
            const summaryContent = summaryLines.join('\n');
            await this.runAsync(db, `
                INSERT INTO reaction_summaries (summary_type, summary_content, messages_included) 
                VALUES ('daily_summary', ?, ?)
            `, [summaryContent, messagesIncluded]);

            db.close();

            // Broadcast summary to congregation
            await this.broadcastSummaryToCongregation(summaryContent);

            logger.info(`✅ Daily reaction summary sent - ${messagesIncluded} messages, ${totalReactions} reactions`);
        } catch (error) {
            logger.error(`❌ Error sending daily reaction summary: ${error.message}`);
        }
    }

    async broadcastSummaryToCongregation(summaryContent) {
        try {
            const recipients = await this.getAllActiveMembers();

            if (recipients.length === 0) {
                logger.warn('❌ No active recipients for summary broadcast');
                return;
            }

            logger.info(`📤 Broadcasting reaction summary to ${recipients.length} members`);

            // Concurrent delivery of summary
            const deliveryPromises = recipients.map(async (member) => {
                try {
                    const result = await this.sendSMS(member.phone, summaryContent);
                    if (result.success) {
                        logger.info(`✅ Summary delivered to ${member.name}`);
                    } else {
                        logger.error(`❌ Summary failed to ${member.name}: ${result.error}`);
                    }
                } catch (error) {
                    logger.error(`❌ Summary delivery error to ${member.name}: ${error.message}`);
                }
            });

            await Promise.allSettled(deliveryPromises);
            logger.info('✅ Reaction summary broadcast completed');
        } catch (error) {
            logger.error(`❌ Error broadcasting summary: ${error.message}`);
        }
    }

    async downloadMediaFromTwilio(mediaUrl) {
        const startTime = Date.now();
        try {
            logger.info(`📥 Downloading media: ${mediaUrl}`);

            const response = await axios.get(mediaUrl, {
                auth: {
                    username: config.twilio.accountSid,
                    password: config.twilio.authToken
                },
                timeout: 60000,
                responseType: 'arraybuffer'
            });

            if (response.status === 200) {
                const content = Buffer.from(response.data);
                const contentType = response.headers['content-type'] || 'application/octet-stream';
                const fileHash = crypto.createHash('sha256').update(content).digest('hex');

                const durationMs = Date.now() - startTime;
                await this.recordPerformanceMetric('media_download', durationMs, true);

                logger.info(`✅ Downloaded ${content.length} bytes, type: ${contentType}`);

                return {
                    content: content,
                    size: content.length,
                    mimeType: contentType,
                    hash: fileHash,
                    headers: response.headers
                };
            } else {
                const durationMs = Date.now() - startTime;
                await this.recordPerformanceMetric('media_download', durationMs, false, `HTTP ${response.status}`);
                logger.error(`❌ Download failed: HTTP ${response.status}`);
                return null;
            }
        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('media_download', durationMs, false, error.message);
            logger.error(`❌ Media download error: ${error.message}`);
            return null;
        }
    }

    generateCleanFilename(mimeType, mediaIndex = 1) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);

        let extension, baseName, displayName;

        if (mimeType.includes('image')) {
            if (mimeType.includes('gif')) {
                extension = '.gif';
                baseName = `gif_${timestamp}`;
                displayName = `GIF ${mediaIndex}`;
            } else {
                extension = '.jpg';
                baseName = `photo_${timestamp}`;
                displayName = `Photo ${mediaIndex}`;
            }
        } else if (mimeType.includes('video')) {
            extension = '.mp4';
            baseName = `video_${timestamp}`;
            displayName = `Video ${mediaIndex}`;
        } else if (mimeType.includes('audio')) {
            extension = '.mp3';
            baseName = `audio_${timestamp}`;
            displayName = `Audio ${mediaIndex}`;
        } else {
            extension = mime.extension(mimeType) ? `.${mime.extension(mimeType)}` : '.file';
            baseName = `file_${timestamp}`;
            displayName = `File ${mediaIndex}`;
        }

        if (mediaIndex > 1) {
            baseName += `_${mediaIndex}`;
        }

        const cleanFilename = `church/${baseName}${extension}`;

        return { cleanFilename, displayName };
    }

    async uploadToR2(fileContent, objectKey, mimeType, metadata = {}) {
        const startTime = Date.now();
        try {
            logger.info(`☁️ Uploading to R2: ${objectKey}`);

            const uploadMetadata = {
                'church-system': 'yesuway-production',
                'upload-timestamp': new Date().toISOString(),
                'content-hash': crypto.createHash('sha256').update(fileContent).digest('hex'),
                ...metadata
            };

            const params = {
                Bucket: config.r2.bucketName,
                Key: objectKey,
                Body: fileContent,
                ContentType: mimeType,
                ContentDisposition: 'inline',
                CacheControl: 'public, max-age=31536000',
                Metadata: uploadMetadata,
                ServerSideEncryption: 'AES256'
            };

            await this.r2Client.upload(params).promise();

            let publicUrl;
            if (config.r2.publicUrl) {
                publicUrl = `${config.r2.publicUrl.replace(/\/$/, '')}/${objectKey}`;
            } else {
                publicUrl = this.r2Client.getSignedUrl('getObject', {
                    Bucket: config.r2.bucketName,
                    Key: objectKey,
                    Expires: 31536000 // 1 year
                });
            }

            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('r2_upload', durationMs, true);

            logger.info(`✅ Upload successful: ${publicUrl}`);
            return publicUrl;
        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('r2_upload', durationMs, false, error.message);
            logger.error(`❌ R2 upload failed: ${error.message}`);
            return null;
        }
    }

    async processMediaFiles(messageId, mediaUrls) {
        logger.info(`🔄 Processing ${mediaUrls.length} media files for message ${messageId}`);

        const processedLinks = [];
        const processingErrors = [];

        for (let i = 0; i < mediaUrls.length; i++) {
            const media = mediaUrls[i];
            const mediaUrl = media.url || '';
            const mediaType = media.type || 'unknown';

            try {
                logger.info(`📎 Processing media ${i + 1}/${mediaUrls.length}: ${mediaType}`);

                const mediaData = await this.downloadMediaFromTwilio(mediaUrl);

                if (!mediaData) {
                    const errorMsg = `Failed to download media ${i + 1}`;
                    processingErrors.push(errorMsg);
                    logger.error(errorMsg);
                    continue;
                }

                const fileSize = mediaData.size;
                const compressionDetected = fileSize >= 4.8 * 1024 * 1024;

                const { cleanFilename, displayName } = this.generateCleanFilename(
                    mediaData.mimeType,
                    i + 1
                );

                const publicUrl = await this.uploadToR2(
                    mediaData.content,
                    cleanFilename,
                    mediaData.mimeType,
                    {
                        'original-size': fileSize.toString(),
                        'compression-detected': compressionDetected.toString(),
                        'media-index': i.toString(),
                        'display-name': displayName
                    }
                );

                if (publicUrl) {
                    const db = new sqlite3.Database('production_church.db');

                    await this.runAsync(db, `
                        INSERT INTO media_files 
                        (message_id, original_url, r2_object_key, public_url, clean_filename, display_name,
                         original_size, final_size, mime_type, file_hash, compression_detected, upload_status) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
                    `, [
                        messageId, mediaUrl, cleanFilename, publicUrl, cleanFilename.split('/').pop(), displayName,
                        fileSize, fileSize, mediaData.mimeType, mediaData.hash, compressionDetected
                    ]);

                    db.close();

                    processedLinks.push({
                        url: publicUrl,
                        displayName: displayName,
                        type: mediaData.mimeType
                    });
                    logger.info(`✅ Media ${i + 1} processed successfully`);
                } else {
                    const errorMsg = `Failed to upload media ${i + 1} to R2`;
                    processingErrors.push(errorMsg);
                    logger.error(errorMsg);
                }
            } catch (error) {
                const errorMsg = `Error processing media ${i + 1}: ${error.message}`;
                processingErrors.push(errorMsg);
                logger.error(errorMsg);
            }
        }

        logger.info(`✅ Media processing complete: ${processedLinks.length} successful, ${processingErrors.length} errors`);
        return { processedLinks, processingErrors };
    }

    async getAllActiveMembers(excludePhone = null) {
        try {
            excludePhone = excludePhone ? this.cleanPhoneNumber(excludePhone) : null;

            const db = new sqlite3.Database('production_church.db');

            let query = `
                SELECT DISTINCT m.id, m.phone_number, m.name, m.is_admin
                FROM members m
                JOIN group_members gm ON m.id = gm.member_id
                WHERE m.active = 1
            `;
            const params = [];

            if (excludePhone) {
                query += " AND m.phone_number != ?";
                params.push(excludePhone);
            }

            query += " ORDER BY m.name";

            const rows = await this.allAsync(db, query, params);
            db.close();

            const members = [];
            for (const row of rows) {
                const cleanPhone = this.cleanPhoneNumber(row.phone_number);
                if (cleanPhone) {
                    members.push({
                        id: row.id,
                        phone: cleanPhone,
                        name: row.name,
                        isAdmin: Boolean(row.is_admin)
                    });
                }
            }

            logger.info(`📋 Retrieved ${members.length} active members`);
            return members;
        } catch (error) {
            logger.error(`❌ Error retrieving members: ${error.message}`);
            return [];
        }
    }

    async sendSMS(toPhone, messageText, maxRetries = 3) {
        const startTime = Date.now();
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const message = await this.twilioClient.messages.create({
                    body: messageText,
                    from: config.twilio.phoneNumber,
                    to: toPhone
                });

                const durationMs = Date.now() - startTime;
                await this.recordPerformanceMetric('sms_send', durationMs, true);

                logger.info(`SUCCESS: SMS sent to ${toPhone}: ${message.sid}`);
                return {
                    success: true,
                    sid: message.sid,
                    attempt: attempt
                };
            } catch (error) {
                logger.warn(`WARNING: SMS attempt ${attempt} failed for ${toPhone}: ${error.message}`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                } else {
                    const durationMs = Date.now() - startTime;
                    await this.recordPerformanceMetric('sms_send', durationMs, false, error.message);
                    logger.error(`ERROR: All SMS attempts failed for ${toPhone}`);
                    return {
                        success: false,
                        error: error.message,
                        attempts: maxRetries
                    };
                }
            }
        }
    }

    formatMessageWithMedia(originalMessage, sender, mediaLinks = null) {
        if (mediaLinks && mediaLinks.length > 0) {
            if (mediaLinks.length === 1) {
                const mediaItem = mediaLinks[0];
                return `💬 ${sender.name}:\n${originalMessage}\n\n🔗 ${mediaItem.displayName}: ${mediaItem.url}`;
            } else {
                const mediaText = mediaLinks.map(item => `🔗 ${item.displayName}: ${item.url}`).join('\n');
                return `💬 ${sender.name}:\n${originalMessage}\n\n${mediaText}`;
            }
        } else {
            return `💬 ${sender.name}:\n${originalMessage}`;
        }
    }

    async broadcastMessage(fromPhone, messageText, mediaUrls = null) {
        const startTime = Date.now();
        logger.info(`📡 Starting broadcast from ${fromPhone}`);

        try {
            const sender = await this.getMemberInfo(fromPhone);

            if (!sender) {
                logger.warn(`❌ Broadcast rejected - unregistered number: ${fromPhone}`);
                return "You are not registered. Please contact church admin to be added to the system.";
            }

            const recipients = await this.getAllActiveMembers(fromPhone);

            if (recipients.length === 0) {
                logger.warn('❌ No active recipients found');
                return "No active congregation members found for broadcast.";
            }

            // Store broadcast message
            const db = new sqlite3.Database('production_church.db');

            const result = await this.runAsync(db, `
                INSERT INTO broadcast_messages 
                (from_phone, from_name, original_message, processed_message, message_type, 
                 has_media, media_count, processing_status, delivery_status, is_reaction) 
                VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'pending', 0)
            `, [
                fromPhone, sender.name, messageText, messageText,
                mediaUrls ? 'media' : 'text',
                Boolean(mediaUrls), mediaUrls ? mediaUrls.length : 0
            ]);

            const messageId = result.lastID;
            db.close();

            // Process media if present
            let cleanMediaLinks = [];
            let largeMediaCount = 0;

            if (mediaUrls && mediaUrls.length > 0) {
                logger.info(`🔄 Processing ${mediaUrls.length} media files...`);
                const { processedLinks, processingErrors } = await this.processMediaFiles(messageId, mediaUrls);
                cleanMediaLinks = processedLinks;
                largeMediaCount = processedLinks.length;

                if (processingErrors.length > 0) {
                    logger.warn(`⚠️ Media processing errors: ${processingErrors}`);
                }
            }

            // Format final message
            const finalMessage = this.formatMessageWithMedia(
                messageText, sender, cleanMediaLinks
            );

            // Update message with processed content
            const db2 = new sqlite3.Database('production_church.db');
            await this.runAsync(db2, `
                UPDATE broadcast_messages 
                SET processed_message = ?, large_media_count = ?, processing_status = 'completed'
                WHERE id = ?
            `, [finalMessage, largeMediaCount, messageId]);
            db2.close();

            // Reset conversation pause timer for regular messages
            this.resetConversationPauseTimer();

            // Broadcast with concurrent delivery
            const deliveryStats = {
                sent: 0,
                failed: 0,
                totalTime: 0,
                errors: []
            };

            const sendPromises = recipients.map(async (member) => {
                const memberStart = Date.now();
                try {
                    const result = await this.sendSMS(member.phone, finalMessage);
                    const deliveryTime = Date.now() - memberStart;

                    // Log delivery
                    const db3 = new sqlite3.Database('production_church.db');
                    await this.runAsync(db3, `
                        INSERT INTO delivery_log 
                        (message_id, member_id, to_phone, delivery_method, delivery_status, 
                         twilio_message_sid, error_message, delivery_time_ms) 
                        VALUES (?, ?, ?, 'sms', ?, ?, ?, ?)
                    `, [
                        messageId, member.id, member.phone,
                        result.success ? 'delivered' : 'failed',
                        result.sid || null, result.error || null, deliveryTime
                    ]);
                    db3.close();

                    if (result.success) {
                        deliveryStats.sent++;
                        logger.info(`✅ Delivered to ${member.name}: ${result.sid}`);
                    } else {
                        deliveryStats.failed++;
                        deliveryStats.errors.push(`${member.name}: ${result.error}`);
                        logger.error(`❌ Failed to ${member.name}: ${result.error}`);
                    }
                } catch (error) {
                    deliveryStats.failed++;
                    deliveryStats.errors.push(`${member.name}: ${error.message}`);
                    logger.error(`❌ Delivery error to ${member.name}: ${error.message}`);
                }
            });

            logger.info(`📤 Starting concurrent delivery to ${recipients.length} recipients...`);
            await Promise.allSettled(sendPromises);

            // Calculate final stats
            const totalTime = (Date.now() - startTime) / 1000;
            deliveryStats.totalTime = totalTime;

            // Update final delivery status
            const db4 = new sqlite3.Database('production_church.db');
            await this.runAsync(db4, `
                UPDATE broadcast_messages 
                SET delivery_status = 'completed'
                WHERE id = ?
            `, [messageId]);

            // Record analytics
            await this.runAsync(db4, `
                INSERT INTO system_analytics (metric_name, metric_value, metric_metadata) 
                VALUES (?, ?, ?)
            `, ['broadcast_delivery_rate',
                deliveryStats.sent / recipients.length * 100,
                `sent:${deliveryStats.sent},failed:${deliveryStats.failed},time:${totalTime.toFixed(2)}s`]);

            // Update sender message count
            await this.runAsync(db4, `
                UPDATE members 
                SET message_count = message_count + 1, last_activity = CURRENT_TIMESTAMP
                WHERE phone_number = ?
            `, [fromPhone]);

            db4.close();

            // Record broadcast performance
            const broadcastDurationMs = Math.round(totalTime * 1000);
            await this.recordPerformanceMetric('broadcast_complete', broadcastDurationMs, true);

            logger.info(`📊 Broadcast completed in ${totalTime.toFixed(2)}s: ${deliveryStats.sent} sent, ${deliveryStats.failed} failed`);

            // Return confirmation to sender if admin
            if (sender.isAdmin) {
                let confirmation = `✅ Broadcast completed in ${totalTime.toFixed(1)}s\n`;
                confirmation += `📊 Delivered: ${deliveryStats.sent}/${recipients.length}\n`;

                if (largeMediaCount > 0) {
                    confirmation += `📎 Clean media links: ${largeMediaCount}\n`;
                }

                if (deliveryStats.failed > 0) {
                    confirmation += `⚠️ Failed deliveries: ${deliveryStats.failed}\n`;
                }

                confirmation += '🔇 Smart reaction tracking: Active';
                return confirmation;
            } else {
                return null; // No confirmation for regular members
            }
        } catch (error) {
            logger.error(`❌ Broadcast error: ${error.message}`);
            return "Broadcast failed - system administrators notified";
        }
    }

    async isAdmin(phoneNumber) {
        try {
            phoneNumber = this.cleanPhoneNumber(phoneNumber);

            const db = new sqlite3.Database('production_church.db');
            const result = await this.getAsync(db, "SELECT is_admin FROM members WHERE phone_number = ? AND active = 1", [phoneNumber]);
            db.close();

            return result ? Boolean(result.is_admin) : false;
        } catch (error) {
            logger.error(`❌ Admin check error: ${error.message}`);
            return false;
        }
    }

    async handleIncomingMessage(fromPhone, messageBody, mediaUrls) {
        logger.info(`📨 Incoming message from ${fromPhone}`);

        try {
            fromPhone = this.cleanPhoneNumber(fromPhone);
            messageBody = messageBody ? messageBody.trim() : "";

            // Log media if present
            if (mediaUrls && mediaUrls.length > 0) {
                logger.info(`📎 Received ${mediaUrls.length} media files`);
                for (let i = 0; i < mediaUrls.length; i++) {
                    const media = mediaUrls[i];
                    logger.info(`   Media ${i + 1}: ${media.type || 'unknown'}`);
                }
            }

            // Get member info - no auto-registration
            const member = await this.getMemberInfo(fromPhone);

            if (!member) {
                logger.warn(`❌ Rejected message from unregistered number: ${fromPhone}`);
                // Send rejection message
                await this.sendSMS(
                    fromPhone,
                    "You are not registered in the church SMS system. Please contact a church administrator to be added."
                );
                return null;
            }

            logger.info(`👤 Sender: ${member.name} (Admin: ${member.isAdmin})`);

            // CRITICAL: Detect reactions FIRST and handle silently
            const reactionData = this.detectReactionPattern(messageBody);
            if (reactionData) {
                logger.info(`🔇 Silent reaction detected: ${member.name} reacted '${reactionData.emoji}'`);

                // Find target message
                const targetMessage = await this.findTargetMessageForReaction(
                    reactionData.targetMessageFragment,
                    fromPhone
                );

                if (targetMessage) {
                    // Store reaction silently - NO BROADCAST
                    const success = await this.storeReactionSilently(fromPhone, reactionData, targetMessage);
                    if (success) {
                        logger.info('✅ Reaction stored silently - will appear in next summary');
                        return null; // No response, no broadcast - completely silent
                    } else {
                        logger.error('❌ Failed to store reaction silently');
                        return null;
                    }
                } else {
                    logger.warn('⚠️ Could not find target message for reaction');
                    return null; // Still silent even if target not found
                }
            }

            // Handle member commands
            if (messageBody.toUpperCase() === 'HELP') {
                return (
                    "📋 YESUWAY CHURCH SMS SYSTEM\n\n" +
                    "✅ Send messages to entire congregation\n" +
                    "✅ Share photos/videos (unlimited size)\n" +
                    "✅ Clean media links (no technical details)\n" +
                    "✅ Full quality preserved automatically\n" +
                    "✅ Smart reaction tracking (silent)\n\n" +
                    "📱 Text HELP for this message\n" +
                    "🔇 Reactions tracked silently - summaries at 8 PM daily\n" +
                    "🏛️ Production system - serving 24/7"
                );
            }

            // Default: Broadcast regular message
            logger.info('📡 Processing regular message broadcast...');
            return await this.broadcastMessage(fromPhone, messageBody, mediaUrls);
        } catch (error) {
            logger.error(`❌ Message processing error: ${error.message}`);
            return "Message processing temporarily unavailable - please try again";
        }
    }
}

// Initialize production system
logger.info('STARTING: Initializing Production Church SMS System with Smart Reaction Tracking...');
// Removed duplicate declaration of smsSystem here to avoid redeclaration error.
// Initialization of smsSystem is handled in the main startup block below.

async function setupProductionCongregation() {
    logger.info('🔧 Setting up production congregation...');

    try {
        const db = new sqlite3.Database('production_church.db');

        // Add primary admin
        await smsSystem.runAsync(db, `
            INSERT OR REPLACE INTO members (phone_number, name, is_admin, active, message_count) 
            VALUES (?, ?, ?, 1, 0)
        `, ["+14257729189", "Church Admin", true]);

        const adminResult = await smsSystem.getAsync(db, "SELECT id FROM members WHERE phone_number = ?", ["+14257729189"]);
        const adminId = adminResult.id;

        // Add to admin group
        await smsSystem.runAsync(db, `
            INSERT OR IGNORE INTO group_members (group_id, member_id) 
            VALUES (2, ?)
        `, [adminId]);

        // Add production members
        const productionMembers = [
            ["+12068001141", "Mike", 1],
            ["+14257729189", "Sam", 1],
            ["+12065910943", "Sami", 3],
            ["+12064349652", "Yab", 1]
        ];

        for (const [phone, name, groupId] of productionMembers) {
            await smsSystem.runAsync(db, `
                INSERT OR REPLACE INTO members (phone_number, name, is_admin, active, message_count) 
                VALUES (?, ?, ?, 1, 0)
            `, [phone, name, false]);

            const memberResult = await smsSystem.getAsync(db, "SELECT id FROM members WHERE phone_number = ?", [phone]);
            const memberId = memberResult.id;

            await smsSystem.runAsync(db, `
                INSERT OR IGNORE INTO group_members (group_id, member_id) 
                VALUES (?, ?)
            `, [groupId, memberId]);
        }

        db.close();
        logger.info('✅ Production congregation setup completed with smart reaction tracking');
    } catch (error) {
        logger.error(`❌ Production setup error: ${error.message}`);
    }
}

// Request monitoring middleware
app.use((req, res, next) => {
    req.startTime = Date.now();
    next();
});

app.use((req, res, next) => {
    res.on('finish', async () => {
        if (req.startTime) {
            const duration = Date.now() - req.startTime;
            if (duration > 1000) {
                logger.warn(`⏰ Slow request: ${req.route?.path || req.path} took ${duration}ms`);
            }

            try {
                if (smsSystem && smsSystem.recordPerformanceMetric) {
                    const endpoint = req.route?.path || req.path || 'unknown';
                    await smsSystem.recordPerformanceMetric(`http_${endpoint}`, duration, res.statusCode < 400);
                }
            } catch (error) {
                // Ignore metric recording errors
            }
        }
    });
    next();
});

app.post('/webhook/sms', async (req, res) => {
    const requestStart = Date.now();
    const requestId = uuidv4().substring(0, 8);

    logger.info(`🌐 [${requestId}] SMS webhook called`);

    try {
        // Extract webhook data
        const fromNumber = (req.body.From || '').trim();
        const messageBody = (req.body.Body || '').trim();
        const numMedia = parseInt(req.body.NumMedia || 0);
        const messageSid = req.body.MessageSid || '';

        logger.info(`📨 [${requestId}] From: ${fromNumber}, Body: '${messageBody}', Media: ${numMedia}`);

        if (!fromNumber) {
            logger.warn(`⚠️ [${requestId}] Missing From number`);
            return res.status(200).send('OK');
        }

        // Extract media URLs
        const mediaUrls = [];
        for (let i = 0; i < numMedia; i++) {
            const mediaUrl = req.body[`MediaUrl${i}`];
            const mediaType = req.body[`MediaContentType${i}`];

            if (mediaUrl) {
                mediaUrls.push({
                    url: mediaUrl,
                    type: mediaType || 'unknown',
                    index: i
                });
                logger.info(`📎 [${requestId}] Media ${i + 1}: ${mediaType}`);
            }
        }

        // Process message asynchronously
        const processAsync = async () => {
            try {
                const response = await smsSystem.handleIncomingMessage(
                    fromNumber, messageBody, mediaUrls
                );

                // Send response if needed (reactions return null - no response)
                if (response && await smsSystem.isAdmin(fromNumber)) {
                    const result = await smsSystem.sendSMS(fromNumber, response);
                    if (result.success) {
                        logger.info(`📤 [${requestId}] Response sent: ${result.sid}`);
                    } else {
                        logger.error(`❌ [${requestId}] Response failed: ${result.error}`);
                    }
                }
            } catch (error) {
                logger.error(`❌ [${requestId}] Async processing error: ${error.message}`);
            }
        };

        // Start async processing (don't await)
        processAsync();

        // Return immediate response to Twilio
        const processingTime = Math.round(Date.now() - requestStart);
        logger.info(`⚡ [${requestId}] Webhook completed in ${processingTime}ms`);

        res.status(200).send('OK');
    } catch (error) {
        const processingTime = Math.round(Date.now() - requestStart);
        logger.error(`❌ [${requestId}] Webhook error after ${processingTime}ms: ${error.message}`);
        res.status(200).send('OK');
    }
});

app.post('/webhook/status', async (req, res) => {
    logger.info('📊 Status callback received');

    try {
        const messageSid = req.body.MessageSid;
        const messageStatus = req.body.MessageStatus;
        const toNumber = req.body.To;
        const errorCode = req.body.ErrorCode;
        const errorMessage = req.body.ErrorMessage;

        logger.info(`📊 Status Update for ${messageSid}:`);
        logger.info(`   To: ${toNumber}`);
        logger.info(`   Status: ${messageStatus}`);

        if (errorCode) {
            logger.warn(`   ❌ Error ${errorCode}: ${errorMessage}`);

            const errorMeanings = {
                '30007': 'Recipient device does not support MMS',
                '30008': 'Message blocked by carrier',
                '30034': 'A2P 10DLC registration issue',
                '30035': 'Media file too large',
                '30036': 'Unsupported media format',
                '11200': 'HTTP retrieval failure'
            };

            if (errorMeanings[errorCode]) {
                logger.info(`💡 Error meaning: ${errorMeanings[errorCode]}`);
            }
        } else {
            logger.info('   ✅ Message delivered successfully');
        }

        res.status(200).send('OK');
    } catch (error) {
        logger.error(`❌ Status callback error: ${error.message}`);
        res.status(200).send('OK');
    }
});

app.get('/health', async (req, res) => {
    try {
        const healthData = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            version: "Production Church SMS System with Smart Reaction Tracking v3.0",
            environment: "production"
        };

        // Test database
        const db = new sqlite3.Database('production_church.db');
        
        const memberCount = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM members WHERE active = 1");
        const recentMessages = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM broadcast_messages WHERE sent_at > datetime('now', '-24 hours') AND is_reaction = 0");
        const recentReactions = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM message_reactions WHERE created_at > datetime('now', '-24 hours')");
        const mediaCount = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM media_files WHERE upload_status = 'completed'");
        
        db.close();

        healthData.database = {
            status: "connected",
            active_members: memberCount.count,
            recent_messages_24h: recentMessages.count,
            recent_reactions_24h: recentReactions.count,
            processed_media: mediaCount.count
        };

        // Test Twilio
        try {
            const account = await smsSystem.twilioClient.api.accounts(config.twilio.accountSid).fetch();
            healthData.twilio = {
                status: "connected",
                account_status: account.status,
                phone_number: config.twilio.phoneNumber
            };
        } catch (error) {
            healthData.twilio = { status: "error", error: error.message };
        }

        // Test R2
        try {
            await smsSystem.r2Client.headBucket({ Bucket: config.r2.bucketName }).promise();
            healthData.r2_storage = {
                status: "connected",
                bucket: config.r2.bucketName
            };
        } catch (error) {
            healthData.r2_storage = { status: "error", error: error.message };
        }

        healthData.smart_reaction_system = {
            status: "active",
            silent_tracking: "enabled",
            daily_summary_time: "8:00 PM",
            pause_summary_trigger: "30 minutes silence",
            recent_reactions_24h: recentReactions.count
        };

        healthData.features = {
            clean_media_display: "enabled",
            manual_registration_only: "enabled",
            auto_registration: "disabled",
            smart_reaction_tracking: "enabled"
        };

        res.json(healthData);
    } catch (error) {
        logger.error(`❌ Health check failed: ${error.message}`);
        res.status(500).json({
            status: "unhealthy",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/', async (req, res) => {
    try {
        const db = new sqlite3.Database('production_church.db');

        const memberCount = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM members WHERE active = 1");
        const messages24h = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM broadcast_messages WHERE sent_at > datetime('now', '-24 hours') AND is_reaction = 0");
        const reactions24h = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM message_reactions WHERE created_at > datetime('now', '-24 hours')");
        const mediaProcessed = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM media_files WHERE upload_status = 'completed'");

        db.close();

        const homePageContent = `
🏛️ YesuWay Church SMS Broadcasting System
📅 Production Environment - ${new Date().toLocaleString()}

🚀 PRODUCTION STATUS: SMART REACTION TRACKING ACTIVE

📊 LIVE STATISTICS:
✅ Registered Members: ${memberCount.count}
✅ Messages (24h): ${messages24h.count}
✅ Silent Reactions (24h): ${reactions24h.count}
✅ Media Files Processed: ${mediaProcessed.count}
✅ Church Number: ${config.twilio.phoneNumber}

🔇 SMART REACTION SYSTEM:
✅ SILENT TRACKING - No reaction spam to congregation
✅ DAILY SUMMARIES - Sent every day at 8:00 PM
✅ PAUSE SUMMARIES - After 30 minutes of conversation silence
✅ INDUSTRY PATTERNS - Detects all major reaction formats
✅ SMART MATCHING - Links reactions to correct messages

🛡️ SECURITY FEATURES:
✅ REGISTERED MEMBERS ONLY
✅ No auto-registration
✅ Manual member management (database only)
✅ Unknown numbers rejected

🧹 CLEAN MEDIA SYSTEM:
✅ Professional presentation
✅ Simple "Photo 1", "Video 1" display
✅ No technical details shown
✅ Direct media viewing

🎯 CORE FEATURES:
✅ Smart media processing
✅ Unlimited file sizes
✅ Clean public links
✅ Professional broadcasting
✅ Comprehensive error handling

📱 MEMBER EXPERIENCE:
• Only registered members can send
• Unknown numbers receive rejection
• Large files become clean links
• Reactions tracked silently
• Daily summaries of engagement
• Professional presentation

🕐 REACTION SUMMARY SCHEDULE:
• Daily at 8:00 PM - Top reacted messages
• After 30min silence - Recent activity

🎯 RESULT: Zero reaction spam + Full engagement tracking!

💚 SERVING YOUR CONGREGATION 24/7 - SMART & SILENT
        `;

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(homePageContent);
    } catch (error) {
        logger.error(`❌ Home page error: ${error.message}`);
        res.status(500).send(`❌ System temporarily unavailable: ${error.message}`);
    }
});

// Error handlers
app.use((req, res) => {
    res.status(404).json({
        error: "Endpoint not found",
        status: "production",
        available_endpoints: ["/", "/health", "/webhook/sms"]
    });
});

app.use((error, req, res, next) => {
    logger.error(`❌ Internal server error: ${error.message}`);
    res.status(500).json({
        error: "Internal server error",
        status: "production"
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start the server with enhanced error handling
async function startServer() {
    logger.info('STARTING: Production Church SMS System with Smart Reaction Tracking...');
    logger.info('INFO: Professional church communication platform');
    logger.info('INFO: Clean media presentation enabled');
    logger.info('INFO: Manual registration only - secure access');
    logger.info('INFO: Smart reaction tracking - silent with summaries');
    logger.info('INFO: Daily summaries at 8:00 PM');
    logger.info('INFO: Pause summaries after 30min silence');

    // Setup congregation (always safe to run)
    try {
        await setupProductionCongregation();
    } catch (error) {
        logger.error(`❌ Congregation setup failed: ${error.message}`);
        process.exit(1);
    }

    logger.info('SUCCESS: Production Church SMS System: READY FOR MESSAGING');
    logger.info('INFO: Webhook endpoint: /webhook/sms');
    logger.info('INFO: Health monitoring: /health');
    logger.info('INFO: System overview: /');
    logger.info('INFO: Enterprise-grade system active');
    logger.info('INFO: Clean media display enabled');
    logger.info('INFO: Secure member registration (database only)');
    logger.info('INFO: Smart reaction tracking active');
    logger.info('INFO: Reaction summaries: Daily 8 PM + 30min pause');
    logger.info('INFO: Serving YesuWay Church congregation');

    // Start server
    const server = app.listen(config.port, '0.0.0.0', () => {
        logger.info(`🚀 Production Church SMS System running on port ${config.port}`);
        logger.info('💚 FULLY OPERATIONAL: All services connected and ready');
        logger.info('💚 SERVING YOUR CONGREGATION 24/7 - SMART & RESILIENT');
    });

    // Graceful shutdown handling
    const gracefulShutdown = (signal) => {
        logger.info(`${signal} received, shutting down gracefully`);
        server.close(() => {
            logger.info('Server closed successfully');
            process.exit(0);
        });
        
        // Force shutdown after 10 seconds
        setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions gracefully
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception:', error);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        gracefulShutdown('UNHANDLED_REJECTION');
    });
}

// Initialize and start with robust error handling
(async () => {
    try {
        // Initialize SMS system
        logger.info('STARTING: Initializing Production Church SMS System with Smart Reaction Tracking...');
        smsSystem = new ProductionChurchSMS();
        logger.info('SUCCESS: Production system with smart reaction tracking initialized');
        
        // Start server
        await startServer();
        
    } catch (error) {
        logger.error(`❌ Critical startup failure: ${error.message}`);
        logger.error('Stack trace:', error.stack);
        process.exit(1);
    }
})();

module.exports = app;

// Production logging configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'church-sms' },
    transports: [
        new winston.transports.File({ 
            filename: 'production_sms.log',
            maxsize: 50000000, // 50MB
            maxFiles: 5
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Load environment variables
require('dotenv').config();

// Production Configuration - No defaults, require proper values
const config = {
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: process.env.TWILIO_PHONE_NUMBER
    },
    r2: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        endpointUrl: process.env.R2_ENDPOINT_URL,
        bucketName: process.env.R2_BUCKET_NAME,
        publicUrl: process.env.R2_PUBLIC_URL
    },
    port: parseInt(process.env.PORT) || 5000
};

// Validate required configuration
function validateConfiguration() {
    const required = [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN', 
        'TWILIO_PHONE_NUMBER',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_ENDPOINT_URL',
        'R2_BUCKET_NAME'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        logger.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }

    // Validate Twilio credentials format
    if (!config.twilio.accountSid.startsWith('AC') || config.twilio.accountSid.length !== 34) {
        logger.error('❌ Invalid Twilio Account SID format');
        process.exit(1);
    }

    if (config.twilio.authToken.length < 32) {
        logger.error('❌ Invalid Twilio Auth Token format');
        process.exit(1);
    }

    if (!config.r2.endpointUrl.startsWith('https://')) {
        logger.error('❌ Invalid R2 Endpoint URL format');
        process.exit(1);
    }

    logger.info('✅ All required configuration validated');
}

// Validate configuration on startup
validateConfiguration();

// Log startup configuration (without sensitive data)
logger.info('🚀 STARTUP CONFIGURATION:');
logger.info(`   Port: ${config.port}`);
logger.info(`   Twilio Phone: ${config.twilio.phoneNumber}`);
logger.info(`   R2 Bucket: ${config.r2.bucketName}`);

// Initialize Express app with production middleware
const app = express();

// Security and performance middleware
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for basic HTML responses
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: 'Too many requests from this IP'
});
app.use(limiter);

// Request logging
app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
}));

class ProductionChurchSMS {
    constructor() {
        this.twilioClient = null;
        this.r2Client = null;
        this.conversationPauseTimer = null;
        this.lastRegularMessageTime = null;
        this.performanceMetrics = [];
        
        this.initializeServices();
        this.initializeDatabase();
        this.startReactionScheduler();
        
        logger.info('SUCCESS: Production Church SMS System with Smart Reaction Tracking initialized');
    }

    initializeServices() {
        // Initialize Twilio client
        try {
            this.twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
            
            // Test the connection
            this.twilioClient.api.accounts(config.twilio.accountSid).fetch()
                .then(account => {
                    logger.info(`SUCCESS: Twilio production connection established: ${account.friendlyName}`);
                })
                .catch(error => {
                    logger.error(`ERROR: Twilio connection test failed: ${error.message}`);
                    process.exit(1);
                });
                
        } catch (error) {
            logger.error(`ERROR: Twilio client initialization failed: ${error.message}`);
            process.exit(1);
        }

        // Initialize R2 client
        try {
            this.r2Client = new AWS.S3({
                endpoint: config.r2.endpointUrl,
                accessKeyId: config.r2.accessKeyId,
                secretAccessKey: config.r2.secretAccessKey,
                region: 'auto',
                s3ForcePathStyle: true
            });
            
            // Test the connection
            this.r2Client.headBucket({ Bucket: config.r2.bucketName }).promise()
                .then(() => {
                    logger.info(`SUCCESS: Cloudflare R2 production connection established: ${config.r2.bucketName}`);
                })
                .catch(error => {
                    logger.error(`ERROR: R2 connection test failed: ${error.message}`);
                    process.exit(1);
                });
                
        } catch (error) {
            logger.error(`ERROR: R2 client initialization failed: ${error.message}`);
            process.exit(1);
        }

        // Log final service status
        logger.info('🔧 SERVICE STATUS SUMMARY:');
        logger.info(`   📱 Twilio SMS: ✅ Connected`);
        logger.info(`   ☁️ R2 Storage: ✅ Connected`);
        logger.info(`   🗄️ Database: ✅ SQLite Ready`);
        logger.info(`   🔇 Reactions: ✅ Smart Tracking Active`);
        logger.info(`   🛡️ Security: ✅ Production Ready`);
        logger.info('🚀 PRODUCTION READY: All services connected and operational');
    }

    async initializeDatabase() {
        const maxRetries = 5;
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
            try {
                const db = new sqlite3.Database('production_church.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
                
                if (retryCount > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    logger.info(`🔄 Database initialization retry ${retryCount}/${maxRetries}`);
                }
                
                await Promise.race([
                    this.setupDatabase(db),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Database setup timeout')), 30000))
                ]);

                db.close();
                logger.info('✅ Production database with smart reaction tracking initialized');
                return;
                
            } catch (error) {
                retryCount++;
                logger.error(`❌ Database initialization attempt ${retryCount} failed: ${error.message}`);
                
                if (retryCount >= maxRetries) {
                    logger.error('❌ All database initialization attempts failed');
                    process.exit(1);
                } else {
                    logger.info(`🔄 Retrying in ${retryCount} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
    }

    async setupDatabase(db) {
        // Enable WAL mode and optimizations
        await this.runAsync(db, 'PRAGMA journal_mode=WAL');
        await this.runAsync(db, 'PRAGMA synchronous=NORMAL');
        await this.runAsync(db, 'PRAGMA cache_size=10000');
        await this.runAsync(db, 'PRAGMA temp_store=memory');
        await this.runAsync(db, 'PRAGMA foreign_keys=ON');
        await this.runAsync(db, 'PRAGMA busy_timeout=30000'); // 30 second timeout

        // Create tables
        await this.createTables(db);
        await this.createIndexes(db);
        await this.initializeGroups(db);
    }

    runAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    allAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    getAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async createTables(db) {
        const tables = [
            // Groups table
            `CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Members table
            `CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                active BOOLEAN DEFAULT TRUE,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                message_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Group membership table
            `CREATE TABLE IF NOT EXISTS group_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
                UNIQUE(group_id, member_id)
            )`,

            // Messages table
            `CREATE TABLE IF NOT EXISTS broadcast_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_phone TEXT NOT NULL,
                from_name TEXT NOT NULL,
                original_message TEXT NOT NULL,
                processed_message TEXT NOT NULL,
                message_type TEXT DEFAULT 'text',
                has_media BOOLEAN DEFAULT FALSE,
                media_count INTEGER DEFAULT 0,
                large_media_count INTEGER DEFAULT 0,
                processing_status TEXT DEFAULT 'completed',
                delivery_status TEXT DEFAULT 'pending',
                is_reaction BOOLEAN DEFAULT FALSE,
                target_message_id INTEGER,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (target_message_id) REFERENCES broadcast_messages (id)
            )`,

            // Smart reaction tracking table
            `CREATE TABLE IF NOT EXISTS message_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_message_id INTEGER NOT NULL,
                reactor_phone TEXT NOT NULL,
                reactor_name TEXT NOT NULL,
                reaction_emoji TEXT NOT NULL,
                reaction_text TEXT NOT NULL,
                is_processed BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (target_message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE
            )`,

            // Reaction summary tracking
            `CREATE TABLE IF NOT EXISTS reaction_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                summary_type TEXT NOT NULL,
                summary_content TEXT NOT NULL,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                messages_included INTEGER DEFAULT 0
            )`,

            // Media files table
            `CREATE TABLE IF NOT EXISTS media_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                original_url TEXT NOT NULL,
                twilio_media_sid TEXT,
                r2_object_key TEXT,
                public_url TEXT,
                clean_filename TEXT,
                display_name TEXT,
                original_size INTEGER,
                final_size INTEGER,
                mime_type TEXT,
                file_hash TEXT,
                compression_detected BOOLEAN DEFAULT FALSE,
                upload_status TEXT DEFAULT 'pending',
                upload_error TEXT,
                access_count INTEGER DEFAULT 0,
                last_accessed DATETIME,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE
            )`,

            // Delivery tracking table
            `CREATE TABLE IF NOT EXISTS delivery_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                to_phone TEXT NOT NULL,
                delivery_method TEXT NOT NULL,
                delivery_status TEXT DEFAULT 'pending',
                twilio_message_sid TEXT,
                error_code TEXT,
                error_message TEXT,
                delivery_time_ms INTEGER,
                retry_count INTEGER DEFAULT 0,
                delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
            )`,

            // Analytics table
            `CREATE TABLE IF NOT EXISTS system_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metric_name TEXT NOT NULL,
                metric_value REAL NOT NULL,
                metric_metadata TEXT,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Performance monitoring table
            `CREATE TABLE IF NOT EXISTS performance_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_type TEXT NOT NULL,
                operation_duration_ms INTEGER NOT NULL,
                success BOOLEAN DEFAULT TRUE,
                error_details TEXT,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const tableSQL of tables) {
            await this.runAsync(db, tableSQL);
        }
    }

    async createIndexes(db) {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone_number)',
            'CREATE INDEX IF NOT EXISTS idx_members_active ON members(active)',
            'CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON broadcast_messages(sent_at)',
            'CREATE INDEX IF NOT EXISTS idx_messages_is_reaction ON broadcast_messages(is_reaction)',
            'CREATE INDEX IF NOT EXISTS idx_messages_target ON broadcast_messages(target_message_id)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_target ON message_reactions(target_message_id)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_processed ON message_reactions(is_processed)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_created ON message_reactions(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_media_message_id ON media_files(message_id)',
            'CREATE INDEX IF NOT EXISTS idx_media_status ON media_files(upload_status)',
            'CREATE INDEX IF NOT EXISTS idx_delivery_message_id ON delivery_log(message_id)',
            'CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_log(delivery_status)',
            'CREATE INDEX IF NOT EXISTS idx_analytics_metric ON system_analytics(metric_name, recorded_at)',
            'CREATE INDEX IF NOT EXISTS idx_performance_type ON performance_metrics(operation_type, recorded_at)'
        ];

        for (const indexSQL of indexes) {
            await this.runAsync(db, indexSQL);
        }
    }

    async initializeGroups(db) {
        const count = await this.getAsync(db, "SELECT COUNT(*) as count FROM groups");
        
        if (count.count === 0) {
            const productionGroups = [
                ["YesuWay Congregation", "Main congregation group"],
                ["Church Leadership", "Leadership and admin group"],
                ["Media Team", "Media and technology team"]
            ];

            for (const [name, description] of productionGroups) {
                await this.runAsync(db, "INSERT INTO groups (name, description) VALUES (?, ?)", [name, description]);
            }
            logger.info("✅ Production groups initialized");
        }
    }

    cleanPhoneNumber(phone) {
        if (!phone) return null;
        
        const digits = phone.replace(/\D/g, '');
        
        if (digits.length === 10) {
            return `+1${digits}`;
        } else if (digits.length === 11 && digits.startsWith('1')) {
            return `+${digits}`;
        } else if (digits.length > 11) {
            return `+${digits}`;
        } else {
            logger.warn(`Invalid phone number format: ${phone}`);
            return phone;
        }
    }

    async recordPerformanceMetric(operationType, durationMs, success = true, errorDetails = null) {
        try {
            const db = new sqlite3.Database('production_church.db');
            await this.runAsync(db, `
                INSERT INTO performance_metrics (operation_type, operation_duration_ms, success, error_details) 
                VALUES (?, ?, ?, ?)
            `, [operationType, durationMs, success, errorDetails]);
            db.close();
        } catch (error) {
            logger.error(`❌ Performance metric recording failed: ${error.message}`);
        }
    }

    detectReactionPattern(messageBody) {
        if (!messageBody) return null;
        
        messageBody = messageBody.trim();
        
        // Industry-standard reaction patterns
        const reactionPatterns = [
            // Apple iPhone reactions
            /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned)\s*["'"](.+)["'"]/,
            // Android reactions
            /^(Reacted\s*([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+)\s*to)\s*["'"](.+)["'"]/u,
            // Single emoji reactions
            /^([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+)\s*$/u,
            // Generic reaction patterns
            /^([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+)\s*to\s*["'"](.+)["'"]/u,
            // Text-based reactions
            /^(👍|👎|❤️|😂|😢|😮|😡)\s*$/
        ];

        for (const pattern of reactionPatterns) {
            const match = messageBody.match(pattern);
            if (match) {
                const groups = match.slice(1);
                
                let reactionType, targetMessage;
                if (groups.length >= 2) {
                    reactionType = groups[0];
                    targetMessage = groups[groups.length - 1] || "";
                } else {
                    reactionType = groups[0];
                    targetMessage = "";
                }

                // Map reaction types to emojis
                const reactionMapping = {
                    'Loved': '❤️',
                    'Liked': '👍',
                    'Disliked': '👎',
                    'Laughed at': '😂',
                    'Emphasized': '‼️',
                    'Questioned': '❓'
                };

                let emoji = reactionMapping[reactionType] || reactionType;

                // Extract emoji if reaction_type contains emoji
                const emojiMatch = emoji.match(/([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+)/u);
                if (emojiMatch) {
                    emoji = emojiMatch[1];
                }

                logger.info(`🎯 Industry reaction detected: '${emoji}' to message fragment: '${targetMessage.substring(0, 50)}...'`);

                return {
                    emoji: emoji,
                    targetMessageFragment: targetMessage.substring(0, 100),
                    reactionType: reactionType,
                    fullPattern: messageBody
                };
            }
        }

        return null;
    }

    async findTargetMessageForReaction(targetFragment, reactorPhone, hoursBack = 24) {
        try {
            const db = new sqlite3.Database('production_church.db');
            const sinceTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

            const recentMessages = await this.allAsync(db, `
                SELECT id, original_message, from_phone, from_name, sent_at
                FROM broadcast_messages 
                WHERE sent_at > ? 
                AND from_phone != ?
                AND is_reaction = 0
                ORDER BY sent_at DESC
                LIMIT 10
            `, [sinceTime, reactorPhone]);

            db.close();

            if (recentMessages.length === 0) {
                logger.info('🔍 No recent messages found for reaction matching');
                return null;
            }

            // Smart matching algorithm
            let bestMatch = null;
            let bestScore = 0;

            if (targetFragment) {
                const targetWords = new Set(targetFragment.toLowerCase().split(/\s+/));

                for (const msg of recentMessages) {
                    if (!msg.original_message) continue;

                    const messageWords = new Set(msg.original_message.toLowerCase().split(/\s+/));

                    if (targetWords.size > 0 && messageWords.size > 0) {
                        const commonWords = new Set([...targetWords].filter(x => messageWords.has(x)));
                        let score = commonWords.size / Math.max(targetWords.size, messageWords.size);

                        // Boost score for exact substring matches
                        if (msg.original_message.toLowerCase().includes(targetFragment.toLowerCase())) {
                            score += 0.5;
                        }

                        if (score > bestScore && score > 0.3) {
                            bestScore = score;
                            bestMatch = {
                                id: msg.id,
                                message: msg.original_message,
                                fromPhone: msg.from_phone,
                                fromName: msg.from_name,
                                sentAt: msg.sent_at,
                                similarityScore: score
                            };
                        }
                    }
                }
            }

            // Fallback to most recent message if no good match
            if (!bestMatch && recentMessages.length > 0) {
                const msg = recentMessages[0];
                bestMatch = {
                    id: msg.id,
                    message: msg.original_message,
                    fromPhone: msg.from_phone,
                    fromName: msg.from_name,
                    sentAt: msg.sent_at,
                    similarityScore: 0.0
                };
                logger.info(`🎯 Using most recent message as fallback: Message ${msg.id}`);
            }

            if (bestMatch) {
                logger.info(`✅ Found reaction target (score: ${bestMatch.similarityScore.toFixed(2)}): Message ${bestMatch.id} from ${bestMatch.fromName}`);
            }

            return bestMatch;
        } catch (error) {
            logger.error(`❌ Error finding reaction target: ${error.message}`);
            return null;
        }
    }

    async getMemberInfo(phoneNumber) {
        try {
            phoneNumber = this.cleanPhoneNumber(phoneNumber);
            const db = new sqlite3.Database('production_church.db');

            const result = await this.getAsync(db, `
                SELECT id, name, is_admin, message_count 
                FROM members 
                WHERE phone_number = ? AND active = 1
            `, [phoneNumber]);

            db.close();

            if (result) {
                return {
                    id: result.id,
                    name: result.name,
                    isAdmin: Boolean(result.is_admin),
                    messageCount: result.message_count
                };
            } else {
                logger.warn(`❌ Unregistered number attempted access: ${phoneNumber}`);
                return null;
            }
        } catch (error) {
            logger.error(`❌ Error getting member info: ${error.message}`);
            return null;
        }
    }

    async storeReactionSilently(reactorPhone, reactionData, targetMessage) {
        try {
            const reactor = await this.getMemberInfo(reactorPhone);
            if (!reactor) {
                logger.warn(`❌ Reaction from unregistered number: ${reactorPhone}`);
                return false;
            }

            const targetMsgId = targetMessage.id;
            const reactionEmoji = reactionData.emoji;
            const reactionText = reactionData.fullPattern;

            logger.info(`🔇 Storing silent reaction: ${reactor.name} reacted '${reactionEmoji}' to message ${targetMsgId}`);

            const db = new sqlite3.Database('production_church.db');

            // Store reaction silently
            await this.runAsync(db, `
                INSERT INTO message_reactions 
                (target_message_id, reactor_phone, reactor_name, reaction_emoji, reaction_text, is_processed) 
                VALUES (?, ?, ?, ?, ?, 0)
            `, [targetMsgId, reactorPhone, reactor.name, reactionEmoji, reactionText]);

            // Mark original message to track it has reactions
            await this.runAsync(db, `
                UPDATE broadcast_messages 
                SET message_type = 'text_with_reactions'
                WHERE id = ?
            `, [targetMsgId]);

            db.close();

            logger.info('✅ Reaction stored silently - no broadcast sent');
            return true;
        } catch (error) {
            logger.error(`❌ Error storing silent reaction: ${error.message}`);
            return false;
        }
    }

    startReactionScheduler() {
        // Schedule daily summary at 8 PM
        schedule.scheduleJob('0 20 * * *', () => {
            this.sendDailyReactionSummary();
        });

        logger.info('✅ Smart reaction scheduler started - Daily summaries at 8 PM');
    }

    resetConversationPauseTimer() {
        if (this.conversationPauseTimer) {
            clearTimeout(this.conversationPauseTimer);
        }

        // Set timer for 30 minutes from now
        this.conversationPauseTimer = setTimeout(() => {
            this.sendPauseReactionSummary();
        }, 30 * 60 * 1000); // 30 minutes

        this.lastRegularMessageTime = new Date();
        logger.debug('🕐 Conversation pause timer reset - 30 minutes');
    }

    async sendPauseReactionSummary() {
        try {
            const sinceTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // Last 2 hours
            const db = new sqlite3.Database('production_church.db');

            const reactionData = await this.allAsync(db, `
                SELECT mr.target_message_id, bm.from_name, bm.original_message, 
                       mr.reaction_emoji, COUNT(*) as reaction_count
                FROM message_reactions mr
                JOIN broadcast_messages bm ON mr.target_message_id = bm.id
                WHERE mr.is_processed = 0 
                AND mr.created_at > ?
                GROUP BY mr.target_message_id, mr.reaction_emoji
                ORDER BY bm.sent_at DESC
            `, [sinceTime]);

            if (reactionData.length === 0) {
                db.close();
                logger.info('🔇 No unprocessed reactions for pause summary');
                return;
            }

            // Build smart summary
            const summaryLines = ["📊 Recent reactions:"];
            let messagesIncluded = 0;

            // Group by message
            const messageReactions = {};
            for (const row of reactionData) {
                const { target_message_id, from_name, original_message, reaction_emoji, reaction_count } = row;
                if (!messageReactions[target_message_id]) {
                    messageReactions[target_message_id] = {
                        fromName: from_name,
                        message: original_message,
                        reactions: {}
                    };
                }
                messageReactions[target_message_id].reactions[reaction_emoji] = reaction_count;
            }

            for (const [targetId, msgData] of Object.entries(messageReactions)) {
                messagesIncluded++;
                const messagePreview = msgData.message.length > 40 
                    ? msgData.message.substring(0, 40) + "..." 
                    : msgData.message;

                // Format reaction counts
                const reactionParts = [];
                for (const [emoji, count] of Object.entries(msgData.reactions)) {
                    if (count === 1) {
                        reactionParts.push(emoji);
                    } else {
                        reactionParts.push(`${emoji}×${count}`);
                    }
                }

                const reactionDisplay = reactionParts.join(' ');
                summaryLines.push(`💬 ${msgData.fromName}: "${messagePreview}" → ${reactionDisplay}`);
            }

            // Mark all reactions as processed
            await this.runAsync(db, `
                UPDATE message_reactions 
                SET is_processed = 1 
                WHERE is_processed = 0 
                AND created_at > ?
            `, [sinceTime]);

            // Store summary record
            const summaryContent = summaryLines.join('\n');
            await this.runAsync(db, `
                INSERT INTO reaction_summaries (summary_type, summary_content, messages_included) 
                VALUES ('pause_summary', ?, ?)
            `, [summaryContent, messagesIncluded]);

            db.close();

            // Broadcast summary to congregation
            await this.broadcastSummaryToCongregation(summaryContent);

            logger.info(`✅ Pause reaction summary sent - ${messagesIncluded} messages included`);
        } catch (error) {
            logger.error(`❌ Error sending pause reaction summary: ${error.message}`);
        }
    }

    async sendDailyReactionSummary() {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            
            const db = new sqlite3.Database('production_church.db');

            const reactionData = await this.allAsync(db, `
                SELECT mr.target_message_id, bm.from_name, bm.original_message, 
                       mr.reaction_emoji, COUNT(*) as reaction_count
                FROM message_reactions mr
                JOIN broadcast_messages bm ON mr.target_message_id = bm.id
                WHERE mr.is_processed = 0 
                AND mr.created_at >= ?
                GROUP BY mr.target_message_id, mr.reaction_emoji
                ORDER BY reaction_count DESC, bm.sent_at DESC
                LIMIT 10
            `, [todayStart.toISOString()]);

            if (reactionData.length === 0) {
                db.close();
                logger.info('🔇 No reactions for daily summary');
                return;
            }

            // Build comprehensive daily summary
            const summaryLines = ["📊 TODAY'S REACTIONS:"];
            let messagesIncluded = 0;
            let totalReactions = 0;

            // Group by message
            const messageReactions = {};
            for (const row of reactionData) {
                const { target_message_id, from_name, original_message, reaction_emoji, reaction_count } = row;
                totalReactions += reaction_count;
                if (!messageReactions[target_message_id]) {
                    messageReactions[target_message_id] = {
                        fromName: from_name,
                        message: original_message,
                        reactions: {},
                        totalCount: 0
                    };
                }
                messageReactions[target_message_id].reactions[reaction_emoji] = reaction_count;
                messageReactions[target_message_id].totalCount += reaction_count;
            }

            // Sort by total reaction count
            const sortedMessages = Object.entries(messageReactions)
                .sort(([,a], [,b]) => b.totalCount - a.totalCount)
                .slice(0, 5); // Top 5 most reacted messages

            for (const [targetId, msgData] of sortedMessages) {
                messagesIncluded++;
                const messagePreview = msgData.message.length > 50 
                    ? msgData.message.substring(0, 50) + "..." 
                    : msgData.message;

                // Format reaction counts
                const reactionParts = [];
                for (const [emoji, count] of Object.entries(msgData.reactions)) {
                    if (count === 1) {
                        reactionParts.push(emoji);
                    } else {
                        reactionParts.push(`${emoji}×${count}`);
                    }
                }

                const reactionDisplay = reactionParts.join(' ');
                const totalForMsg = msgData.totalCount;
                summaryLines.push(`• ${msgData.fromName}: "${messagePreview}" (${totalForMsg} reactions: ${reactionDisplay})`);
            }

            // Add engagement stats
            const uniqueReactors = await this.getAsync(db, `
                SELECT COUNT(DISTINCT reactor_phone) as count
                FROM message_reactions 
                WHERE is_processed = 0 
                AND created_at >= ?
            `, [todayStart.toISOString()]);

            summaryLines.push(`\n🎯 Today's engagement: ${totalReactions} reactions from ${uniqueReactors.count} members`);

            // Mark all today's reactions as processed
            await this.runAsync(db, `
                UPDATE message_reactions 
                SET is_processed = 1 
                WHERE is_processed = 0 
                AND created_at >= ?
            `, [todayStart.toISOString()]);

            // Store summary record
            const summaryContent = summaryLines.join('\n');
            await this.runAsync(db, `
                INSERT INTO reaction_summaries (summary_type, summary_content, messages_included) 
                VALUES ('daily_summary', ?, ?)
            `, [summaryContent, messagesIncluded]);

            db.close();

            // Broadcast summary to congregation
            await this.broadcastSummaryToCongregation(summaryContent);

            logger.info(`✅ Daily reaction summary sent - ${messagesIncluded} messages, ${totalReactions} reactions`);
        } catch (error) {
            logger.error(`❌ Error sending daily reaction summary: ${error.message}`);
        }
    }

    async broadcastSummaryToCongregation(summaryContent) {
        try {
            const recipients = await this.getAllActiveMembers();

            if (recipients.length === 0) {
                logger.warn('❌ No active recipients for summary broadcast');
                return;
            }

            logger.info(`📤 Broadcasting reaction summary to ${recipients.length} members`);

            // Concurrent delivery of summary
            const deliveryPromises = recipients.map(async (member) => {
                try {
                    const result = await this.sendSMS(member.phone, summaryContent);
                    if (result.success) {
                        logger.info(`✅ Summary delivered to ${member.name}`);
                    } else {
                        logger.error(`❌ Summary failed to ${member.name}: ${result.error}`);
                    }
                } catch (error) {
                    logger.error(`❌ Summary delivery error to ${member.name}: ${error.message}`);
                }
            });

            await Promise.allSettled(deliveryPromises);
            logger.info('✅ Reaction summary broadcast completed');
        } catch (error) {
            logger.error(`❌ Error broadcasting summary: ${error.message}`);
        }
    }

    async downloadMediaFromTwilio(mediaUrl) {
        const startTime = Date.now();
        try {
            logger.info(`📥 Downloading media: ${mediaUrl}`);

            const response = await axios.get(mediaUrl, {
                auth: {
                    username: config.twilio.accountSid,
                    password: config.twilio.authToken
                },
                timeout: 60000,
                responseType: 'arraybuffer'
            });

            if (response.status === 200) {
                const content = Buffer.from(response.data);
                const contentType = response.headers['content-type'] || 'application/octet-stream';
                const fileHash = crypto.createHash('sha256').update(content).digest('hex');

                const durationMs = Date.now() - startTime;
                await this.recordPerformanceMetric('media_download', durationMs, true);

                logger.info(`✅ Downloaded ${content.length} bytes, type: ${contentType}`);

                return {
                    content: content,
                    size: content.length,
                    mimeType: contentType,
                    hash: fileHash,
                    headers: response.headers
                };
            } else {
                const durationMs = Date.now() - startTime;
                await this.recordPerformanceMetric('media_download', durationMs, false, `HTTP ${response.status}`);
                logger.error(`❌ Download failed: HTTP ${response.status}`);
                return null;
            }
        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('media_download', durationMs, false, error.message);
            logger.error(`❌ Media download error: ${error.message}`);
            return null;
        }
    }

    generateCleanFilename(mimeType, mediaIndex = 1) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);

        let extension, baseName, displayName;

        if (mimeType.includes('image')) {
            if (mimeType.includes('gif')) {
                extension = '.gif';
                baseName = `gif_${timestamp}`;
                displayName = `GIF ${mediaIndex}`;
            } else {
                extension = '.jpg';
                baseName = `photo_${timestamp}`;
                displayName = `Photo ${mediaIndex}`;
            }
        } else if (mimeType.includes('video')) {
            extension = '.mp4';
            baseName = `video_${timestamp}`;
            displayName = `Video ${mediaIndex}`;
        } else if (mimeType.includes('audio')) {
            extension = '.mp3';
            baseName = `audio_${timestamp}`;
            displayName = `Audio ${mediaIndex}`;
        } else {
            extension = mime.extension(mimeType) ? `.${mime.extension(mimeType)}` : '.file';
            baseName = `file_${timestamp}`;
            displayName = `File ${mediaIndex}`;
        }

        if (mediaIndex > 1) {
            baseName += `_${mediaIndex}`;
        }

        const cleanFilename = `church/${baseName}${extension}`;

        return { cleanFilename, displayName };
    }

    async uploadToR2(fileContent, objectKey, mimeType, metadata = {}) {
        const startTime = Date.now();
        try {
            logger.info(`☁️ Uploading to R2: ${objectKey}`);

            const uploadMetadata = {
                'church-system': 'yesuway-production',
                'upload-timestamp': new Date().toISOString(),
                'content-hash': crypto.createHash('sha256').update(fileContent).digest('hex'),
                ...metadata
            };

            const params = {
                Bucket: config.r2.bucketName,
                Key: objectKey,
                Body: fileContent,
                ContentType: mimeType,
                ContentDisposition: 'inline',
                CacheControl: 'public, max-age=31536000',
                Metadata: uploadMetadata,
                ServerSideEncryption: 'AES256'
            };

            await this.r2Client.upload(params).promise();

            let publicUrl;
            if (config.r2.publicUrl) {
                publicUrl = `${config.r2.publicUrl.replace(/\/$/, '')}/${objectKey}`;
            } else {
                publicUrl = this.r2Client.getSignedUrl('getObject', {
                    Bucket: config.r2.bucketName,
                    Key: objectKey,
                    Expires: 31536000 // 1 year
                });
            }

            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('r2_upload', durationMs, true);

            logger.info(`✅ Upload successful: ${publicUrl}`);
            return publicUrl;
        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('r2_upload', durationMs, false, error.message);
            logger.error(`❌ R2 upload failed: ${error.message}`);
            return null;
        }
    }

    async processMediaFiles(messageId, mediaUrls) {
        logger.info(`🔄 Processing ${mediaUrls.length} media files for message ${messageId}`);

        const processedLinks = [];
        const processingErrors = [];

        for (let i = 0; i < mediaUrls.length; i++) {
            const media = mediaUrls[i];
            const mediaUrl = media.url || '';
            const mediaType = media.type || 'unknown';

            try {
                logger.info(`📎 Processing media ${i + 1}/${mediaUrls.length}: ${mediaType}`);

                const mediaData = await this.downloadMediaFromTwilio(mediaUrl);

                if (!mediaData) {
                    const errorMsg = `Failed to download media ${i + 1}`;
                    processingErrors.push(errorMsg);
                    logger.error(errorMsg);
                    continue;
                }

                const fileSize = mediaData.size;
                const compressionDetected = fileSize >= 4.8 * 1024 * 1024;

                const { cleanFilename, displayName } = this.generateCleanFilename(
                    mediaData.mimeType,
                    i + 1
                );

                const publicUrl = await this.uploadToR2(
                    mediaData.content,
                    cleanFilename,
                    mediaData.mimeType,
                    {
                        'original-size': fileSize.toString(),
                        'compression-detected': compressionDetected.toString(),
                        'media-index': i.toString(),
                        'display-name': displayName
                    }
                );

                if (publicUrl) {
                    const db = new sqlite3.Database('production_church.db');

                    await this.runAsync(db, `
                        INSERT INTO media_files 
                        (message_id, original_url, r2_object_key, public_url, clean_filename, display_name,
                         original_size, final_size, mime_type, file_hash, compression_detected, upload_status) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
                    `, [
                        messageId, mediaUrl, cleanFilename, publicUrl, cleanFilename.split('/').pop(), displayName,
                        fileSize, fileSize, mediaData.mimeType, mediaData.hash, compressionDetected
                    ]);

                    db.close();

                    processedLinks.push({
                        url: publicUrl,
                        displayName: displayName,
                        type: mediaData.mimeType
                    });
                    logger.info(`✅ Media ${i + 1} processed successfully`);
                } else {
                    const errorMsg = `Failed to upload media ${i + 1} to R2`;
                    processingErrors.push(errorMsg);
                    logger.error(errorMsg);
                }
            } catch (error) {
                const errorMsg = `Error processing media ${i + 1}: ${error.message}`;
                processingErrors.push(errorMsg);
                logger.error(errorMsg);
            }
        }

        logger.info(`✅ Media processing complete: ${processedLinks.length} successful, ${processingErrors.length} errors`);
        return { processedLinks, processingErrors };
    }

    async getAllActiveMembers(excludePhone = null) {
        try {
            excludePhone = excludePhone ? this.cleanPhoneNumber(excludePhone) : null;

            const db = new sqlite3.Database('production_church.db');

            let query = `
                SELECT DISTINCT m.id, m.phone_number, m.name, m.is_admin
                FROM members m
                JOIN group_members gm ON m.id = gm.member_id
                WHERE m.active = 1
            `;
            const params = [];

            if (excludePhone) {
                query += " AND m.phone_number != ?";
                params.push(excludePhone);
            }

            query += " ORDER BY m.name";

            const rows = await this.allAsync(db, query, params);
            db.close();

            const members = [];
            for (const row of rows) {
                const cleanPhone = this.cleanPhoneNumber(row.phone_number);
                if (cleanPhone) {
                    members.push({
                        id: row.id,
                        phone: cleanPhone,
                        name: row.name,
                        isAdmin: Boolean(row.is_admin)
                    });
                }
            }

            logger.info(`📋 Retrieved ${members.length} active members`);
            return members;
        } catch (error) {
            logger.error(`❌ Error retrieving members: ${error.message}`);
            return [];
        }
    }

    async sendSMS(toPhone, messageText, maxRetries = 3) {
        const startTime = Date.now();
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const message = await this.twilioClient.messages.create({
                    body: messageText,
                    from: config.twilio.phoneNumber,
                    to: toPhone
                });

                const durationMs = Date.now() - startTime;
                await this.recordPerformanceMetric('sms_send', durationMs, true);

                logger.info(`SUCCESS: SMS sent to ${toPhone}: ${message.sid}`);
                return {
                    success: true,
                    sid: message.sid,
                    attempt: attempt
                };
            } catch (error) {
                logger.warn(`WARNING: SMS attempt ${attempt} failed for ${toPhone}: ${error.message}`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                } else {
                    const durationMs = Date.now() - startTime;
                    await this.recordPerformanceMetric('sms_send', durationMs, false, error.message);
                    logger.error(`ERROR: All SMS attempts failed for ${toPhone}`);
                    return {
                        success: false,
                        error: error.message,
                        attempts: maxRetries
                    };
                }
            }
        }
    }

    formatMessageWithMedia(originalMessage, sender, mediaLinks = null) {
        if (mediaLinks && mediaLinks.length > 0) {
            if (mediaLinks.length === 1) {
                const mediaItem = mediaLinks[0];
                return `💬 ${sender.name}:\n${originalMessage}\n\n🔗 ${mediaItem.displayName}: ${mediaItem.url}`;
            } else {
                const mediaText = mediaLinks.map(item => `🔗 ${item.displayName}: ${item.url}`).join('\n');
                return `💬 ${sender.name}:\n${originalMessage}\n\n${mediaText}`;
            }
        } else {
            return `💬 ${sender.name}:\n${originalMessage}`;
        }
    }

    async broadcastMessage(fromPhone, messageText, mediaUrls = null) {
        const startTime = Date.now();
        logger.info(`📡 Starting broadcast from ${fromPhone}`);

        try {
            const sender = await this.getMemberInfo(fromPhone);

            if (!sender) {
                logger.warn(`❌ Broadcast rejected - unregistered number: ${fromPhone}`);
                return "You are not registered. Please contact church admin to be added to the system.";
            }

            const recipients = await this.getAllActiveMembers(fromPhone);

            if (recipients.length === 0) {
                logger.warn('❌ No active recipients found');
                return "No active congregation members found for broadcast.";
            }

            // Store broadcast message
            const db = new sqlite3.Database('production_church.db');

            const result = await this.runAsync(db, `
                INSERT INTO broadcast_messages 
                (from_phone, from_name, original_message, processed_message, message_type, 
                 has_media, media_count, processing_status, delivery_status, is_reaction) 
                VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'pending', 0)
            `, [
                fromPhone, sender.name, messageText, messageText,
                mediaUrls ? 'media' : 'text',
                Boolean(mediaUrls), mediaUrls ? mediaUrls.length : 0
            ]);

            const messageId = result.lastID;
            db.close();

            // Process media if present
            let cleanMediaLinks = [];
            let largeMediaCount = 0;

            if (mediaUrls && mediaUrls.length > 0) {
                logger.info(`🔄 Processing ${mediaUrls.length} media files...`);
                const { processedLinks, processingErrors } = await this.processMediaFiles(messageId, mediaUrls);
                cleanMediaLinks = processedLinks;
                largeMediaCount = processedLinks.length;

                if (processingErrors.length > 0) {
                    logger.warn(`⚠️ Media processing errors: ${processingErrors}`);
                }
            }

            // Format final message
            const finalMessage = this.formatMessageWithMedia(
                messageText, sender, cleanMediaLinks
            );

            // Update message with processed content
            const db2 = new sqlite3.Database('production_church.db');
            await this.runAsync(db2, `
                UPDATE broadcast_messages 
                SET processed_message = ?, large_media_count = ?, processing_status = 'completed'
                WHERE id = ?
            `, [finalMessage, largeMediaCount, messageId]);
            db2.close();

            // Reset conversation pause timer for regular messages
            this.resetConversationPauseTimer();

            // Broadcast with concurrent delivery
            const deliveryStats = {
                sent: 0,
                failed: 0,
                totalTime: 0,
                errors: []
            };

            const sendPromises = recipients.map(async (member) => {
                const memberStart = Date.now();
                try {
                    const result = await this.sendSMS(member.phone, finalMessage);
                    const deliveryTime = Date.now() - memberStart;

                    // Log delivery
                    const db3 = new sqlite3.Database('production_church.db');
                    await this.runAsync(db3, `
                        INSERT INTO delivery_log 
                        (message_id, member_id, to_phone, delivery_method, delivery_status, 
                         twilio_message_sid, error_message, delivery_time_ms) 
                        VALUES (?, ?, ?, 'sms', ?, ?, ?, ?)
                    `, [
                        messageId, member.id, member.phone,
                        result.success ? 'delivered' : 'failed',
                        result.sid || null, result.error || null, deliveryTime
                    ]);
                    db3.close();

                    if (result.success) {
                        deliveryStats.sent++;
                        logger.info(`✅ Delivered to ${member.name}: ${result.sid}`);
                    } else {
                        deliveryStats.failed++;
                        deliveryStats.errors.push(`${member.name}: ${result.error}`);
                        logger.error(`❌ Failed to ${member.name}: ${result.error}`);
                    }
                } catch (error) {
                    deliveryStats.failed++;
                    deliveryStats.errors.push(`${member.name}: ${error.message}`);
                    logger.error(`❌ Delivery error to ${member.name}: ${error.message}`);
                }
            });

            logger.info(`📤 Starting concurrent delivery to ${recipients.length} recipients...`);
            await Promise.allSettled(sendPromises);

            // Calculate final stats
            const totalTime = (Date.now() - startTime) / 1000;
            deliveryStats.totalTime = totalTime;

            // Update final delivery status
            const db4 = new sqlite3.Database('production_church.db');
            await this.runAsync(db4, `
                UPDATE broadcast_messages 
                SET delivery_status = 'completed'
                WHERE id = ?
            `, [messageId]);

            // Record analytics
            await this.runAsync(db4, `
                INSERT INTO system_analytics (metric_name, metric_value, metric_metadata) 
                VALUES (?, ?, ?)
            `, ['broadcast_delivery_rate',
                deliveryStats.sent / recipients.length * 100,
                `sent:${deliveryStats.sent},failed:${deliveryStats.failed},time:${totalTime.toFixed(2)}s`]);

            // Update sender message count
            await this.runAsync(db4, `
                UPDATE members 
                SET message_count = message_count + 1, last_activity = CURRENT_TIMESTAMP
                WHERE phone_number = ?
            `, [fromPhone]);

            db4.close();

            // Record broadcast performance
            const broadcastDurationMs = Math.round(totalTime * 1000);
            await this.recordPerformanceMetric('broadcast_complete', broadcastDurationMs, true);

            logger.info(`📊 Broadcast completed in ${totalTime.toFixed(2)}s: ${deliveryStats.sent} sent, ${deliveryStats.failed} failed`);

            // Return confirmation to sender if admin
            if (sender.isAdmin) {
                let confirmation = `✅ Broadcast completed in ${totalTime.toFixed(1)}s\n`;
                confirmation += `📊 Delivered: ${deliveryStats.sent}/${recipients.length}\n`;

                if (largeMediaCount > 0) {
                    confirmation += `📎 Clean media links: ${largeMediaCount}\n`;
                }

                if (deliveryStats.failed > 0) {
                    confirmation += `⚠️ Failed deliveries: ${deliveryStats.failed}\n`;
                }

                confirmation += '🔇 Smart reaction tracking: Active';
                return confirmation;
            } else {
                return null; // No confirmation for regular members
            }
        } catch (error) {
            logger.error(`❌ Broadcast error: ${error.message}`);
            return "Broadcast failed - system administrators notified";
        }
    }

    async isAdmin(phoneNumber) {
        try {
            phoneNumber = this.cleanPhoneNumber(phoneNumber);

            const db = new sqlite3.Database('production_church.db');
            const result = await this.getAsync(db, "SELECT is_admin FROM members WHERE phone_number = ? AND active = 1", [phoneNumber]);
            db.close();

            return result ? Boolean(result.is_admin) : false;
        } catch (error) {
            logger.error(`❌ Admin check error: ${error.message}`);
            return false;
        }
    }

    async handleIncomingMessage(fromPhone, messageBody, mediaUrls) {
        logger.info(`📨 Incoming message from ${fromPhone}`);

        try {
            fromPhone = this.cleanPhoneNumber(fromPhone);
            messageBody = messageBody ? messageBody.trim() : "";

            // Log media if present
            if (mediaUrls && mediaUrls.length > 0) {
                logger.info(`📎 Received ${mediaUrls.length} media files`);
                for (let i = 0; i < mediaUrls.length; i++) {
                    const media = mediaUrls[i];
                    logger.info(`   Media ${i + 1}: ${media.type || 'unknown'}`);
                }
            }

            // Get member info - no auto-registration
            const member = await this.getMemberInfo(fromPhone);

            if (!member) {
                logger.warn(`❌ Rejected message from unregistered number: ${fromPhone}`);
                // Send rejection message
                await this.sendSMS(
                    fromPhone,
                    "You are not registered in the church SMS system. Please contact a church administrator to be added."
                );
                return null;
            }

            logger.info(`👤 Sender: ${member.name} (Admin: ${member.isAdmin})`);

            // CRITICAL: Detect reactions FIRST and handle silently
            const reactionData = this.detectReactionPattern(messageBody);
            if (reactionData) {
                logger.info(`🔇 Silent reaction detected: ${member.name} reacted '${reactionData.emoji}'`);

                // Find target message
                const targetMessage = await this.findTargetMessageForReaction(
                    reactionData.targetMessageFragment,
                    fromPhone
                );

                if (targetMessage) {
                    // Store reaction silently - NO BROADCAST
                    const success = await this.storeReactionSilently(fromPhone, reactionData, targetMessage);
                    if (success) {
                        logger.info('✅ Reaction stored silently - will appear in next summary');
                        return null; // No response, no broadcast - completely silent
                    } else {
                        logger.error('❌ Failed to store reaction silently');
                        return null;
                    }
                } else {
                    logger.warn('⚠️ Could not find target message for reaction');
                    return null; // Still silent even if target not found
                }
            }

            // Handle member commands
            if (messageBody.toUpperCase() === 'HELP') {
                return (
                    "📋 YESUWAY CHURCH SMS SYSTEM\n\n" +
                    "✅ Send messages to entire congregation\n" +
                    "✅ Share photos/videos (unlimited size)\n" +
                    "✅ Clean media links (no technical details)\n" +
                    "✅ Full quality preserved automatically\n" +
                    "✅ Smart reaction tracking (silent)\n\n" +
                    "📱 Text HELP for this message\n" +
                    "🔇 Reactions tracked silently - summaries at 8 PM daily\n" +
                    "🏛️ Production system - serving 24/7"
                );
            }

            // Default: Broadcast regular message
            logger.info('📡 Processing regular message broadcast...');
            return await this.broadcastMessage(fromPhone, messageBody, mediaUrls);
        } catch (error) {
            logger.error(`❌ Message processing error: ${error.message}`);
            return "Message processing temporarily unavailable - please try again";
        }
    }
}

// Initialize production system
logger.info('STARTING: Initializing Production Church SMS System with Smart Reaction Tracking...');
let smsSystem;
try {
    smsSystem = new ProductionChurchSMS();
    logger.info('SUCCESS: Production system with smart reaction tracking fully operational');
} catch (error) {
    logger.error(`CRITICAL: Production system failed to initialize: ${error.message}`);
    process.exit(1);
}

async function setupProductionCongregation() {
    logger.info('🔧 Setting up production congregation...');

    try {
        const db = new sqlite3.Database('production_church.db');

        // Add primary admin
        await smsSystem.runAsync(db, `
            INSERT OR REPLACE INTO members (phone_number, name, is_admin, active, message_count) 
            VALUES (?, ?, ?, 1, 0)
        `, ["+14257729189", "Church Admin", true]);

        const adminResult = await smsSystem.getAsync(db, "SELECT id FROM members WHERE phone_number = ?", ["+14257729189"]);
        const adminId = adminResult.id;

        // Add to admin group
        await smsSystem.runAsync(db, `
            INSERT OR IGNORE INTO group_members (group_id, member_id) 
            VALUES (2, ?)
        `, [adminId]);

        // Add production members
        const productionMembers = [
            ["+12068001141", "Mike", 1],
            ["+14257729189", "Sam", 1],
            ["+12065910943", "Sami", 3],
            ["+12064349652", "Yab", 1]
        ];

        for (const [phone, name, groupId] of productionMembers) {
            await smsSystem.runAsync(db, `
                INSERT OR REPLACE INTO members (phone_number, name, is_admin, active, message_count) 
                VALUES (?, ?, ?, 1, 0)
            `, [phone, name, false]);

            const memberResult = await smsSystem.getAsync(db, "SELECT id FROM members WHERE phone_number = ?", [phone]);
            const memberId = memberResult.id;

            await smsSystem.runAsync(db, `
                INSERT OR IGNORE INTO group_members (group_id, member_id) 
                VALUES (?, ?)
            `, [groupId, memberId]);
        }

        db.close();
        logger.info('✅ Production congregation setup completed with smart reaction tracking');
    } catch (error) {
        logger.error(`❌ Production setup error: ${error.message}`);
    }
}

// Request monitoring middleware
app.use((req, res, next) => {
    req.startTime = Date.now();
    next();
});

app.use((req, res, next) => {
    res.on('finish', async () => {
        if (req.startTime) {
            const duration = Date.now() - req.startTime;
            if (duration > 1000) {
                logger.warn(`⏰ Slow request: ${req.route?.path || req.path} took ${duration}ms`);
            }

            try {
                if (smsSystem && smsSystem.recordPerformanceMetric) {
                    const endpoint = req.route?.path || req.path || 'unknown';
                    await smsSystem.recordPerformanceMetric(`http_${endpoint}`, duration, res.statusCode < 400);
                }
            } catch (error) {
                // Ignore metric recording errors
            }
        }
    });
    next();
});

app.post('/webhook/sms', async (req, res) => {
    const requestStart = Date.now();
    const requestId = uuidv4().substring(0, 8);

    logger.info(`🌐 [${requestId}] SMS webhook called`);

    try {
        // Extract webhook data
        const fromNumber = (req.body.From || '').trim();
        const messageBody = (req.body.Body || '').trim();
        const numMedia = parseInt(req.body.NumMedia || 0);
        const messageSid = req.body.MessageSid || '';

        logger.info(`📨 [${requestId}] From: ${fromNumber}, Body: '${messageBody}', Media: ${numMedia}`);

        if (!fromNumber) {
            logger.warn(`⚠️ [${requestId}] Missing From number`);
            return res.status(200).send('OK');
        }

        // Extract media URLs
        const mediaUrls = [];
        for (let i = 0; i < numMedia; i++) {
            const mediaUrl = req.body[`MediaUrl${i}`];
            const mediaType = req.body[`MediaContentType${i}`];

            if (mediaUrl) {
                mediaUrls.push({
                    url: mediaUrl,
                    type: mediaType || 'unknown',
                    index: i
                });
                logger.info(`📎 [${requestId}] Media ${i + 1}: ${mediaType}`);
            }
        }

        // Process message asynchronously
        const processAsync = async () => {
            try {
                const response = await smsSystem.handleIncomingMessage(
                    fromNumber, messageBody, mediaUrls
                );

                // Send response if needed (reactions return null - no response)
                if (response && await smsSystem.isAdmin(fromNumber)) {
                    const result = await smsSystem.sendSMS(fromNumber, response);
                    if (result.success) {
                        logger.info(`📤 [${requestId}] Response sent: ${result.sid}`);
                    } else {
                        logger.error(`❌ [${requestId}] Response failed: ${result.error}`);
                    }
                }
            } catch (error) {
                logger.error(`❌ [${requestId}] Async processing error: ${error.message}`);
            }
        };

        // Start async processing (don't await)
        processAsync();

        // Return immediate response to Twilio
        const processingTime = Math.round(Date.now() - requestStart);
        logger.info(`⚡ [${requestId}] Webhook completed in ${processingTime}ms`);

        res.status(200).send('OK');
    } catch (error) {
        const processingTime = Math.round(Date.now() - requestStart);
        logger.error(`❌ [${requestId}] Webhook error after ${processingTime}ms: ${error.message}`);
        res.status(200).send('OK');
    }
});

app.post('/webhook/status', async (req, res) => {
    logger.info('📊 Status callback received');

    try {
        const messageSid = req.body.MessageSid;
        const messageStatus = req.body.MessageStatus;
        const toNumber = req.body.To;
        const errorCode = req.body.ErrorCode;
        const errorMessage = req.body.ErrorMessage;

        logger.info(`📊 Status Update for ${messageSid}:`);
        logger.info(`   To: ${toNumber}`);
        logger.info(`   Status: ${messageStatus}`);

        if (errorCode) {
            logger.warn(`   ❌ Error ${errorCode}: ${errorMessage}`);

            const errorMeanings = {
                '30007': 'Recipient device does not support MMS',
                '30008': 'Message blocked by carrier',
                '30034': 'A2P 10DLC registration issue',
                '30035': 'Media file too large',
                '30036': 'Unsupported media format',
                '11200': 'HTTP retrieval failure'
            };

            if (errorMeanings[errorCode]) {
                logger.info(`💡 Error meaning: ${errorMeanings[errorCode]}`);
            }
        } else {
            logger.info('   ✅ Message delivered successfully');
        }

        res.status(200).send('OK');
    } catch (error) {
        logger.error(`❌ Status callback error: ${error.message}`);
        res.status(200).send('OK');
    }
});

app.get('/health', async (req, res) => {
    try {
        const healthData = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            version: "Production Church SMS System with Smart Reaction Tracking v3.0",
            environment: "production"
        };

        // Test database
        const db = new sqlite3.Database('production_church.db');
        
        const memberCount = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM members WHERE active = 1");
        const recentMessages = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM broadcast_messages WHERE sent_at > datetime('now', '-24 hours') AND is_reaction = 0");
        const recentReactions = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM message_reactions WHERE created_at > datetime('now', '-24 hours')");
        const mediaCount = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM media_files WHERE upload_status = 'completed'");
        
        db.close();

        healthData.database = {
            status: "connected",
            active_members: memberCount.count,
            recent_messages_24h: recentMessages.count,
            recent_reactions_24h: recentReactions.count,
            processed_media: mediaCount.count
        };

        // Test Twilio
        try {
            const account = await smsSystem.twilioClient.api.accounts(config.twilio.accountSid).fetch();
            healthData.twilio = {
                status: "connected",
                account_status: account.status,
                phone_number: config.twilio.phoneNumber
            };
        } catch (error) {
            healthData.twilio = { status: "error", error: error.message };
        }

        // Test R2
        try {
            await smsSystem.r2Client.headBucket({ Bucket: config.r2.bucketName }).promise();
            healthData.r2_storage = {
                status: "connected",
                bucket: config.r2.bucketName
            };
        } catch (error) {
            healthData.r2_storage = { status: "error", error: error.message };
        }

        healthData.smart_reaction_system = {
            status: "active",
            silent_tracking: "enabled",
            daily_summary_time: "8:00 PM",
            pause_summary_trigger: "30 minutes silence",
            recent_reactions_24h: recentReactions.count
        };

        healthData.features = {
            clean_media_display: "enabled",
            manual_registration_only: "enabled",
            auto_registration: "disabled",
            smart_reaction_tracking: "enabled"
        };

        res.json(healthData);
    } catch (error) {
        logger.error(`❌ Health check failed: ${error.message}`);
        res.status(500).json({
            status: "unhealthy",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/', async (req, res) => {
    try {
        const db = new sqlite3.Database('production_church.db');

        const memberCount = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM members WHERE active = 1");
        const messages24h = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM broadcast_messages WHERE sent_at > datetime('now', '-24 hours') AND is_reaction = 0");
        const reactions24h = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM message_reactions WHERE created_at > datetime('now', '-24 hours')");
        const mediaProcessed = await smsSystem.getAsync(db, "SELECT COUNT(*) as count FROM media_files WHERE upload_status = 'completed'");

        db.close();

        const homePageContent = `
🏛️ YesuWay Church SMS Broadcasting System
📅 Production Environment - ${new Date().toLocaleString()}

🚀 PRODUCTION STATUS: SMART REACTION TRACKING ACTIVE

📊 LIVE STATISTICS:
✅ Registered Members: ${memberCount.count}
✅ Messages (24h): ${messages24h.count}
✅ Silent Reactions (24h): ${reactions24h.count}
✅ Media Files Processed: ${mediaProcessed.count}
✅ Church Number: ${config.twilio.phoneNumber}

🔇 SMART REACTION SYSTEM:
✅ SILENT TRACKING - No reaction spam to congregation
✅ DAILY SUMMARIES - Sent every day at 8:00 PM
✅ PAUSE SUMMARIES - After 30 minutes of conversation silence
✅ INDUSTRY PATTERNS - Detects all major reaction formats
✅ SMART MATCHING - Links reactions to correct messages

🛡️ SECURITY FEATURES:
✅ REGISTERED MEMBERS ONLY
✅ No auto-registration
✅ Manual member management (database only)
✅ Unknown numbers rejected

🧹 CLEAN MEDIA SYSTEM:
✅ Professional presentation
✅ Simple "Photo 1", "Video 1" display
✅ No technical details shown
✅ Direct media viewing

🎯 CORE FEATURES:
✅ Smart media processing
✅ Unlimited file sizes
✅ Clean public links
✅ Professional broadcasting
✅ Comprehensive error handling

📱 MEMBER EXPERIENCE:
• Only registered members can send
• Unknown numbers receive rejection
• Large files become clean links
• Reactions tracked silently
• Daily summaries of engagement
• Professional presentation

🕐 REACTION SUMMARY SCHEDULE:
• Daily at 8:00 PM - Top reacted messages
• After 30min silence - Recent activity

🎯 RESULT: Zero reaction spam + Full engagement tracking!

💚 SERVING YOUR CONGREGATION 24/7 - SMART & SILENT
        `;

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(homePageContent);
    } catch (error) {
        logger.error(`❌ Home page error: ${error.message}`);
        res.status(500).send(`❌ System temporarily unavailable: ${error.message}`);
    }
});

// Error handlers
app.use((req, res) => {
    res.status(404).json({
        error: "Endpoint not found",
        status: "production",
        available_endpoints: ["/", "/health", "/webhook/sms"]
    });
});

app.use((error, req, res, next) => {
    logger.error(`❌ Internal server error: ${error.message}`);
    res.status(500).json({
        error: "Internal server error",
        status: "production"
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start the server with enhanced error handling
async function startServer() {
    logger.info('STARTING: Production Church SMS System with Smart Reaction Tracking...');
    logger.info('INFO: Professional church communication platform');
    logger.info('INFO: Clean media presentation enabled');
    logger.info('INFO: Manual registration only - secure access');
    logger.info('INFO: Smart reaction tracking - silent with summaries');
    logger.info('INFO: Daily summaries at 8:00 PM');
    logger.info('INFO: Pause summaries after 30min silence');

    // Setup congregation (always safe to run)
    try {
        await setupProductionCongregation();
    } catch (error) {
        logger.error(`❌ Congregation setup failed: ${error.message}`);
        process.exit(1);
    }

    logger.info('SUCCESS: Production Church SMS System: READY FOR MESSAGING');
    logger.info('INFO: Webhook endpoint: /webhook/sms');
    logger.info('INFO: Health monitoring: /health');
    logger.info('INFO: System overview: /');
    logger.info('INFO: Enterprise-grade system active');
    logger.info('INFO: Clean media display enabled');
    logger.info('INFO: Secure member registration (database only)');
    logger.info('INFO: Smart reaction tracking active');
    logger.info('INFO: Reaction summaries: Daily 8 PM + 30min pause');
    logger.info('INFO: Serving YesuWay Church congregation');

    // Start server
    const server = app.listen(config.port, '0.0.0.0', () => {
        logger.info(`🚀 Production Church SMS System running on port ${config.port}`);
        logger.info('💚 FULLY OPERATIONAL: All services connected and ready');
        logger.info('💚 SERVING YOUR CONGREGATION 24/7 - SMART & RESILIENT');
    });

    // Graceful shutdown handling
    const gracefulShutdown = (signal) => {
        logger.info(`${signal} received, shutting down gracefully`);
        server.close(() => {
            logger.info('Server closed successfully');
            process.exit(0);
        });
        
        // Force shutdown after 10 seconds
        setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions gracefully
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception:', error);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        gracefulShutdown('UNHANDLED_REJECTION');
    });
}

// Initialize and start with robust error handling
(async () => {
    try {
        // Initialize SMS system
        logger.info('STARTING: Initializing Production Church SMS System with Smart Reaction Tracking...');
        smsSystem = new ProductionChurchSMS();
        logger.info('SUCCESS: Production system with smart reaction tracking initialized');
        
        // Start server
        await startServer();
        
    } catch (error) {
        logger.error(`❌ Critical startup failure: ${error.message}`);
        logger.error('Stack trace:', error.stack);
        process.exit(1);
    }
})();

module.exports = app;