const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const twilio = require('twilio');
const AWS = require('aws-sdk');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const morgan = require('morgan');
const schedule = require('node-schedule'); 
const crypto = require('crypto');


// MongoDB imports
const MongoDBManager = require('./database');
// UPDATE this import line

const {
    Group,
    Member,
    BroadcastMessage,
    MediaFile,
    DeliveryLog,
    SystemAnalytics,
    PerformanceMetrics,
    MessageReaction
} = require('./models');

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

// Enhanced configuration with better defaults and validation
require('dotenv').config({ silent: true });

// Production Configuration with robust defaults
const config = {
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || 'not_configured',
        authToken: process.env.TWILIO_AUTH_TOKEN || 'not_configured',
        phoneNumber: process.env.TWILIO_PHONE_NUMBER || '+15551234567'
    },
    r2: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || 'not_configured',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'not_configured',
        endpointUrl: process.env.R2_ENDPOINT_URL || 'https://not-configured.example.com',
        bucketName: process.env.R2_BUCKET_NAME || 'church-media-production',
        publicUrl: process.env.R2_PUBLIC_URL || 'https://not-configured.example.com'
    },
    mongodb: {
        uri: process.env.MONGODB_URI,
        host: process.env.MONGODB_HOST || 'localhost',
        port: process.env.MONGODB_PORT || '27017',
        database: process.env.MONGODB_DATABASE || 'yesuway_church',
        username: process.env.MONGODB_USERNAME,
        password: process.env.MONGODB_PASSWORD,
        authSource: process.env.MONGODB_AUTH_SOURCE || 'admin'
    },
    development: process.env.DEVELOPMENT_MODE?.toLowerCase() === 'true' || process.env.NODE_ENV === 'development' || false,
    port: parseInt(process.env.PORT) || 5000,
    environment: process.env.NODE_ENV || 'development'
};

// Log startup configuration (without sensitive data)
logger.info('🚀 STARTUP CONFIGURATION:');
logger.info(`   Environment: ${config.environment}`);
logger.info(`   Development Mode: ${config.development}`);
logger.info(`   Port: ${config.port}`);
logger.info(`   Twilio Phone: ${config.twilio.phoneNumber}`);
logger.info(`   R2 Bucket: ${config.r2.bucketName}`);
logger.info(`   MongoDB Database: ${config.mongodb.database}`);
logger.info(`   Twilio Configured: ${config.twilio.accountSid !== 'not_configured' && config.twilio.accountSid.startsWith('AC')}`);
logger.info(`   R2 Configured: ${config.r2.accessKeyId !== 'not_configured' && config.r2.endpointUrl.startsWith('https://')}`);
logger.info(`   MongoDB Configured: ${config.mongodb.uri !== undefined || config.mongodb.host !== 'localhost'}`);

// Initialize Express app with production middleware
const app = express();


// Security and performance middleware
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));



// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: 'Too many requests from this IP'
});
app.use(limiter);

// Request logging
app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
}));


// 🔥 FIXED REACTION SYSTEM - Replace the WhatsAppStyleReactionSystem class in app.js

class WhatsAppStyleReactionSystem {
    constructor(smsSystem, logger) {
        this.smsSystem = smsSystem;
        this.logger = logger;
        
        // 🔥 PRODUCTION-TESTED REACTION PATTERNS - Updated for real-world usage
        this.reactionPatterns = {
            // iPhone patterns (iOS 15+) - FIXED
            iphone: [
                /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned)\s+"(.+)"$/i,
                /^(❤️|👍|👎|😂|‼️|❓)\s+"(.+)"$/,
                /^Reacted\s+(❤️|👍|👎|😂|‼️|❓)\s+to\s+"(.+)"$/i,
                // NEW: Handle sender format "Loved "MIKE: Test""
                /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned)\s+"([^:]+):\s*(.+)"$/i
            ],
            
            // Android patterns (RCS/SMS) - FIXED
            android: [
                /^Reacted\s+(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s+to\s+"(.+)"$/i,
                /^(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s+"(.+)"$/,
                /^Reaction:\s+(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s+-\s+"(.+)"$/i,
                /^(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s+to\s+"(.+)"$/i
            ],
            
            // Generic/fallback patterns - ENHANCED
            generic: [
                // Your specific format: ❤️ to "MIKE: Test"
                /^(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s+to\s+"([^:]+):\s*(.+)"$/i,
                // Standard format: ❤️ to "message"
                /^(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s+to\s+"(.+)"$/i,
                // Direct format: ❤️ "message"
                /^(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s+"(.+)"$/,
                // Simple format without quotes: ❤️ message
                /^(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s+(.+)$/,
                // Reaction with "to": love to "message"
                /^(love|like|laugh|wow|sad|angry|pray|praise|amen)\s+to\s+"(.+)"$/i,
                // Simple reaction: love "message"
                /^(love|like|laugh|wow|sad|angry|pray|praise|amen)\s+"(.+)"$/i,
                // Other formats
                /^Reacted\s+(.+)\s+to\s+"(.+)"$/i,
                /^(.+)\s+reaction:\s+"(.+)"$/i
            ]
        };

        // Enhanced emoji mapping
        this.emojiMap = {
            '❤️': { type: 'love', name: 'Love', emoji: '❤️' },
            '😍': { type: 'love', name: 'Love', emoji: '❤️' },
            '💕': { type: 'love', name: 'Love', emoji: '❤️' },
            '😂': { type: 'laugh', name: 'Laugh', emoji: '😂' },
            '🤣': { type: 'laugh', name: 'Laugh', emoji: '😂' },
            '😄': { type: 'laugh', name: 'Laugh', emoji: '😂' },
            '👍': { type: 'like', name: 'Like', emoji: '👍' },
            '👍🏻': { type: 'like', name: 'Like', emoji: '👍' },
            '👍🏼': { type: 'like', name: 'Like', emoji: '👍' },
            '👍🏽': { type: 'like', name: 'Like', emoji: '👍' },
            '👍🏾': { type: 'like', name: 'Like', emoji: '👍' },
            '👍🏿': { type: 'like', name: 'Like', emoji: '👍' },
            '👎': { type: 'dislike', name: 'Dislike', emoji: '👎' },
            '😮': { type: 'surprise', name: 'Wow', emoji: '😮' },
            '😯': { type: 'surprise', name: 'Wow', emoji: '😮' },
            '😲': { type: 'surprise', name: 'Wow', emoji: '😮' },
            '😢': { type: 'sad', name: 'Sad', emoji: '😢' },
            '😭': { type: 'sad', name: 'Sad', emoji: '😢' },
            '😰': { type: 'sad', name: 'Sad', emoji: '😢' },
            '😠': { type: 'angry', name: 'Angry', emoji: '😠' },
            '😡': { type: 'angry', name: 'Angry', emoji: '😠' },
            '🤬': { type: 'angry', name: 'Angry', emoji: '😠' },
            '🙏': { type: 'pray', name: 'Pray', emoji: '🙏' },
            '🙏🏻': { type: 'pray', name: 'Pray', emoji: '🙏' },
            '🙏🏼': { type: 'pray', name: 'Pray', emoji: '🙏' },
            '🙏🏽': { type: 'pray', name: 'Pray', emoji: '🙏' },
            '🙏🏾': { type: 'pray', name: 'Pray', emoji: '🙏' },
            '🙏🏿': { type: 'pray', name: 'Pray', emoji: '🙏' },
            '✨': { type: 'praise', name: 'Praise', emoji: '✨' },
            '🌟': { type: 'praise', name: 'Praise', emoji: '✨' },
            '⭐': { type: 'praise', name: 'Praise', emoji: '✨' },
            '💯': { type: 'amen', name: 'Amen', emoji: '💯' },
            '‼️': { type: 'emphasis', name: 'Emphasis', emoji: '‼️' },
            '❗': { type: 'emphasis', name: 'Emphasis', emoji: '‼️' },
            '❓': { type: 'question', name: 'Question', emoji: '❓' },
            '❔': { type: 'question', name: 'Question', emoji: '❓' }
        };

        // Enhanced text reaction keywords
        this.textReactionMap = {
            'loved': { type: 'love', emoji: '❤️' },
            'liked': { type: 'like', emoji: '👍' },
            'disliked': { type: 'dislike', emoji: '👎' },
            'laughed at': { type: 'laugh', emoji: '😂' },
            'laugh': { type: 'laugh', emoji: '😂' },
            'emphasized': { type: 'praise', emoji: '✨' },
            'questioned': { type: 'question', emoji: '❓' },
            'amen': { type: 'amen', emoji: '💯' },
            'praise': { type: 'praise', emoji: '✨' },
            'pray': { type: 'pray', emoji: '🙏' },
            'love': { type: 'love', emoji: '❤️' },
            'like': { type: 'like', emoji: '👍' },
            'wow': { type: 'surprise', emoji: '😮' },
            'sad': { type: 'sad', emoji: '😢' },
            'angry': { type: 'angry', emoji: '😠' }
        };

        // Initialize scheduler
        try {
            this.setupReactionScheduler();
            this.logger.info('✅ WhatsApp-style reaction system initialized successfully');
        } catch (schedulerError) {
            this.logger.error(`❌ Scheduler setup failed: ${schedulerError.message}`);
            this.logger.warn('⚠️ Continuing without automated scheduling');
        }
    }

    // 🔥 ENHANCED REACTION DETECTION
    async detectReaction(messageText, senderPhone) {
        const startTime = Date.now();
        
        try {
            this.logger.info(`🔍 ENHANCED: Analyzing reaction from ${senderPhone}: "${messageText}"`);

            // Clean the message text
            const cleanText = messageText.trim();
            
            // Try each device type pattern
            for (const deviceType of ['generic', 'iphone', 'android']) {
                const patterns = this.reactionPatterns[deviceType];
                
                this.logger.info(`🔧 Testing ${deviceType} patterns (${patterns.length} patterns)`);
                
                for (let i = 0; i < patterns.length; i++) {
                    const pattern = patterns[i];
                    this.logger.info(`🔧 Pattern ${i + 1}: ${pattern}`);
                    
                    const match = cleanText.match(pattern);
                    
                    if (match) {
                        this.logger.info(`✅ PATTERN MATCH! Device: ${deviceType}, Pattern: ${i + 1}`);
                        this.logger.info(`✅ Match groups: ${JSON.stringify(match)}`);
                        
                        const reaction = await this.processReactionMatch(
                            match, deviceType, messageText, senderPhone
                        );
                        
                        if (reaction) {
                            const durationMs = Date.now() - startTime;
                            await this.smsSystem.recordPerformanceMetric(
                                'reaction_detection', durationMs, true
                            );
                            
                            this.logger.info(`🎉 REACTION SUCCESSFULLY DETECTED AND PROCESSED!`);
                            return reaction;
                        } else {
                            this.logger.warn(`⚠️ Pattern matched but reaction processing failed`);
                        }
                    }
                }
            }

            // No reaction pattern matched
            this.logger.info(`ℹ️ No reaction pattern detected in: "${messageText}"`);
            return null;

        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.smsSystem.recordPerformanceMetric(
                'reaction_detection', durationMs, false, error.message
            );
            
            this.logger.error(`❌ Reaction detection error: ${error.message}`);
            this.logger.error(`❌ Stack trace: ${error.stack}`);
            return null;
        }
    }

    // 🔥 ENHANCED REACTION PROCESSING
    async processReactionMatch(match, deviceType, originalText, senderPhone) {
        try {
            let reactionIdentifier, messageQuote;

            this.logger.info(`🔧 Processing reaction match: Device=${deviceType}, Match=${JSON.stringify(match)}`);

            // Extract reaction and message based on device pattern
            if (deviceType === 'iphone') {
                reactionIdentifier = match[1];
                
                // Handle iPhone sender format "Loved "MIKE: Test""
                if (match[3]) {
                    // Pattern matched iPhone reaction with sender: "Loved "MIKE: Test""
                    messageQuote = match[3]; // Just the message part
                    this.logger.info(`🔧 iPhone: Extracted message from sender format: "${messageQuote}"`);
                } else {
                    messageQuote = match[2];
                }
            } else if (deviceType === 'android') {
                reactionIdentifier = match[1];
                messageQuote = match[2];
            } else { // generic
                reactionIdentifier = match[1];
                
                // Handle three-group match for "SENDER: message" format
                if (match[3]) {
                    messageQuote = match[3]; // Just the message part
                    this.logger.info(`🔧 Generic: Extracted message from sender format: "${messageQuote}"`);
                } else {
                    messageQuote = match[2];
                }
            }

            if (!messageQuote || messageQuote.trim() === '') {
                this.logger.warn(`⚠️ No message quote found in reaction: ${originalText}`);
                return null;
            }

            // Clean the message quote
            messageQuote = messageQuote.trim();

            // Determine reaction type and emoji
            const reactionInfo = this.parseReactionType(reactionIdentifier);
            if (!reactionInfo) {
                this.logger.warn(`⚠️ Unknown reaction type: ${reactionIdentifier}`);
                return null;
            }

            // Find the original message this reaction refers to
            const originalMessage = await this.findOriginalMessage(messageQuote);
            if (!originalMessage) {
                this.logger.warn(`⚠️ Could not find original message for quote: "${messageQuote}"`);
                return null;
            }

            // Get reactor information
            const reactor = await this.smsSystem.getMemberInfo(senderPhone);
            if (!reactor) {
                this.logger.warn(`⚠️ Reactor not found: ${senderPhone}`);
                return null;
            }

            this.logger.info(`✅ Reaction detected: ${reactor.name} ${reactionInfo.emoji} → "${messageQuote.substring(0, 50)}..."`);

            return {
                originalMessage,
                messageQuote,
                reactionInfo,
                reactor,
                deviceType,
                originalText,
                confidence: originalMessage.confidence
            };

        } catch (error) {
            this.logger.error(`❌ Error processing reaction match: ${error.message}`);
            return null;
        }
    }

    // 🔥 ENHANCED MESSAGE MATCHING
    async findOriginalMessage(messageQuote) {
        try {
            // Clean the quote for better matching
            let cleanQuote = this.cleanMessageForMatching(messageQuote);
            
            // Handle sender name format "MIKE: Test" -> "Test"
            if (cleanQuote.includes(':')) {
                const parts = cleanQuote.split(':');
                if (parts.length >= 2) {
                    // Try both full quote and just the message part
                    const messageOnly = parts.slice(1).join(':').trim();
                    
                    this.logger.info(`🔧 Detected sender format. Full: "${cleanQuote}", Message only: "${messageOnly}"`);
                    
                    // Try to match the message part first
                    const messageOnlyResult = await this.findOriginalMessageByContent(messageOnly);
                    if (messageOnlyResult) {
                        return messageOnlyResult;
                    }
                }
            }
            
            // Fall back to original matching
            return await this.findOriginalMessageByContent(cleanQuote);
            
        } catch (error) {
            this.logger.error(`❌ Error finding original message: ${error.message}`);
            return null;
        }
    }

    async findOriginalMessageByContent(cleanQuote) {
        try {
            const quoteHash = this.generateMessageHash(cleanQuote);

            this.logger.info(`🔍 Searching for original message: "${cleanQuote}" (hash: ${quoteHash.substring(0, 8)}...)`);

            // Get recent messages (last 7 days)
            const recentMessages = await this.smsSystem.dbManager.getRecentMessages(7 * 24);
            
            if (recentMessages.length === 0) {
                this.logger.warn('⚠️ No recent messages found for reaction matching');
                return null;
            }

            // Try exact hash match first (fastest)
            for (const message of recentMessages) {
                const messageHash = this.generateMessageHash(
                    this.cleanMessageForMatching(message.originalMessage)
                );
                
                if (messageHash === quoteHash) {
                    this.logger.info(`✅ Exact hash match found for message: ${message._id}`);
                    return {
                        message,
                        matchType: 'exact_match',
                        confidence: 1.0
                    };
                }
            }

            // Try fuzzy matching with similarity scoring
            let bestMatch = null;
            let bestScore = 0;

            for (const message of recentMessages) {
                const cleanMessage = this.cleanMessageForMatching(message.originalMessage);
                const similarity = this.calculateSimilarity(cleanQuote, cleanMessage);
                
                // Lower threshold for better matching (60% instead of 70%)
                if (similarity > 0.6 && similarity > bestScore) {
                    bestScore = similarity;
                    bestMatch = {
                        message,
                        matchType: 'fuzzy_match',
                        confidence: similarity
                    };
                }
            }

            if (bestMatch) {
                this.logger.info(`✅ Fuzzy match found with ${(bestMatch.confidence * 100).toFixed(1)}% confidence`);
                return bestMatch;
            }

            // Try keyword matching for very short quotes
            if (cleanQuote.length < 50) {
                const keywords = cleanQuote.split(' ').filter(word => word.length > 2);
                
                for (const message of recentMessages) {
                    const cleanMessage = this.cleanMessageForMatching(message.originalMessage);
                    const keywordMatches = keywords.filter(keyword => 
                        cleanMessage.toLowerCase().includes(keyword.toLowerCase())
                    );
                    
                    if (keywordMatches.length >= Math.min(keywords.length, 2) && keywords.length > 0) {
                        this.logger.info(`✅ Keyword match found: ${keywordMatches.join(', ')}`);
                        return {
                            message,
                            matchType: 'keyword_match',
                            confidence: 0.6
                        };
                    }
                }
            }

            this.logger.warn(`⚠️ No matching message found for: "${cleanQuote}"`);
            return null;

        } catch (error) {
            this.logger.error(`❌ Error in message matching: ${error.message}`);
            return null;
        }
    }

    // Rest of the methods remain the same...
    cleanMessageForMatching(message) {
        return message
            .replace(/[\n\r\t]/g, ' ')  
            .replace(/\s+/g, ' ')       
            .replace(/['"'""`]/g, '"')  
            .replace(/[^\w\s".,!?-]/g, '') 
            .toLowerCase()
            .trim();
    }

    generateMessageHash(message) {
        return crypto.createHash('sha256').update(message).digest('hex');
    }

    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    parseReactionType(identifier) {
        // Check if it's an emoji
        if (this.emojiMap[identifier]) {
            return {
                type: this.emojiMap[identifier].type,
                emoji: this.emojiMap[identifier].emoji,
                name: this.emojiMap[identifier].name
            };
        }

        // Check if it's a text reaction
        const lowerIdentifier = identifier.toLowerCase();
        if (this.textReactionMap[lowerIdentifier]) {
            const reactionData = this.textReactionMap[lowerIdentifier];
            return {
                type: reactionData.type,
                emoji: reactionData.emoji,
                name: lowerIdentifier
            };
        }

        // Try to find emoji within the text
        for (const [emoji, data] of Object.entries(this.emojiMap)) {
            if (identifier.includes(emoji)) {
                return {
                    type: data.type,
                    emoji: data.emoji,
                    name: data.name
                };
            }
        }

        return null;
    }

    // 🔥 ENHANCED REACTION STORAGE
    async storeReaction(reactionData) {
        try {
            const {
                originalMessage,
                messageQuote,
                reactionInfo,
                reactor,
                deviceType,
                originalText,
                confidence
            } = reactionData;

            // Extract phone number with maximum tolerance
            let reactorPhone = 'unknown';
            
            if (reactor.phoneNumber) {
                reactorPhone = reactor.phoneNumber;
            } else if (reactor.phone) {
                reactorPhone = reactor.phone;
            } else if (typeof reactor === 'string') {
                reactorPhone = reactor;
            } else {
                // Last resort: extract from any field that looks like a phone
                for (const [key, value] of Object.entries(reactor)) {
                    if (typeof value === 'string' && (value.startsWith('+') || /^\d{10,}$/.test(value))) {
                        reactorPhone = value;
                        break;
                    }
                }
            }

            // Clean the phone number
            if (reactorPhone !== 'unknown') {
                reactorPhone = this.smsSystem.cleanPhoneNumber(reactorPhone);
            }

            // Check for duplicate reactions
            try {
                const existingReaction = await MessageReaction.findOne({
                    originalMessageId: originalMessage.message._id,
                    reactorPhone: reactorPhone,
                    reactionType: reactionInfo.type
                });

                if (existingReaction) {
                    this.logger.info(`ℹ️ Duplicate reaction ignored: ${reactor.name} already ${reactionInfo.name}d this message`);
                    return null;
                }
            } catch (duplicateError) {
                this.logger.warn(`⚠️ Could not check for duplicates: ${duplicateError.message}`);
            }

            // Create reaction record
            const reactionDoc = {
                originalMessageId: originalMessage.message._id,
                originalMessageText: originalMessage.message.originalMessage || 'unknown',
                originalMessageHash: this.generateMessageHash(
                    this.cleanMessageForMatching(originalMessage.message.originalMessage || 'unknown')
                ),
                reactorPhone: reactorPhone,
                reactorName: reactor.name || 'Unknown',
                reactionType: reactionInfo.type,
                reactionEmoji: reactionInfo.emoji,
                originalReactionText: originalText,
                deviceType: deviceType || 'generic',
                processingMethod: originalMessage.matchType || 'unknown',
                confidence: confidence || 1.0,
                isProcessed: false,
                includedInSummary: false
            };

            const reaction = new MessageReaction(reactionDoc);
            await reaction.save();

            this.logger.info(`✅ REACTION STORED: ${reactor.name} ${reactionInfo.emoji} → Message ${originalMessage.message._id}`);

            // Record analytics
            try {
                await this.smsSystem.dbManager.recordAnalytic(
                    'reaction_received',
                    1,
                    `${reactionInfo.type} by ${reactor.name} (${deviceType}, ${originalMessage.matchType}, ${(confidence * 100).toFixed(1)}% confidence)`
                );
            } catch (analyticsError) {
                this.logger.warn(`⚠️ Could not record analytics: ${analyticsError.message}`);
            }

            return reaction;

        } catch (error) {
            this.logger.error(`❌ REACTION STORAGE ERROR: ${error.message}`);
            this.logger.error(`❌ FULL ERROR DETAILS: ${JSON.stringify(error)}`);
            throw error;
        }
    }

    // 🔥 ENHANCED REACTION SUMMARY GENERATION
    async generateReactionSummary() {
        try {
            this.logger.info('📊 Generating enhanced reaction summary...');

            // Get unprocessed reactions
            const unprocessedReactions = await MessageReaction.find({
                isProcessed: false
            }).populate('originalMessageId', 'originalMessage fromName sentAt');

            if (unprocessedReactions.length === 0) {
                this.logger.info('ℹ️ No new reactions to summarize');
                return null;
            }

            this.logger.info(`📊 Found ${unprocessedReactions.length} unprocessed reactions`);

            // Group reactions by original message
            const messageReactions = {};
            
            for (const reaction of unprocessedReactions) {
                if (!reaction.originalMessageId) {
                    this.logger.warn(`⚠️ Skipping reaction without original message: ${reaction._id}`);
                    continue;
                }

                const messageId = reaction.originalMessageId._id.toString();
                
                if (!messageReactions[messageId]) {
                    messageReactions[messageId] = {
                        message: reaction.originalMessageId,
                        reactions: {}
                    };
                }
                
                if (!messageReactions[messageId].reactions[reaction.reactionType]) {
                    messageReactions[messageId].reactions[reaction.reactionType] = {
                        emoji: reaction.reactionEmoji,
                        count: 0,
                        reactors: []
                    };
                }
                
                messageReactions[messageId].reactions[reaction.reactionType].count++;
                messageReactions[messageId].reactions[reaction.reactionType].reactors.push(reaction.reactorName);
            }

            // Generate summary message
            const summary = this.formatReactionSummary(messageReactions);
            
            if (summary) {
                // Mark reactions as processed
                await MessageReaction.updateMany(
                    { _id: { $in: unprocessedReactions.map(r => r._id) } },
                    { isProcessed: true, includedInSummary: true }
                );

                this.logger.info(`📊 Marked ${unprocessedReactions.length} reactions as processed`);

                // Send summary to all members
                await this.broadcastReactionSummary(summary);

                this.logger.info(`✅ Reaction summary generated and sent (${unprocessedReactions.length} reactions processed)`);
                return summary;
            }

            return null;

        } catch (error) {
            this.logger.error(`❌ Error generating reaction summary: ${error.message}`);
            throw error;
        }
    }

    formatReactionSummary(messageReactions) {
        if (Object.keys(messageReactions).length === 0) {
            return null;
        }

        let summary = '📊 REACTION SUMMARY\n';
        summary += '═══════════════════════\n\n';

        for (const [messageId, data] of Object.entries(messageReactions)) {
            const message = data.message;
            const reactions = data.reactions;
            
            // Message preview (first 60 characters)
            const messagePreview = message.originalMessage.length > 60 
                ? message.originalMessage.substring(0, 60) + '...'
                : message.originalMessage;
            
            summary += `💬 "${messagePreview}"\n`;
            summary += `   - ${message.fromName}\n\n`;

            // Reaction counts
            const reactionTypes = Object.keys(reactions);
            const reactionSummaries = reactionTypes.map(type => {
                const reactionData = reactions[type];
                const count = reactionData.count;
                const emoji = reactionData.emoji;
                
                if (count === 1) {
                    return `${emoji} ${reactionData.reactors[0]}`;
                } else if (count === 2) {
                    return `${emoji} ${reactionData.reactors.join(' & ')}`;
                } else {
                    return `${emoji} ${count} people`;
                }
            });

            summary += `   ${reactionSummaries.join('\n   ')}\n\n`;
        }

        summary += '━━━━━━━━━━━━━━━━━━━━━━━\n';
        summary += 'YesuWay Church • Reactions';

        return summary;
    }

    async broadcastReactionSummary(summary) {
        try {
            // Get all active members
            const recipients = await this.smsSystem.getAllActiveMembers();
            
            if (recipients.length === 0) {
                this.logger.warn('⚠️ No recipients found for reaction summary');
                return;
            }

            this.logger.info(`📤 Broadcasting reaction summary to ${recipients.length} members...`);

            // Send to all members
            const deliveryStats = { sent: 0, failed: 0 };
            
            const sendPromises = recipients.map(async (member) => {
                try {
                    const result = await this.smsSystem.sendSMS(member.phone, summary);
                    
                    if (result.success) {
                        deliveryStats.sent++;
                        this.logger.info(`✅ Reaction summary sent to ${member.name}`);
                    } else {
                        deliveryStats.failed++;
                        this.logger.error(`❌ Failed to send reaction summary to ${member.name}: ${result.error}`);
                    }
                } catch (error) {
                    deliveryStats.failed++;
                    this.logger.error(`❌ Error sending reaction summary to ${member.name}: ${error.message}`);
                }
            });

            await Promise.allSettled(sendPromises);

            this.logger.info(`📊 Reaction summary broadcast completed: ${deliveryStats.sent} sent, ${deliveryStats.failed} failed`);

        } catch (error) {
            this.logger.error(`❌ Error broadcasting reaction summary: ${error.message}`);
            throw error;
        }
    }

    // 🔥 ENHANCED SCHEDULING
    setupReactionScheduler() {
        try {
            if (!schedule) {
                this.logger.warn('⚠️ node-schedule not available - skipping automated scheduling');
                return;
            }

            // Daily summary at 8 PM
            schedule.scheduleJob('0 20 * * *', async () => {
                this.logger.info('⏰ Daily reaction summary triggered (8 PM)');
                try {
                    await this.generateReactionSummary();
                } catch (error) {
                    this.logger.error(`❌ Daily reaction summary failed: ${error.message}`);
                }
            });

            // Periodic check every 15 minutes for active conversations
            schedule.scheduleJob('*/15 * * * *', async () => {
                try {
                    await this.checkForPeriodicSummary();
                } catch (error) {
                    this.logger.error(`❌ Periodic reaction check failed: ${error.message}`);
                }
            });

            this.logger.info('✅ Enhanced reaction scheduler configured successfully');

        } catch (error) {
            this.logger.error(`❌ Failed to setup reaction scheduler: ${error.message}`);
            this.logger.warn('⚠️ Automated summaries will not work - manual generation available via admin commands');
        }
    }

    async checkForPeriodicSummary() {
        try {
            // Check if there's been conversation silence for 20+ minutes
            const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
            
            const recentMessages = await this.smsSystem.dbManager.getRecentMessages(1);
            const lastMessage = recentMessages[0];
            
            if (lastMessage && lastMessage.sentAt < twentyMinutesAgo) {
                // Check for unprocessed reactions
                const unprocessedCount = await MessageReaction.countDocuments({
                    isProcessed: false
                });
                
                if (unprocessedCount >= 3) { // Lower threshold for more frequent summaries
                    this.logger.info(`⏰ Conversation silence detected with ${unprocessedCount} pending reactions - generating summary`);
                    await this.generateReactionSummary();
                } else {
                    this.logger.info(`ℹ️ Only ${unprocessedCount} pending reactions - waiting for more activity`);
                }
            } else {
                const unprocessedCount = await MessageReaction.countDocuments({
                    isProcessed: false
                });
                if (unprocessedCount > 0) {
                    this.logger.info(`ℹ️ ${unprocessedCount} pending reactions, but conversation is still active`);
                }
            }
        } catch (error) {
            this.logger.error(`❌ Error checking for periodic summary: ${error.message}`);
        }
    }

    // 🔥 ENHANCED ANALYTICS
    async getReactionAnalytics(days = 7) {
        try {
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            
            const pipeline = [
                { $match: { createdAt: { $gte: since } } },
                {
                    $group: {
                        _id: {
                            reactionType: '$reactionType',
                            deviceType: '$deviceType'
                        },
                        count: { $sum: 1 },
                        reactors: { $addToSet: '$reactorName' }
                    }
                }
            ];

            const results = await MessageReaction.aggregate(pipeline);
            
            return {
                totalReactions: results.reduce((sum, r) => sum + r.count, 0),
                byType: results.reduce((acc, r) => {
                    acc[r._id.reactionType] = (acc[r._id.reactionType] || 0) + r.count;
                    return acc;
                }, {}),
                byDevice: results.reduce((acc, r) => {
                    acc[r._id.deviceType] = (acc[r._id.deviceType] || 0) + r.count;
                    return acc;
                }, {}),
                uniqueReactors: new Set(results.flatMap(r => r.reactors)).size
            };
        } catch (error) {
            this.logger.error(`❌ Error getting reaction analytics: ${error.message}`);
            return null;
        }
    }

    // 🔥 MANUAL SUMMARY TRIGGER FOR TESTING
    async forceSummaryGeneration() {
        this.logger.info('🔧 MANUAL: Force generating reaction summary...');
        try {
            const summary = await this.generateReactionSummary();
            if (summary) {
                this.logger.info('✅ MANUAL: Summary generated successfully');
                return summary;
            } else {
                this.logger.info('ℹ️ MANUAL: No reactions to summarize');
                return null;
            }
        } catch (error) {
            this.logger.error(`❌ MANUAL: Force summary failed: ${error.message}`);
            throw error;
        }
    }
}

class ProductionChurchSMS {
    constructor() {
        this.twilioClient = null;
        this.r2Client = null;
        this.dbManager = new MongoDBManager(logger);
        this.performanceMetrics = [];
        this.reactionSystem = new WhatsAppStyleReactionSystem(this, logger);
        
        this.initializeServices();
        this.initializeDatabase();
        
        logger.info('SUCCESS: Production Church SMS System with MongoDB initialized');
        logger.info('✅ WhatsApp-style reaction system integrated');
    }

    buildMongoConnectionString() {
        const {
            uri, host, port, database, username, password, authSource
        } = config.mongodb;

        if (uri && uri !== 'undefined' && !uri.includes('localhost')) {
            logger.info('📋 Using provided MongoDB URI');
            return uri;
        }

        let connectionString = 'mongodb://';
        
        if (username && password && username !== 'undefined' && password !== 'undefined') {
            connectionString += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
        }
        
        connectionString += `${host || 'localhost'}:${port || '27017'}/${database || 'yesuway_church'}`;
        
        if (username && password && username !== 'undefined' && password !== 'undefined') {
            connectionString += `?authSource=${authSource || 'admin'}`;
        }

        logger.info(`📋 Built MongoDB connection string for: ${host || 'localhost'}:${port || '27017'}`);
        return connectionString;
    }

    initializeServices() {

        if (this.isValidTwilioCredentials()) {
            try {
                this.twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
                
                this.twilioClient.api.accounts(config.twilio.accountSid).fetch()
                    .then(account => {
                        logger.info(`SUCCESS: Twilio production connection established: ${account.friendlyName}`);
                    })
                    .catch(error => {
                        logger.error(`ERROR: Twilio connection test failed: ${error.message}`);
                        if (!config.development) {
                            logger.warn('WARNING: Continuing with limited functionality');
                        }
                    });
                
            } catch (error) {
                logger.error(`ERROR: Twilio client initialization failed: ${error.message}`);
                this.twilioClient = null;
                if (!config.development) {
                    logger.warn('WARNING: Twilio unavailable - SMS functionality disabled');
                } else {
                    logger.info('DEVELOPMENT MODE: Continuing with mock Twilio client');
                }
            }
        } else {
            logger.warn('PRODUCTION WARNING: Invalid or missing Twilio credentials');
            logger.info('INFO: SMS functionality will use mock responses');
            logger.info('INFO: Set proper TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER for production');
            this.twilioClient = null;
        }

        if (this.isValidR2Credentials()) {
            try {
                this.r2Client = new AWS.S3({
                    endpoint: config.r2.endpointUrl,
                    accessKeyId: config.r2.accessKeyId,
                    secretAccessKey: config.r2.secretAccessKey,
                    region: 'auto',
                    s3ForcePathStyle: true
                });
                
                this.r2Client.headBucket({ Bucket: config.r2.bucketName }).promise()
                    .then(() => {
                        logger.info(`SUCCESS: Cloudflare R2 production connection established: ${config.r2.bucketName}`);
                    })
                    .catch(error => {
                        logger.error(`ERROR: R2 connection test failed: ${error.message}`);
                        if (!config.development) {
                            logger.warn('WARNING: Continuing with limited media functionality');
                        }
                    });
                
            } catch (error) {
                logger.error(`ERROR: R2 client initialization failed: ${error.message}`);
                this.r2Client = null;
                if (!config.development) {
                    logger.warn('WARNING: R2 unavailable - media storage disabled');
                } else {
                    logger.info('DEVELOPMENT MODE: Continuing with local media storage');
                }
            }
        } else {
            logger.warn('PRODUCTION WARNING: Invalid or missing R2 credentials');
            logger.info('INFO: Media storage will use local fallback');
            logger.info('INFO: Set proper R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL for production');
            this.r2Client = null;
        }

        this.logServiceStatus();

    }

    isValidTwilioCredentials() {
        const { accountSid, authToken, phoneNumber } = config.twilio;
        
        if (!accountSid || !authToken || !phoneNumber) {
            return false;
        }
        
        if (accountSid.includes('your_') || authToken.includes('your_') || phoneNumber.includes('your_')) {
            return false;
        }
        
        if (!accountSid.startsWith('AC') || accountSid.length !== 34) {
            return false;
        }
        
        if (authToken.length < 32) {
            return false;
        }
        
        return true;
    }

    isValidR2Credentials() {
        const { accessKeyId, secretAccessKey, endpointUrl, bucketName } = config.r2;
        
        if (!accessKeyId || !secretAccessKey || !endpointUrl || !bucketName) {
            return false;
        }
        
        if (accessKeyId.includes('your_') || secretAccessKey.includes('your_') || endpointUrl.includes('your_')) {
            return false;
        }
        
        if (!endpointUrl.startsWith('https://')) {
            return false;
        }
        
        return true;
    }

    logServiceStatus() {
        logger.info('🔧 SERVICE STATUS SUMMARY:');
        logger.info(`   📱 Twilio SMS: ${this.twilioClient ? '✅ Connected' : '❌ Unavailable (Mock Mode)'}`);
        logger.info(`   ☁️ R2 Storage: ${this.r2Client ? '✅ Connected' : '❌ Unavailable (Local Mode)'}`);
        logger.info(`   🗄️ MongoDB: ${this.dbManager.isConnected ? '✅ Connected' : '⏳ Connecting...'}`);
        logger.info(`   🛡️ Security: ✅ Production Ready`);
        logger.info(`   🎥 Cloudflare Stream: ${process.env.CLOUDFLARE_STREAM_ENABLED === 'true' ? '✅ Enabled (HD Video Processing)' : '❌ Disabled'}`);
        
        if (!this.twilioClient) {
            logger.warn('⚠️ IMPORTANT: SMS sending disabled - configure Twilio credentials for production');
        }
        
        if (!this.r2Client) {
            logger.warn('⚠️ IMPORTANT: Cloud media storage disabled - configure R2 credentials for production');
        }
        
        if (this.twilioClient && this.r2Client && this.dbManager.isConnected) {
            logger.info('🚀 PRODUCTION READY: All services connected and operational');
        } else {
            logger.info('🛠️ DEVELOPMENT MODE: Some services mocked for local development');
        }
    }

    

    async initializeDatabase() {
        const maxRetries = 5;
        let retryCount = 0;
        
        const connectionString = this.buildMongoConnectionString();
        logger.info(`🔗 Attempting MongoDB connection to: ${connectionString.replace(/\/\/[^:]+:[^@]+@/, '//*****:*****@')}`);
        
        while (retryCount < maxRetries) {
            try {
                if (retryCount > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    logger.info(`🔄 MongoDB connection retry ${retryCount}/${maxRetries}`);
                }
                
                const options = {
                    maxPoolSize: 10,
                    minPoolSize: 5,
                    serverSelectionTimeoutMS: 5000,
                    socketTimeoutMS: 45000,
                    connectTimeoutMS: 10000,
                    retryWrites: true,
                    retryReads: true
                };

                mongoose.set('strictQuery', false);
                mongoose.set('bufferCommands', false);
                
                await mongoose.connect(connectionString, options);
                
                if (this.dbManager) {
                    this.dbManager.isConnected = true;
                    this.dbManager.connectionRetries = 0;
                }
                
                this.setupMongooseEventHandlers();
                
                logger.info('✅ Production MongoDB initialized');
                return;
                
            } catch (error) {
                retryCount++;
                logger.error(`❌ MongoDB connection attempt ${retryCount} failed: ${error.message}`);
                
                if (retryCount >= maxRetries) {
                    logger.error('❌ All MongoDB connection attempts failed');
                    logger.warn('⚠️ Continuing without MongoDB connection');
                    logger.warn('⚠️ Some features may not work until database is connected');
                    
                    if (this.dbManager) {
                        this.dbManager.isConnected = false;
                    }
                    return;
                }
            }
        }
    }

    setupMongooseEventHandlers() {
        mongoose.connection.on('error', (error) => {
            logger.error(`❌ MongoDB connection error: ${error.message}`);
            if (this.dbManager) {
                this.dbManager.isConnected = false;
            }
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('⚠️ MongoDB disconnected');
            if (this.dbManager) {
                this.dbManager.isConnected = false;
            }
        });

        mongoose.connection.on('reconnected', () => {
            logger.info('✅ MongoDB reconnected');
            if (this.dbManager) {
                this.dbManager.isConnected = true;
            }
        });

        mongoose.connection.on('connected', () => {
            logger.info('🔗 MongoDB connected successfully');
            if (this.dbManager) {
                this.dbManager.isConnected = true;
            }
        });
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
            if (this.dbManager.isConnected) {
                await this.dbManager.recordPerformanceMetric(operationType, durationMs, success, errorDetails);
            }
        } catch (error) {
            logger.error(`❌ Performance metric recording failed: ${error.message}`);
        }
    }

    async getMemberInfo(phoneNumber) {
        try {
            phoneNumber = this.cleanPhoneNumber(phoneNumber);
            
            if (!this.dbManager.isConnected) {
                logger.warn('❌ Database not connected - cannot get member info');
                return null;
            }

            const member = await this.dbManager.getMemberByPhone(phoneNumber);

            if (member) {
                return {
                    id: member._id.toString(),
                    name: member.name,
                    isAdmin: Boolean(member.isAdmin),
                    messageCount: member.messageCount,
                    groups: member.groups || []
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

    // 🎥 CLOUDFLARE STREAM INTEGRATION - Add these methods to your ProductionChurchSMS class


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
                    Expires: 31536000
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

        getMediaTypeFromMime(mimeType) {
            if (mimeType.includes('image/')) {
                if (mimeType.includes('gif')) return 'GIF';
                return 'Photo';
            } else if (mimeType.includes('video/')) {
                return 'Video';
            } else if (mimeType.includes('audio/')) {
                return 'Audio';
            } else {
                return 'File';
            }
        }

        generateCleanFilename(mimeType, mediaIndex) {
            const mediaType = this.getMediaTypeFromMime(mimeType);
            const timestamp = Date.now();
            const fileExtension = mime.extension(mimeType) || 'bin';
            
            const cleanFilename = `church/media/${timestamp}_${mediaIndex}.${fileExtension}`;
            const displayName = `${mediaType} ${mediaIndex}`;
            
            return { cleanFilename, displayName };
        }
// FIXED MEDIA PROCESSING METHODS FOR app.js
// Replace the existing processMediaFiles method and related broken methods with this working version

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

            // Download from Twilio
            const mediaData = await this.downloadMediaFromTwilio(mediaUrl);

            if (!mediaData) {
                const errorMsg = `Failed to download media ${i + 1}`;
                processingErrors.push(errorMsg);
                logger.error(errorMsg);
                continue;
            }

            // Generate clean filename and display name
            const { cleanFilename, displayName } = this.generateCleanFilename(mediaData.mimeType, i + 1);

            // Upload to R2 with proper error handling
            let publicUrl = null;
            
            if (this.r2Client) {
                try {
                    publicUrl = await this.uploadToR2(
                        mediaData.content,
                        cleanFilename,
                        mediaData.mimeType,
                        {
                            'original-size': mediaData.size.toString(),
                            'media-index': i.toString(),
                            'display-name': displayName,
                            'church-system': 'yesuway-production'
                        }
                    );
                } catch (r2Error) {
                    logger.error(`❌ R2 upload failed for media ${i + 1}: ${r2Error.message}`);
                    // Continue processing - we'll create a fallback
                }
            }

            // Fallback for development or R2 failure
            if (!publicUrl) {
                if (config.development) {
                    publicUrl = `https://example.com/media/dev_${Date.now()}_${i + 1}`;
                    logger.info(`🛠️ Development mode: Generated mock URL for media ${i + 1}`);
                } else {
                    // Production fallback - try alternative upload or create direct link
                    publicUrl = await this.createFallbackMediaUrl(mediaData, cleanFilename, displayName);
                }
            }

            if (publicUrl) {
                // Store in database
                if (this.dbManager.isConnected) {
                    try {
                        await this.dbManager.createMediaFile({
                            messageId: messageId,
                            originalUrl: mediaUrl,
                            r2ObjectKey: cleanFilename,
                            publicUrl: publicUrl,
                            cleanFilename: cleanFilename.split('/').pop(),
                            displayName: displayName,
                            originalSize: mediaData.size,
                            finalSize: mediaData.content.length,
                            mimeType: mediaData.mimeType,
                            fileHash: mediaData.hash,
                            compressionDetected: false,
                            uploadStatus: 'completed'
                        });
                    } catch (dbError) {
                        logger.warn(`⚠️ Failed to store media file in database: ${dbError.message}`);
                        // Continue anyway - the URL still works
                    }
                }

                processedLinks.push({
                    url: publicUrl,
                    displayName: displayName,
                    type: mediaData.mimeType
                });
                
                logger.info(`✅ Media ${i + 1} processed successfully: ${displayName}`);
            } else {
                const errorMsg = `Failed to create accessible URL for media ${i + 1}`;
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

// NEW METHOD: Fallback media URL creation for when R2 fails
async createFallbackMediaUrl(mediaData, cleanFilename, displayName) {
    try {
        // Option 1: Try to use Twilio's direct URL (temporary but works)
        if (mediaData.originalUrl && mediaData.originalUrl.includes('twilio.com')) {
            logger.info(`📎 Using Twilio direct URL as fallback for ${displayName}`);
            return mediaData.originalUrl;
        }

        // Option 2: Create a base64 data URL for small files (< 1MB)
        if (mediaData.content.length < 1024 * 1024) {
            const base64Content = mediaData.content.toString('base64');
            const dataUrl = `data:${mediaData.mimeType};base64,${base64Content}`;
            logger.info(`📎 Created base64 data URL for small ${displayName}`);
            return dataUrl;
        }

        // Option 3: Store locally and serve via Express (development)
        if (config.development) {
            const localPath = await this.saveMediaLocally(mediaData, cleanFilename);
            if (localPath) {
                const localUrl = `http://localhost:${config.port}/media/${cleanFilename.split('/').pop()}`;
                logger.info(`📎 Created local URL for ${displayName}: ${localUrl}`);
                return localUrl;
            }
        }

        logger.error(`❌ All fallback options failed for ${displayName}`);
        return null;

    } catch (error) {
        logger.error(`❌ Fallback URL creation failed: ${error.message}`);
        return null;
    }
}

// NEW METHOD: Save media locally for development/fallback
async saveMediaLocally(mediaData, cleanFilename) {
    try {
        const fs = require('fs').promises;
        const path = require('path');

        // Create local media directory
        const mediaDir = path.join(process.cwd(), 'temp_media');
        try {
            await fs.mkdir(mediaDir, { recursive: true });
        } catch (mkdirError) {
            // Directory might already exist
        }

        // Save file locally
        const localFilename = cleanFilename.split('/').pop();
        const localPath = path.join(mediaDir, localFilename);
        
        await fs.writeFile(localPath, mediaData.content);
        logger.info(`💾 Saved media locally: ${localPath}`);
        
        return localPath;

    } catch (error) {
        logger.error(`❌ Local media save failed: ${error.message}`);
        return null;
    }
}




    async getAllActiveMembers(excludePhone = null) {
        try {
            if (!this.dbManager.isConnected) {
                logger.warn('❌ Database not connected - cannot get active members');
                return [];
            }

            excludePhone = excludePhone ? this.cleanPhoneNumber(excludePhone) : null;
            const members = await this.dbManager.getAllActiveMembers(excludePhone);

            const cleanMembers = [];
            for (const member of members) {
                const cleanPhone = this.cleanPhoneNumber(member.phoneNumber);
                if (cleanPhone) {
                    cleanMembers.push({
                        id: member._id.toString(),
                        phone: cleanPhone,
                        name: member.name,
                        isAdmin: Boolean(member.isAdmin)
                    });
                }
            }

            logger.info(`📋 Retrieved ${cleanMembers.length} active members`);
            return cleanMembers;
        } catch (error) {
            logger.error(`❌ Error retrieving members: ${error.message}`);
            return [];
        }
    }

    async sendSMS(toPhone, messageText, maxRetries = 3) {
        if (config.development && !this.twilioClient) {
            logger.info(`DEVELOPMENT MODE: Mock SMS to ${toPhone}: ${messageText.substring(0, 50)}...`);
            return {
                success: true,
                sid: `mock_sid_${uuidv4().substring(0, 8)}`,
                attempt: 1
            };
        }

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
            // For media messages, ONLY show the sender name and media links
            if (mediaLinks.length === 1) {
                const mediaItem = mediaLinks[0];
                return `${sender.name}:\n${mediaItem.url}`;
            } else {
                const mediaText = mediaLinks.map(item => item.url).join('\n');
                return `${sender.name}:\n${mediaText}`;
            }
        } else {
            return `${sender.name}:\n${originalMessage}`;
        }
    }

    // FIXED: Simplified broadcast message method
    async broadcastMessage(fromPhone, messageText, mediaUrls = null) {
        const startTime = Date.now();
        logger.info(`📡 Starting broadcast from ${fromPhone}`);

        let messageId = null;

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

            if (!messageText || messageText.trim() === '') {
                if (mediaUrls && mediaUrls.length > 0) {
                    messageText = ""; // Will be replaced by media links
                } else {
                    messageText = "[Empty message]";
                }
            }

            // Store broadcast message in database
            if (this.dbManager.isConnected) {
                try {
                    const broadcastMessage = await this.dbManager.createBroadcastMessage({
                        fromPhone: fromPhone,
                        fromName: sender.name,
                        originalMessage: messageText,
                        processedMessage: messageText,
                        messageType: mediaUrls && mediaUrls.length > 0 ? 'media' : 'text',
                        hasMedia: Boolean(mediaUrls && mediaUrls.length > 0),
                        mediaCount: mediaUrls ? mediaUrls.length : 0,
                        processingStatus: 'processing',
                        deliveryStatus: 'pending',
                        sentAt: new Date()
                    });
                    messageId = broadcastMessage._id.toString();
                    logger.info(`✅ Broadcast message stored with ID: ${messageId}`);
                } catch (dbError) {
                    logger.error(`❌ Failed to store broadcast message: ${dbError.message}`);
                }
            }

            let cleanMediaLinks = [];
            let mediaProcessingErrors = [];

            // Process media files if present
            if (mediaUrls && mediaUrls.length > 0) {
                logger.info(`🔄 Processing ${mediaUrls.length} media files...`);
                try {
                    const { processedLinks, processingErrors } = await this.processMediaFiles(messageId, mediaUrls);
                    cleanMediaLinks = processedLinks;
                    mediaProcessingErrors = processingErrors;

                    if (processingErrors.length > 0) {
                        logger.warn(`⚠️ Media processing errors: ${processingErrors.join(', ')}`);
                    }
                } catch (mediaError) {
                    logger.error(`❌ Media processing failed: ${mediaError.message}`);
                    mediaProcessingErrors.push(`Media processing system error: ${mediaError.message}`);
                }
            }

            // Format final message
            const finalMessage = this.formatMessageWithMedia(messageText, sender, cleanMediaLinks);

            // Update database with final message
            if (this.dbManager.isConnected && messageId) {
                try {
                    await this.dbManager.updateBroadcastMessage(messageId, {
                        processedMessage: finalMessage,
                        largeMediaCount: cleanMediaLinks.length,
                        processingStatus: 'completed'
                    });
                } catch (updateError) {
                    logger.error(`❌ Failed to update broadcast message: ${updateError.message}`);
                }
            }

            // Send to all recipients
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
                    if (this.dbManager.isConnected && messageId) {
                        try {
                            await this.dbManager.createDeliveryLog({
                                messageId: messageId,
                                memberId: member.id,
                                toPhone: member.phone,
                                deliveryMethod: 'sms',
                                deliveryStatus: result.success ? 'delivered' : 'failed',
                                twilioMessageSid: result.sid || null,
                                errorMessage: result.error || null,
                                deliveryTimeMs: deliveryTime
                            });
                        } catch (deliveryLogError) {
                            logger.error(`❌ Failed to log delivery: ${deliveryLogError.message}`);
                        }
                    }

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

            const totalTime = (Date.now() - startTime) / 1000;
            deliveryStats.totalTime = totalTime;

            // Update final status
            if (this.dbManager.isConnected && messageId) {
                try {
                    await this.dbManager.updateBroadcastMessage(messageId, {
                        deliveryStatus: 'completed'
                    });

                    await this.dbManager.recordAnalytic('broadcast_delivery_rate',
                        deliveryStats.sent / recipients.length * 100,
                        `sent:${deliveryStats.sent},failed:${deliveryStats.failed},time:${totalTime.toFixed(2)}s`);

                    await this.dbManager.updateMemberActivity(fromPhone);
                } catch (analyticsError) {
                    logger.error(`❌ Failed to record analytics: ${analyticsError.message}`);
                }
            }

            logger.info(`📊 Broadcast completed in ${totalTime.toFixed(2)}s: ${deliveryStats.sent} sent, ${deliveryStats.failed} failed`);

            // Return confirmation to admin
            if (sender.isAdmin) {
                let confirmation = `✅ Broadcast completed in ${totalTime.toFixed(1)}s\n`;
                confirmation += `📊 Delivered: ${deliveryStats.sent}/${recipients.length}\n`;

                if (cleanMediaLinks.length > 0) {
                    confirmation += `📎 Media files: ${cleanMediaLinks.length} processed\n`;
                }

                if (mediaProcessingErrors.length > 0) {
                    confirmation += `⚠️ Media errors: ${mediaProcessingErrors.length}\n`;
                }

                if (deliveryStats.failed > 0) {
                    confirmation += `⚠️ Failed deliveries: ${deliveryStats.failed}\n`;
                }

                return confirmation;
            } else {
                return null;
            }
        } catch (error) {
            logger.error(`❌ Broadcast error: ${error.message}`);
            logger.error(`❌ Broadcast stack trace: ${error.stack}`);

            if (this.dbManager.isConnected && messageId) {
                try {
                    await this.dbManager.updateBroadcastMessage(messageId, {
                        deliveryStatus: 'failed',
                        processingStatus: 'error'
                    });
                } catch (dbError) {
                    logger.error(`❌ Failed to update message status: ${dbError.message}`);
                }
            }

            return "Broadcast failed - system administrators notified";
        }
    }
    async isAdmin(phoneNumber) {
        try {
            phoneNumber = this.cleanPhoneNumber(phoneNumber);
            const member = await this.getMemberInfo(phoneNumber);
            return member ? member.isAdmin : false;
        } catch (error) {
            logger.error(`❌ Admin check error: ${error.message}`);
            return false;
        }
    }



async handleAddMemberCommand(adminPhone, commandText) {
    const startTime = Date.now();
    logger.info(`🔧 Admin ADD command from ${adminPhone}: ${commandText}`);

    try {
        // Verify admin privileges
        const admin = await this.getMemberInfo(adminPhone);
        if (!admin || !admin.isAdmin) {
            logger.warn(`❌ Non-admin attempted ADD command: ${adminPhone}`);
            return "❌ Access denied. Only church administrators can add new members.";
        }

        // Parse the ADD command: "ADD +15425636786 DANE"
        const parts = commandText.trim().split(/\s+/);
        
        if (parts.length < 3) {
            return "❌ Invalid format. Use: ADD +1234567890 MemberName";
        }

        const [command, phoneNumber, ...nameParts] = parts;
        const memberName = nameParts.join(' ').trim();

        if (command.toUpperCase() !== 'ADD') {
            return "❌ Command not recognized. Use: ADD +1234567890 MemberName";
        }

        if (!memberName) {
            return "❌ Member name is required. Use: ADD +1234567890 MemberName";
        }

        // Clean and validate phone number
        const cleanPhone = this.cleanPhoneNumber(phoneNumber);
        if (!cleanPhone) {
            return `❌ Invalid phone number format: ${phoneNumber}. Use format: +1234567890`;
        }

        // Check if member already exists - ENHANCED CHECK
        try {
            const existingMember = await this.getMemberInfo(cleanPhone);
            if (existingMember) {
                const status = existingMember.active ? "active" : "inactive";
                const groupNames = existingMember.groups?.map(g => g.name).join(", ") || "no groups";
                return `❌ Member already exists!\n👤 Name: ${existingMember.name}\n📱 Phone: ${cleanPhone}\n📊 Status: ${status}\n🏛️ Groups: ${groupNames}`;
            }
        } catch (checkError) {
            logger.error(`❌ Error checking existing member: ${checkError.message}`);
        }

        // Get the default congregation group
        const congregationGroup = await this.dbManager.getGroupByName("YesuWay Congregation");
        if (!congregationGroup) {
            logger.error('❌ Default congregation group not found');
            return "❌ System error: Default congregation group not found. Contact tech support.";
        }

        // Create new member with enhanced error handling
        try {
            const newMember = await this.dbManager.createMember({
                phoneNumber: cleanPhone,
                name: memberName,
                isAdmin: false,
                active: true,
                messageCount: 0,
                lastActivity: new Date(),
                groups: [{
                    groupId: congregationGroup._id,
                    joinedAt: new Date()
                }]
            });

            // ✨ NEW: Send welcome SMS to the new member
            const welcomeMessage = await this.sendWelcomeSMS(cleanPhone, memberName, admin.name);
            
            // Log the addition for audit trail
            await this.dbManager.recordAnalytic('member_added_via_command', 1, 
                `Admin: ${admin.name}, New Member: ${memberName} (${cleanPhone}), Welcome SMS: ${welcomeMessage.success ? 'Sent' : 'Failed'}`);

            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('add_member_command', durationMs, true);

            logger.info(`✅ Admin ${admin.name} added new member: ${memberName} (${cleanPhone})`);

            // Get updated member count
            const totalMembers = await this.dbManager.getAllActiveMembers();

            // Return enhanced success message to admin with welcome SMS status
            let successMessage = `✅ Member added successfully!\n` +
                               `👤 Name: ${memberName}\n` +
                               `📱 Phone: ${cleanPhone}\n` +
                               `🏛️ Group: ${congregationGroup.name}\n` +
                               `📊 Total active members: ${totalMembers.length}`;

            // Add welcome SMS status to admin response
            if (welcomeMessage.success) {
                successMessage += `\n📩 Welcome SMS sent successfully`;
                logger.info(`📩 Welcome SMS delivered to ${memberName} (${cleanPhone}): ${welcomeMessage.sid}`);
            } else {
                successMessage += `\n⚠️ Welcome SMS failed: ${welcomeMessage.error}`;
                logger.warn(`📩 Welcome SMS failed to ${memberName} (${cleanPhone}): ${welcomeMessage.error}`);
            }

            return successMessage;

        } catch (createError) {
            // Enhanced error handling for specific MongoDB errors
            if (createError.code === 11000) {
                // Duplicate key error
                const duplicateField = createError.keyPattern ? Object.keys(createError.keyPattern)[0] : 'unknown';
                const duplicateValue = createError.keyValue ? createError.keyValue[duplicateField] : 'unknown';
                
                logger.error(`❌ Duplicate key error: ${duplicateField} = ${duplicateValue}`);
                
                if (duplicateField === 'phoneNumber') {
                    return `❌ Phone number already exists in database!\n📱 Number: ${duplicateValue}\n💡 Use a different phone number or check if member already registered.`;
                } else {
                    return `❌ Duplicate ${duplicateField}: ${duplicateValue} already exists in database.`;
                }
            } else if (createError.name === 'ValidationError') {
                // Mongoose validation error
                const validationErrors = Object.values(createError.errors).map(err => err.message).join(', ');
                return `❌ Validation error: ${validationErrors}`;
            } else {
                // Other database errors
                logger.error(`❌ Database error creating member: ${createError.message}`);
                return `❌ Database error: Unable to create member. Please try again or contact tech support.`;
            }
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('add_member_command', durationMs, false, error.message);
        
        logger.error(`❌ ADD command error: ${error.message}`);
        logger.error(`❌ Stack trace: ${error.stack}`);
        
        // Provide more specific error information
        if (error.name === 'MongoNetworkError') {
            return "❌ Database connection error. Please try again in a moment.";
        } else if (error.name === 'MongoServerError' && error.code === 11000) {
            return "❌ Member with this phone number already exists in the system.";
        } else {
            return "❌ System error occurred while adding member. Tech team has been notified.";
        }
    }
}

// ✨ NEW METHOD: Send welcome SMS to new members
async sendWelcomeSMS(memberPhone, memberName, adminName) {
    const startTime = Date.now();
    logger.info(`📩 Sending welcome SMS to new member: ${memberName} (${memberPhone})`);

    try {
        // Create a personalized welcome message
        const welcomeMessage = this.createWelcomeMessage(memberName, adminName);
        
        // Send the welcome SMS
        const result = await this.sendSMS(memberPhone, welcomeMessage, 2); // 2 retries for welcome messages
        
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('welcome_sms_send', durationMs, result.success);

        if (result.success) {
            // Log successful welcome SMS
            await this.dbManager.recordAnalytic('welcome_sms_sent', 1, 
                `New member: ${memberName} (${memberPhone}), Added by: ${adminName}`);
            
            logger.info(`✅ Welcome SMS sent to ${memberName}: ${result.sid}`);
            return {
                success: true,
                sid: result.sid,
                message: "Welcome SMS sent successfully"
            };
        } else {
            // Log failed welcome SMS
            await this.dbManager.recordAnalytic('welcome_sms_failed', 1, 
                `New member: ${memberName} (${memberPhone}), Error: ${result.error}`);
            
            logger.error(`❌ Welcome SMS failed to ${memberName}: ${result.error}`);
            return {
                success: false,
                error: result.error,
                message: "Welcome SMS delivery failed"
            };
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('welcome_sms_send', durationMs, false, error.message);
        
        logger.error(`❌ Welcome SMS system error for ${memberName}: ${error.message}`);
        return {
            success: false,
            error: error.message,
            message: "Welcome SMS system error"
        };
    }
}

// ✨ NEW METHOD: Create personalized welcome message
createWelcomeMessage(memberName, adminName) {
    // Professional welcome message for new congregation members
    const welcomeMessage = `🏛️ Welcome to YesuWay Church, ${memberName}!

You've been added to our church SMS system by ${adminName}.

📱 HOW IT WORKS:
• Text anything to this number to broadcast to our entire congregation
• Share photos, prayer requests, and announcements
• Everyone receives your messages instantly

✅ WHAT YOU CAN SHARE:
• Prayer requests and testimonies
• Church event updates and reminders
• Photos from services and events
• Encouragement and fellowship messages

💡 GETTING STARTED:
• Send "Hello everyone!" to introduce yourself
• Share freely - we're one church family

🙏 SCRIPTURE:
"And let us consider how we may spur one another on toward love and good deeds." - Hebrews 10:24

Welcome to our church family! We're excited to have you connected with us.

- YesuWay Church Technology Team`;

    return welcomeMessage;
}

// ✨ OPTIONAL: Enhanced welcome message with church-specific customization
createCustomWelcomeMessage(memberName, adminName, churchName = "YesuWay Church") {
    // You can customize this method for your specific church
    const welcomeMessage = `🏛️ Welcome to ${churchName}, ${memberName}!

${adminName} has added you to our church communication system.

📱 YOU'RE NOW CONNECTED to our entire congregation through SMS!

🎯 SIMPLE TO USE:
• Text anything to this number
• Your message goes to everyone instantly
• Share photos, videos, and updates freely

🏛️ CHURCH FAMILY NETWORK:
• Prayer requests reach everyone immediately
• Event updates and announcements
• Photos from services and fellowship
• Daily encouragement and support

📲 TRY IT NOW:
Send "Excited to be part of ${churchName}!" and introduce yourself to everyone.

🙏 BLESSING:
"Therefore encourage one another and build each other up." - 1 Thessalonians 5:11

God bless you, and welcome to our church family!

- ${churchName} Leadership Team`;

    return welcomeMessage;
}

// Replace your handleRemoveMemberCommand method in app.js with this version
// This will COMPLETELY delete the member from the database

async handleRemoveMemberCommand(adminPhone, commandText) {
    const startTime = Date.now();
    logger.info(`🗑️ Admin REMOVE command from ${adminPhone}: ${commandText}`);

    try {
        // Verify admin privileges
        const admin = await this.getMemberInfo(adminPhone);
        if (!admin || !admin.isAdmin) {
            logger.warn(`❌ Non-admin attempted REMOVE command: ${adminPhone}`);
            return "❌ Access denied. Only church administrators can remove members.";
        }

        // Parse the REMOVE command: "REMOVE +2068001141 MemberName"
        const parts = commandText.trim().split(/\s+/);
        
        if (parts.length < 2) {
            return "❌ Invalid format. Use: REMOVE +1234567890 [optional name]\n💡 Example: REMOVE +12068001141\n💡 With name: REMOVE +12068001141 John Smith";
        }

        const [command, phoneNumber, ...nameParts] = parts;
        const memberName = nameParts.join(' ').trim();

        if (command.toUpperCase() !== 'REMOVE') {
            return "❌ Command not recognized. Use: REMOVE +1234567890 [optional name]";
        }

        // Clean and validate phone number
        const cleanPhone = this.cleanPhoneNumber(phoneNumber);
        if (!cleanPhone) {
            return `❌ Invalid phone number: ${phoneNumber}\n💡 Use format: +1234567890 or 2068001141`;
        }

        logger.info(`🔍 Looking for member to remove: ${cleanPhone}`);

        // Find ALL members with this phone number (including inactive ones)
        const membersToRemove = await Member.find({ phoneNumber: cleanPhone });
        
        if (membersToRemove.length === 0) {
            // Try alternative phone number formats
            const phoneDigits = cleanPhone.replace(/\D/g, '');
            const alternativeFormats = [
                phoneNumber,           // Original input
                phoneDigits,          // Just digits
                `+1${phoneDigits}`,   // +1 prefix
                `+${phoneDigits}`,    // + prefix
                `1${phoneDigits}`     // 1 prefix
            ];

            let found = false;
            for (const altFormat of alternativeFormats) {
                const altMembers = await Member.find({ phoneNumber: altFormat });
                if (altMembers.length > 0) {
                    membersToRemove.push(...altMembers);
                    found = true;
                    logger.info(`📞 Found member(s) with alternative format: ${altFormat}`);
                }
            }

            if (!found) {
                return `❌ No member found with phone number: ${cleanPhone}\n\n💡 Check the phone number or view all members with /debug endpoint`;
            }
        }

        // If name is provided, verify it matches
        if (memberName) {
            const nameMatch = membersToRemove.find(member => 
                member.name.toLowerCase() === memberName.toLowerCase()
            );
            
            if (!nameMatch) {
                const memberNames = membersToRemove.map(m => m.name).join(', ');
                return `❌ Name verification failed!\n📱 Phone: ${cleanPhone}\n💾 Found members: ${memberNames}\n✏️ Your input: ${memberName}\n\n💡 Use exact name or remove without name for phone-only deletion.`;
            }
        }

        // Prevent admin from removing themselves
        if (cleanPhone === this.cleanPhoneNumber(adminPhone)) {
            return "❌ You cannot remove yourself from the system.\n\n💡 Contact another admin to remove your account.";
        }

        // Show what will be deleted and ask for confirmation
        let confirmationMessage = `🗑️ PERMANENT DELETION CONFIRMATION:\n\n`;
        confirmationMessage += `📱 Phone: ${cleanPhone}\n`;
        confirmationMessage += `👥 Members to delete: ${membersToRemove.length}\n\n`;
        
        membersToRemove.forEach((member, index) => {
            const status = member.active ? 'Active' : 'Inactive';
            const admin = member.isAdmin ? ' [ADMIN]' : '';
            confirmationMessage += `${index + 1}. ${member.name}${admin} (${status})\n`;
        });

        // Check if any are admins
        const adminMembers = membersToRemove.filter(m => m.isAdmin);
        if (adminMembers.length > 0) {
            return `❌ Cannot remove admin member(s): ${adminMembers.map(m => m.name).join(', ')}\n\n💡 Admin members must be removed through database management tools for security.`;
        }

        // Store member info for response before deletion
        const deletionInfo = {
            count: membersToRemove.length,
            members: membersToRemove.map(m => ({
                name: m.name,
                phone: m.phoneNumber,
                id: m._id,
                active: m.active
            }))
        };

        logger.info(`🗑️ PERMANENTLY DELETING ${membersToRemove.length} member(s) with phone ${cleanPhone}`);

        try {
            // COMPLETE DELETION - Remove from database entirely
            const deleteResult = await Member.deleteMany({ 
                _id: { $in: membersToRemove.map(m => m._id) }
            });

            if (deleteResult.deletedCount === 0) {
                return `❌ Failed to delete members.\n\n💡 Members may have already been removed.`;
            }

            // Also clean up any related data (broadcast messages, delivery logs, etc.)
            try {
                // Remove any broadcast messages from these members
                const phoneNumbers = membersToRemove.map(m => m.phoneNumber);
                await BroadcastMessage.deleteMany({ fromPhone: { $in: phoneNumbers } });
                
                // Remove any delivery logs to these members
                await DeliveryLog.deleteMany({ toPhone: { $in: phoneNumbers } });
                
                logger.info(`🧹 Cleaned up related data for deleted members`);
            } catch (cleanupError) {
                logger.warn(`⚠️ Error cleaning up related data: ${cleanupError.message}`);
                // Continue anyway - main deletion succeeded
            }

            // Log the removal for audit trail
            await this.dbManager.recordAnalytic('member_permanently_deleted', deletionInfo.count, 
                `Admin: ${admin.name}, Deleted: ${deletionInfo.members.map(m => `${m.name} (${m.phone})`).join(', ')}`);

            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('remove_member_command', durationMs, true);

            logger.info(`✅ Admin ${admin.name} PERMANENTLY deleted ${deleteResult.deletedCount} member(s)`);

            // Get updated member count
            const remainingMembers = await this.dbManager.getAllActiveMembers();

            // Return detailed success message
            let successMessage = `✅ Member(s) PERMANENTLY DELETED!\n\n`;
            successMessage += `📊 Deleted: ${deleteResult.deletedCount} member(s)\n`;
            
            deletionInfo.members.forEach((member, index) => {
                successMessage += `${index + 1}. ${member.name} (${member.phone})\n`;
            });
            
            successMessage += `\n📊 Remaining active members: ${remainingMembers.length}\n\n`;
            successMessage += `✅ Phone number ${cleanPhone} is now available for re-use\n`;
            successMessage += `💡 You can now ADD a new member with this phone number`;

            return successMessage;

        } catch (deleteError) {
            logger.error(`❌ Database error deleting member: ${deleteError.message}`);
            return `❌ Database error occurred while deleting member.\n\n💡 Error: ${deleteError.message}\nPlease try again or contact tech support.`;
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('remove_member_command', durationMs, false, error.message);
        
        logger.error(`❌ REMOVE command error: ${error.message}`);
        logger.error(`❌ Stack trace: ${error.stack}`);
        
        return "❌ System error occurred while removing member.\n\n💡 Tech team has been notified. Please try again later.";
    }
}

// Add this new method to your ProductionChurchSMS class in app.js
// This will handle database cleanup and duplicate removal

async handleCleanupCommand(adminPhone, commandText) {
    const startTime = Date.now();
    logger.info(`🧹 Admin CLEANUP command from ${adminPhone}: ${commandText}`);

    try {
        // Verify admin privileges
        const admin = await this.getMemberInfo(adminPhone);
        if (!admin || !admin.isAdmin) {
            logger.warn(`❌ Non-admin attempted CLEANUP command: ${adminPhone}`);
            return "❌ Access denied. Only church administrators can run cleanup operations.";
        }

        const parts = commandText.trim().split(/\s+/);
        const subCommand = parts[1]?.toUpperCase() || 'STATUS';

        switch (subCommand) {
            case 'STATUS':
                return await this.getCleanupStatus();
            
            case 'DUPLICATES':
                return await this.cleanupDuplicates();
            
            case 'PHONE':
                if (parts.length < 3) {
                    return "❌ Usage: CLEANUP PHONE +1234567890\n💡 This removes ALL members with that phone number";
                }
                return await this.cleanupPhone(parts[2]);
            
            case 'ORPHANED':
                return await this.cleanupOrphanedData();
            
            default:
                return `❌ Unknown cleanup command: ${subCommand}\n\n📋 Available commands:\n• CLEANUP STATUS - Show cleanup status\n• CLEANUP DUPLICATES - Remove duplicate phone numbers\n• CLEANUP PHONE +1234567890 - Remove all members with phone\n• CLEANUP ORPHANED - Remove orphaned data`;
        }

    } catch (error) {
        logger.error(`❌ CLEANUP command error: ${error.message}`);
        return "❌ Cleanup operation failed. Tech team has been notified.";
    }
}

// Enhanced generateHelpMessage method with WIPE and ADMIN commands
// Replace your existing generateHelpMessage method in app.js with this version

async generateHelpMessage(member) {
    const startTime = Date.now();
    
    try {
        const stats = await this.dbManager.getHealthStats();
        
        // 🎯 COMMANDS-ONLY HELP (Under 800 characters)
        let helpMessage = `📋 YESUWAY CHURCH COMMANDS
═══════════════════════════════

👥 ${stats.activeMemberCount} members • ${config.twilio.phoneNumber}

💬 BASIC USAGE:
• Text anything → broadcasts to everyone
• Share photos/videos freely
• React: ❤️😂👍🙏 (processed silently)

📱 AVAILABLE COMMANDS:
• HELP - Show this message`;

        // Add admin commands if user is admin
        if (member.isAdmin) {
            helpMessage += `

🔑 ADMIN COMMANDS:
• REACTIONS STATS - View reaction analytics
• REACTIONS SUMMARY - Force generate summary
• REACTIONS RECENT - View recent reactions
• ADD +1234567890 Name - Add new member
• REMOVE +1234567890 Name - Remove member
• ADMIN +1234567890 Name - Grant admin access
• DEMOTE +1234567890 Name - Remove admin access
• CLEANUP STATUS - Database health check
• WIPE CONFIRM - Emergency database reset`;
        }

        helpMessage += `

💚 YesuWay Church • Professional SMS System`;

        // Record usage and log character count
        await this.dbManager.recordAnalytic('help_command_used', 1, 
            `User: ${member.name} (${member.isAdmin ? 'Admin' : 'Member'})`);

        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('help_command', durationMs, true);

        logger.info(`📋 HELP command used by ${member.name} (Admin: ${member.isAdmin})`);
        logger.info(`📏 Help message length: ${helpMessage.length} characters`);

        return helpMessage;

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('help_command', durationMs, false, error.message);
        
        logger.error(`❌ HELP command error: ${error.message}`);
        
        // Ultra-minimal fallback
        return `📋 YESUWAY CHURCH

📱 Commands: HELP, REACTIONS STATS
💬 Text anything to broadcast
🔇 React with ❤️😂👍🙏

💚 YesuWay Church`;
    }
}

// ============================================================================
// ALTERNATIVE: EVEN MORE MINIMAL VERSION
// ============================================================================

async generateMinimalHelp(member) {
    let help = `📋 COMMANDS

📱 BASIC:
• Text anything → broadcast to all
• React: ❤️😂👍🙏 (silent processing)`;

    if (member.isAdmin) {
        help += `

🔑 ADMIN:
• REACTIONS STATS
• REACTIONS SUMMARY  
• ADD +phone Name
• REMOVE +phone Name
• CLEANUP STATUS`;
    }

    help += `

💚 YesuWay Church`;

    logger.info(`📏 Minimal help: ${help.length} characters`);
    return help;
}

// ============================================================================
// SUPER MINIMAL: JUST COMMANDS
// ============================================================================

async generateCommandsOnly(member) {
    let commands = `📋 AVAILABLE COMMANDS

💬 HELP - Show commands`;

    if (member.isAdmin) {
        commands += `
🔑 REACTIONS STATS - Analytics
🔑 REACTIONS SUMMARY - Force summary
🔑 REACTIONS RECENT - Recent activity
🔑 ADD +phone Name - Add member
🔑 REMOVE +phone Name - Remove member
🔑 ADMIN +phone Name - Grant admin
🔑 DEMOTE +phone Name - Remove admin
🔑 CLEANUP STATUS - Database health
🔑 WIPE CONFIRM - Emergency reset`;
    }

    commands += `

Text anything else to broadcast to congregation.
React with ❤️😂👍🙏 for silent reactions.

YesuWay Church`;

    logger.info(`📏 Commands only: ${commands.length} characters`);
    return commands;
}

// Optional: Add a detailed admin help command
async generateDetailedAdminHelp(member) {
    if (!member.isAdmin) {
        return "❌ Access denied. Admin commands are restricted to church administrators.";
    }

    const helpMessage = `🔑 DETAILED ADMIN COMMAND REFERENCE
═══════════════════════════════════════

📝 MEMBER MANAGEMENT:
═══════════════════════════════════════

➤ ADD COMMAND:
Format: ADD +1234567890 MemberName
• Adds new member to YesuWay Congregation group
• Sends automatic welcome SMS to new member
• Validates phone number format
• Checks for existing members
• Returns confirmation with member count

Examples:
• ADD +12065551234 John Smith
• ADD +14257729189 Sarah Johnson

➤ REMOVE COMMAND:
Format: REMOVE +1234567890 [MemberName]
• PERMANENTLY deletes member from database
• Removes all associated data (messages, logs)
• Optional name for verification
• Cannot remove admin members
• Cannot remove yourself

Examples:
• REMOVE +12065551234
• REMOVE +12065551234 John Smith

🗄️ DATABASE CLEANUP:
═══════════════════════════════════════

➤ CLEANUP STATUS:
Shows database health information:
• Duplicate phone numbers count
• Inactive members count  
• Orphaned messages count
• Detailed list of issues found

➤ CLEANUP DUPLICATES:
• Finds members with same phone number
• Keeps oldest active member
• Deletes duplicate entries
• Cannot be undone

➤ CLEANUP PHONE +1234567890:
• Removes ALL members with that phone
• Deletes all associated data
• Completely cleans phone number
• Makes number available for re-use

➤ CLEANUP ORPHANED:
• Removes inactive members (active: false)
• Deletes orphaned messages
• Deletes orphaned delivery logs
• Optimizes database performance

⚠️ IMPORTANT WARNINGS:
═══════════════════════════════════════
• All REMOVE and CLEANUP operations are PERMANENT
• Deleted data cannot be recovered
• Admin members cannot be removed via SMS
• Always check CLEANUP STATUS before running cleanup
• Welcome SMS are sent automatically for new members

📊 SYSTEM MONITORING:
═══════════════════════════════════════
• All admin commands are logged for audit
• Performance metrics are tracked
• Database operations are monitored
• Error handling provides detailed feedback

💡 BEST PRACTICES:
═══════════════════════════════════════
• Run CLEANUP STATUS weekly
• Add members one at a time for welcome SMS
• Use full names for better organization
• Keep phone numbers in +1234567890 format
• Verify member details before removal

🏛️ YesuWay Church Technology Team`;

    return helpMessage;
}


// Add this new method to your ProductionChurchSMS class in app.js

// 🔻 DEMOTE command - Remove admin privileges from administrators
async handleDemoteCommand(adminPhone, commandText) {
    const startTime = Date.now();
    logger.info(`🔻 ADMIN DEMOTE command from ${adminPhone}: ${commandText}`);

    try {
        // Verify admin privileges
        const admin = await this.getMemberInfo(adminPhone);
        if (!admin || !admin.isAdmin) {
            logger.warn(`❌ Non-admin attempted DEMOTE command: ${adminPhone}`);
            return "❌ Access denied. Only church administrators can demote other administrators.";
        }

        // Parse the DEMOTE command: "DEMOTE +12068001141 Abel"
        const parts = commandText.trim().split(/\s+/);
        
        if (parts.length < 2) {
            return "❌ Invalid format. Use: DEMOTE +1234567890 [AdminName]\n\n💡 This will:\n• Remove admin privileges from member\n• Convert to regular congregation member\n• Retain membership but remove admin access";
        }

        const [command, phoneNumber, ...nameParts] = parts;
        const adminName = nameParts.join(' ').trim();

        if (command.toUpperCase() !== 'DEMOTE') {
            return "❌ Command not recognized. Use: DEMOTE +1234567890 [AdminName]";
        }

        // Clean and validate phone number
        const cleanPhone = this.cleanPhoneNumber(phoneNumber);
        if (!cleanPhone) {
            return `❌ Invalid phone number format: ${phoneNumber}.\n💡 Use format: +1234567890`;
        }

        // Prevent admin from demoting themselves
        if (cleanPhone === this.cleanPhoneNumber(adminPhone)) {
            return "❌ You cannot demote yourself.\n\n💡 Contact another admin to remove your admin privileges.";
        }

        // Check if person exists and is an admin
        const targetMember = await this.getMemberInfo(cleanPhone);
        
        if (!targetMember) {
            return `❌ No member found with phone number: ${cleanPhone}\n\n💡 Check the phone number and try again.`;
        }

        if (!targetMember.isAdmin) {
            const groupNames = targetMember.groups?.map(g => g.name).join(", ") || "no groups";
            return `❌ ${targetMember.name} is not an administrator!\n\n📊 Current Status:\n👤 Name: ${targetMember.name}\n📱 Phone: ${cleanPhone}\n🔑 Admin: No\n🏛️ Groups: ${groupNames}\n\n💡 Only administrators can be demoted.`;
        }

        // Name verification if provided
        if (adminName && targetMember.name.toLowerCase() !== adminName.toLowerCase()) {
            return `❌ Name verification failed!\n📱 Phone: ${cleanPhone}\n💾 Found admin: ${targetMember.name}\n✏️ Your input: ${adminName}\n\n💡 Use exact name or phone-only for demoting.`;
        }

        try {
            // Remove admin privileges (convert to regular member)
            await Member.findByIdAndUpdate(
                targetMember.id,
                { 
                    isAdmin: false,
                    lastActivity: new Date()
                },
                { new: true }
            );

            // ✨ Send demotion notification SMS
            const demotionMessage = await this.sendAdminDemotionSMS(cleanPhone, targetMember.name, admin.name);

            // Log the demotion for audit trail
            await this.dbManager.recordAnalytic('admin_demoted', 1, 
                `Demoted by: ${admin.name}, Former Admin: ${targetMember.name} (${cleanPhone}), Demotion SMS: ${demotionMessage.success ? 'Sent' : 'Failed'}`);

            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('admin_demotion', durationMs, true);

            logger.info(`✅ Admin ${admin.name} demoted ${targetMember.name} (${cleanPhone}) from administrator`);

            // Get updated member counts
            const totalMembers = await this.dbManager.getAllActiveMembers();
            const adminCount = totalMembers.filter(m => m.isAdmin).length;

            let successMessage = `🔻 ADMIN DEMOTION SUCCESSFUL!\n\n`;
            successMessage += `👤 Name: ${targetMember.name}\n`;
            successMessage += `📱 Phone: ${cleanPhone}\n`;
            successMessage += `🔑 Status: Regular Member (DEMOTED)\n`;
            successMessage += `🏛️ Groups: Retained existing groups\n`;
            successMessage += `📊 Total admins: ${adminCount}\n`;
            successMessage += `📊 Total members: ${totalMembers.length}\n\n`;
            successMessage += `❌ ADMIN PRIVILEGES REMOVED:\n`;
            successMessage += `• No longer can ADD members\n`;
            successMessage += `• No longer can REMOVE members\n`;
            successMessage += `• No longer can ADMIN/DEMOTE\n`;
            successMessage += `• No longer can WIPE database\n`;
            successMessage += `• No longer can CLEANUP operations\n`;
            successMessage += `• No admin endpoint access\n\n`;
            successMessage += `✅ Still active congregation member\n`;

            // Add demotion SMS status
            if (demotionMessage.success) {
                successMessage += `📩 Demotion notification SMS sent successfully`;
                logger.info(`📩 Demotion SMS delivered to ${targetMember.name} (${cleanPhone}): ${demotionMessage.sid}`);
            } else {
                successMessage += `⚠️ Demotion notification SMS failed: ${demotionMessage.error}`;
                logger.warn(`📩 Demotion SMS failed to ${targetMember.name} (${cleanPhone}): ${demotionMessage.error}`);
            }

            return successMessage;

        } catch (demotionError) {
            logger.error(`❌ Failed to demote admin: ${demotionError.message}`);
            return `❌ Failed to demote ${targetMember.name} from administrator.\n\n💡 Error: ${demotionError.message}`;
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('demote_command', durationMs, false, error.message);
        
        logger.error(`❌ DEMOTE command error: ${error.message}`);
        logger.error(`❌ Stack trace: ${error.stack}`);
        
        return "❌ System error occurred while demoting administrator.\n\n💡 Tech team has been notified.";
    }
}

// ✨ NEW METHOD: Send admin demotion notification SMS
async sendAdminDemotionSMS(memberPhone, memberName, demotingAdminName) {
    const startTime = Date.now();
    logger.info(`📩 Sending admin demotion SMS to: ${memberName} (${memberPhone})`);

    try {
        // Create a professional demotion notification message
        const demotionMessage = this.createAdminDemotionMessage(memberName, demotingAdminName);
        
        // Send the demotion SMS
        const result = await this.sendSMS(memberPhone, demotionMessage, 2);
        
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('admin_demotion_sms', durationMs, result.success);

        if (result.success) {
            await this.dbManager.recordAnalytic('admin_demotion_sms_sent', 1, 
                `Former Admin: ${memberName} (${memberPhone}), Demoted by: ${demotingAdminName}`);
            
            logger.info(`✅ Admin demotion SMS sent to ${memberName}: ${result.sid}`);
            return {
                success: true,
                sid: result.sid,
                message: "Admin demotion SMS sent successfully"
            };
        } else {
            await this.dbManager.recordAnalytic('admin_demotion_sms_failed', 1, 
                `Former Admin: ${memberName} (${memberPhone}), Error: ${result.error}`);
            
            logger.error(`❌ Admin demotion SMS failed to ${memberName}: ${result.error}`);
            return {
                success: false,
                error: result.error,
                message: "Admin demotion SMS delivery failed"
            };
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('admin_demotion_sms', durationMs, false, error.message);
        
        logger.error(`❌ Admin demotion SMS system error for ${memberName}: ${error.message}`);
        return {
            success: false,
            error: error.message,
            message: "Admin demotion SMS system error"
        };
    }
}

// ✨ NEW METHOD: Create admin demotion message
createAdminDemotionMessage(memberName, demotingAdminName) {
    const demotionMessage = `🔻 ADMIN PRIVILEGES REMOVED

${memberName}, your administrator privileges have been removed by ${demotingAdminName}.

📊 YOUR NEW STATUS:
• Regular Congregation Member
• Retained church membership
• No administrative access

❌ REMOVED PRIVILEGES:
• Cannot ADD new members
• Cannot REMOVE members
• Cannot grant ADMIN privileges
• Cannot WIPE database
• Cannot use CLEANUP commands
• No admin endpoint access

✅ YOU CAN STILL:
• Send messages to congregation
• Share photos and media
• Participate in church communication
• Receive all broadcasts

📱 QUESTIONS?
Contact ${demotingAdminName} or church leadership for clarification.

You remain a valued member of our church family.

- YesuWay Church Leadership`;

    return demotionMessage;
}


// Add these methods to your ProductionChurchSMS class in app.js
// Place them after the existing handleCleanupCommand method

// ⚠️ DANGEROUS: WIPE command - Completely wipes all database data
async handleWipeCommand(adminPhone, commandText) {
    const startTime = Date.now();
    logger.info(`🚨 ADMIN WIPE command from ${adminPhone}: ${commandText}`);

    try {
        // Verify admin privileges
        const admin = await this.getMemberInfo(adminPhone);
        if (!admin || !admin.isAdmin) {
            logger.warn(`❌ Non-admin attempted WIPE command: ${adminPhone}`);
            return "❌ Access denied. Only church administrators can execute WIPE operations.";
        }

        const parts = commandText.trim().split(/\s+/);
        const confirmationWord = parts[1]?.toUpperCase();

        // Require explicit confirmation to prevent accidental wipes
        if (!confirmationWord || confirmationWord !== 'CONFIRM') {
            return `🚨 WIPE COMMAND - PERMANENT DATA DESTRUCTION\n\n` +
                   `⚠️ This will PERMANENTLY DELETE ALL DATA:\n` +
                   `• All congregation members\n` +
                   `• All broadcast messages\n` +
                   `• All media files\n` +
                   `• All delivery logs\n` +
                   `• All analytics data\n` +
                   `• All performance metrics\n` +
                   `• ALL DATABASE CONTENT\n\n` +
                   `🔥 THIS CANNOT BE UNDONE!\n\n` +
                   `To proceed, send: WIPE CONFIRM\n\n` +
                   `⚠️ Only use this for complete system reset`;
        }

        logger.warn(`🚨 ADMIN ${admin.name} initiating COMPLETE DATABASE WIPE`);

        try {
            // Count data before deletion for logging
            const preWipeStats = {
                members: await Member.countDocuments({}),
                groups: await Group.countDocuments({}),
                messages: await BroadcastMessage.countDocuments({}),
                mediaFiles: await MediaFile.countDocuments({}),
                deliveryLogs: await DeliveryLog.countDocuments({}),
                analytics: await SystemAnalytics.countDocuments({}),
                performanceMetrics: await PerformanceMetrics.countDocuments({})
            };

            logger.warn(`🚨 Pre-wipe data count: ${JSON.stringify(preWipeStats)}`);

            // COMPLETE DATABASE WIPE - DELETE ALL COLLECTIONS
            const deleteResults = await Promise.allSettled([
                Member.deleteMany({}),
                Group.deleteMany({}),
                BroadcastMessage.deleteMany({}),
                MediaFile.deleteMany({}),
                DeliveryLog.deleteMany({}),
                SystemAnalytics.deleteMany({}),
                PerformanceMetrics.deleteMany({})
            ]);

            // Check deletion results
            const deletionSummary = {
                members: deleteResults[0].status === 'fulfilled' ? deleteResults[0].value.deletedCount : 0,
                groups: deleteResults[1].status === 'fulfilled' ? deleteResults[1].value.deletedCount : 0,
                messages: deleteResults[2].status === 'fulfilled' ? deleteResults[2].value.deletedCount : 0,
                mediaFiles: deleteResults[3].status === 'fulfilled' ? deleteResults[3].value.deletedCount : 0,
                deliveryLogs: deleteResults[4].status === 'fulfilled' ? deleteResults[4].value.deletedCount : 0,
                analytics: deleteResults[5].status === 'fulfilled' ? deleteResults[5].value.deletedCount : 0,
                performanceMetrics: deleteResults[6].status === 'fulfilled' ? deleteResults[6].value.deletedCount : 0
            };

            // Check for any failed deletions
            const failures = deleteResults.filter(result => result.status === 'rejected');
            if (failures.length > 0) {
                logger.error(`❌ Some deletions failed: ${failures.map(f => f.reason?.message).join(', ')}`);
            }

            const totalDeleted = Object.values(deletionSummary).reduce((sum, count) => sum + count, 0);

            // Final verification - check if database is truly empty
            const postWipeStats = {
                members: await Member.countDocuments({}),
                groups: await Group.countDocuments({}),
                messages: await BroadcastMessage.countDocuments({}),
                mediaFiles: await MediaFile.countDocuments({}),
                deliveryLogs: await DeliveryLog.countDocuments({}),
                analytics: await SystemAnalytics.countDocuments({}),
                performanceMetrics: await PerformanceMetrics.countDocuments({})
            };

            const remainingRecords = Object.values(postWipeStats).reduce((sum, count) => sum + count, 0);

            const durationMs = Date.now() - startTime;
            
            // Log the wipe operation (this will fail if analytics collection was wiped)
            try {
                await this.dbManager.recordAnalytic('database_wiped', totalDeleted, 
                    `Admin: ${admin.name}, Total records deleted: ${totalDeleted}, Duration: ${durationMs}ms`);
            } catch (logError) {
                logger.warn(`⚠️ Could not log wipe operation (expected if analytics collection wiped): ${logError.message}`);
            }

            await this.recordPerformanceMetric('database_wipe', durationMs, remainingRecords === 0);

            logger.warn(`🚨 DATABASE WIPE COMPLETED by ${admin.name}`);
            logger.warn(`📊 Total records deleted: ${totalDeleted}`);
            logger.warn(`📊 Remaining records: ${remainingRecords}`);

            let wipeReport = `🚨 DATABASE WIPE COMPLETED\n\n`;
            wipeReport += `🔥 PERMANENT DELETION SUMMARY:\n`;
            wipeReport += `👥 Members deleted: ${deletionSummary.members}\n`;
            wipeReport += `🏛️ Groups deleted: ${deletionSummary.groups}\n`;
            wipeReport += `📨 Messages deleted: ${deletionSummary.messages}\n`;
            wipeReport += `📎 Media files deleted: ${deletionSummary.mediaFiles}\n`;
            wipeReport += `📊 Delivery logs deleted: ${deletionSummary.deliveryLogs}\n`;
            wipeReport += `📈 Analytics deleted: ${deletionSummary.analytics}\n`;
            wipeReport += `⚡ Performance metrics deleted: ${deletionSummary.performanceMetrics}\n\n`;
            wipeReport += `📊 Total records deleted: ${totalDeleted}\n`;
            wipeReport += `⏱️ Operation completed in: ${(durationMs / 1000).toFixed(2)}s\n\n`;

            if (remainingRecords === 0) {
                wipeReport += `✅ DATABASE IS NOW COMPLETELY EMPTY\n`;
                wipeReport += `💡 Run setup.js to reinitialize the system\n`;
                wipeReport += `💡 Add congregation members via setup script`;
            } else {
                wipeReport += `⚠️ WARNING: ${remainingRecords} records remain\n`;
                wipeReport += `💡 Some collections may not have been fully wiped`;
            }

            return wipeReport;

        } catch (wipeError) {
            logger.error(`❌ Database wipe failed: ${wipeError.message}`);
            return `❌ Database wipe failed: ${wipeError.message}\n\n💡 Check database connection and permissions`;
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('database_wipe', durationMs, false, error.message);
        
        logger.error(`❌ WIPE command error: ${error.message}`);
        logger.error(`❌ Stack trace: ${error.stack}`);
        
        return "❌ System error occurred during wipe operation.\n\n💡 Check system logs for detailed error information.";
    }
}



// 🔑 ADMIN command - Add new administrators with full control
async handleAdminCommand(adminPhone, commandText) {
    const startTime = Date.now();
    logger.info(`🔑 ADMIN command from ${adminPhone}: ${commandText}`);

    try {
        // Verify admin privileges
        const admin = await this.getMemberInfo(adminPhone);
        if (!admin || !admin.isAdmin) {
            logger.warn(`❌ Non-admin attempted ADMIN command: ${adminPhone}`);
            return "❌ Access denied. Only church administrators can manage admin privileges.";
        }

        // Parse the ADMIN command: "ADMIN +15425636786 DANE"
        const parts = commandText.trim().split(/\s+/);
        
        if (parts.length < 3) {
            return "❌ Invalid format. Use: ADMIN +1234567890 AdminName\n\n💡 This will:\n• Add person as new admin\n• Grant full administrative control\n• Enable all admin commands (ADD, REMOVE, WIPE, CLEANUP)";
        }

        const [command, phoneNumber, ...nameParts] = parts;
        const adminName = nameParts.join(' ').trim();

        if (command.toUpperCase() !== 'ADMIN') {
            return "❌ Command not recognized. Use: ADMIN +1234567890 AdminName";
        }

        if (!adminName) {
            return "❌ Admin name is required. Use: ADMIN +1234567890 AdminName";
        }

        // Clean and validate phone number
        const cleanPhone = this.cleanPhoneNumber(phoneNumber);
        if (!cleanPhone) {
            return `❌ Invalid phone number format: ${phoneNumber}.\n💡 Use format: +1234567890`;
        }

        // Prevent admin from modifying themselves (though they could add themselves as admin again)
        if (cleanPhone === this.cleanPhoneNumber(adminPhone)) {
            return "❌ You cannot modify your own admin status.\n\n💡 Contact another admin if you need to change your permissions.";
        }

        // Check if person already exists
        let existingMember = await this.getMemberInfo(cleanPhone);
        
        if (existingMember) {
            // Person exists - check if already admin
            if (existingMember.isAdmin) {
                const groupNames = existingMember.groups?.map(g => g.name).join(", ") || "no groups";
                return `❌ ${existingMember.name} is already an administrator!\n\n📊 Current Status:\n👤 Name: ${existingMember.name}\n📱 Phone: ${cleanPhone}\n🔑 Admin: Yes\n🏛️ Groups: ${groupNames}\n📊 Messages sent: ${existingMember.messageCount}`;
            } else {
                // Promote existing member to admin
                try {
                    await Member.findByIdAndUpdate(
                        existingMember.id,
                        { 
                            isAdmin: true,
                            name: adminName, // Update name in case it changed
                            lastActivity: new Date()
                        },
                        { new: true }
                    );

                    // Ensure they're in the leadership group
                    const leadershipGroup = await this.dbManager.getGroupByName("Church Leadership");
                    if (leadershipGroup) {
                        const isInLeadershipGroup = existingMember.groups.some(g => 
                            g.groupId.toString() === leadershipGroup._id.toString()
                        );
                        
                        if (!isInLeadershipGroup) {
                            await this.dbManager.addMemberToGroup(existingMember.id, leadershipGroup._id);
                            logger.info(`✅ Added new admin ${adminName} to Church Leadership group`);
                        }
                    }

                    // ✨ Send admin promotion notification SMS
                    const promotionMessage = await this.sendAdminPromotionSMS(cleanPhone, adminName, admin.name);

                    // Log the promotion for audit trail
                    await this.dbManager.recordAnalytic('member_promoted_to_admin', 1, 
                        `Promoted by: ${admin.name}, New Admin: ${adminName} (${cleanPhone}), Promotion SMS: ${promotionMessage.success ? 'Sent' : 'Failed'}`);

                    const durationMs = Date.now() - startTime;
                    await this.recordPerformanceMetric('admin_promotion', durationMs, true);

                    logger.info(`✅ Admin ${admin.name} promoted ${adminName} (${cleanPhone}) to administrator`);

                    // Get updated member count
                    const totalMembers = await this.dbManager.getAllActiveMembers();
                    const adminCount = totalMembers.filter(m => m.isAdmin).length;

                    let successMessage = `🔑 ADMIN PROMOTION SUCCESSFUL!\n\n`;
                    successMessage += `👤 Name: ${adminName}\n`;
                    successMessage += `📱 Phone: ${cleanPhone}\n`;
                    successMessage += `🔑 Status: Administrator (PROMOTED)\n`;
                    successMessage += `🏛️ Group: Church Leadership\n`;
                    successMessage += `📊 Total admins: ${adminCount}\n`;
                    successMessage += `📊 Total members: ${totalMembers.length}\n\n`;
                    successMessage += `✅ FULL ADMIN PRIVILEGES GRANTED:\n`;
                    successMessage += `• ADD - Add new congregation members\n`;
                    successMessage += `• REMOVE - Remove members from system\n`;
                    successMessage += `• ADMIN - Manage administrator privileges\n`;
                    successMessage += `• WIPE - Emergency database wipe\n`;
                    successMessage += `• CLEANUP - Database maintenance\n`;
                    successMessage += `• Access to all admin endpoints\n\n`;

                    // Add promotion SMS status to admin response
                    if (promotionMessage.success) {
                        successMessage += `📩 Admin promotion SMS sent successfully`;
                        logger.info(`📩 Admin promotion SMS delivered to ${adminName} (${cleanPhone}): ${promotionMessage.sid}`);
                    } else {
                        successMessage += `⚠️ Admin promotion SMS failed: ${promotionMessage.error}`;
                        logger.warn(`📩 Admin promotion SMS failed to ${adminName} (${cleanPhone}): ${promotionMessage.error}`);
                    }

                    return successMessage;

                } catch (promotionError) {
                    logger.error(`❌ Failed to promote member to admin: ${promotionError.message}`);
                    return `❌ Failed to promote ${existingMember.name} to administrator.\n\n💡 Error: ${promotionError.message}`;
                }
            }
        } else {
            // Person doesn't exist - create new admin member
            try {
                // Get the leadership group for new admin
                const leadershipGroup = await this.dbManager.getGroupByName("Church Leadership");
                if (!leadershipGroup) {
                    return "❌ Church Leadership group not found. Run setup.js to initialize groups.";
                }

                // Create new admin member
                const newAdmin = await this.dbManager.createMember({
                    phoneNumber: cleanPhone,
                    name: adminName,
                    isAdmin: true,
                    active: true,
                    messageCount: 0,
                    lastActivity: new Date(),
                    groups: [{
                        groupId: leadershipGroup._id,
                        joinedAt: new Date()
                    }]
                });

                // ✨ Send admin welcome SMS to new admin
                const welcomeMessage = await this.sendAdminWelcomeSMS(cleanPhone, adminName, admin.name);

                // Log the new admin creation for audit trail
                await this.dbManager.recordAnalytic('new_admin_created', 1, 
                    `Created by: ${admin.name}, New Admin: ${adminName} (${cleanPhone}), Welcome SMS: ${welcomeMessage.success ? 'Sent' : 'Failed'}`);

                const durationMs = Date.now() - startTime;
                await this.recordPerformanceMetric('admin_creation', durationMs, true);

                logger.info(`✅ Admin ${admin.name} created new administrator: ${adminName} (${cleanPhone})`);

                // Get updated counts
                const totalMembers = await this.dbManager.getAllActiveMembers();
                const adminCount = totalMembers.filter(m => m.isAdmin).length;

                let successMessage = `🔑 NEW ADMIN CREATED SUCCESSFULLY!\n\n`;
                successMessage += `👤 Name: ${adminName}\n`;
                successMessage += `📱 Phone: ${cleanPhone}\n`;
                successMessage += `🔑 Status: Administrator (NEW)\n`;
                successMessage += `🏛️ Group: Church Leadership\n`;
                successMessage += `📊 Total admins: ${adminCount}\n`;
                successMessage += `📊 Total members: ${totalMembers.length}\n\n`;
                successMessage += `✅ FULL ADMIN PRIVILEGES GRANTED:\n`;
                successMessage += `• ADD - Add new congregation members\n`;
                successMessage += `• REMOVE - Remove members from system\n`;
                successMessage += `• ADMIN - Manage administrator privileges\n`;
                successMessage += `• WIPE - Emergency database wipe\n`;
                successMessage += `• CLEANUP - Database maintenance\n`;
                successMessage += `• Access to all admin endpoints\n\n`;

                // Add welcome SMS status to admin response
                if (welcomeMessage.success) {
                    successMessage += `📩 Admin welcome SMS sent successfully`;
                    logger.info(`📩 Admin welcome SMS delivered to ${adminName} (${cleanPhone}): ${welcomeMessage.sid}`);
                } else {
                    successMessage += `⚠️ Admin welcome SMS failed: ${welcomeMessage.error}`;
                    logger.warn(`📩 Admin welcome SMS failed to ${adminName} (${cleanPhone}): ${welcomeMessage.error}`);
                }

                return successMessage;

            } catch (createError) {
                // Enhanced error handling for specific MongoDB errors
                if (createError.code === 11000) {
                    // Duplicate key error
                    const duplicateField = createError.keyPattern ? Object.keys(createError.keyPattern)[0] : 'phoneNumber';
                    return `❌ Phone number already exists in database!\n📱 Number: ${cleanPhone}\n💡 Use a different phone number or check existing members.`;
                } else if (createError.name === 'ValidationError') {
                    // Mongoose validation error
                    const validationErrors = Object.values(createError.errors).map(err => err.message).join(', ');
                    return `❌ Validation error: ${validationErrors}`;
                } else {
                    // Other database errors
                    logger.error(`❌ Database error creating admin: ${createError.message}`);
                    return `❌ Database error: Unable to create admin. Please try again or contact tech support.`;
                }
            }
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('admin_command', durationMs, false, error.message);
        
        logger.error(`❌ ADMIN command error: ${error.message}`);
        logger.error(`❌ Stack trace: ${error.stack}`);
        
        // Provide more specific error information
        if (error.name === 'MongoNetworkError') {
            return "❌ Database connection error. Please try again in a moment.";
        } else if (error.name === 'MongoServerError' && error.code === 11000) {
            return "❌ Admin with this phone number already exists in the system.";
        } else {
            return "❌ System error occurred while managing admin privileges.\n\n💡 Tech team has been notified.";
        }
    }
}




// ✨ NEW METHOD: Send admin promotion SMS
async sendAdminPromotionSMS(adminPhone, adminName, promoterName) {
    const startTime = Date.now();
    logger.info(`📩 Sending admin promotion SMS to: ${adminName} (${adminPhone})`);

    try {
        // Create a personalized admin promotion message
        const promotionMessage = this.createAdminPromotionMessage(adminName, promoterName);
        
        // Send the promotion SMS
        const result = await this.sendSMS(adminPhone, promotionMessage, 2); // 2 retries for admin messages
        
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('admin_promotion_sms', durationMs, result.success);

        if (result.success) {
            // Log successful promotion SMS
            await this.dbManager.recordAnalytic('admin_promotion_sms_sent', 1, 
                `New Admin: ${adminName} (${adminPhone}), Promoted by: ${promoterName}`);
            
            logger.info(`✅ Admin promotion SMS sent to ${adminName}: ${result.sid}`);
            return {
                success: true,
                sid: result.sid,
                message: "Admin promotion SMS sent successfully"
            };
        } else {
            // Log failed promotion SMS
            await this.dbManager.recordAnalytic('admin_promotion_sms_failed', 1, 
                `New Admin: ${adminName} (${adminPhone}), Error: ${result.error}`);
            
            logger.error(`❌ Admin promotion SMS failed to ${adminName}: ${result.error}`);
            return {
                success: false,
                error: result.error,
                message: "Admin promotion SMS delivery failed"
            };
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('admin_promotion_sms', durationMs, false, error.message);
        
        logger.error(`❌ Admin promotion SMS system error for ${adminName}: ${error.message}`);
        return {
            success: false,
            error: error.message,
            message: "Admin promotion SMS system error"
        };
    }
}



// ✨ NEW METHOD: Send admin welcome SMS for new admin creation
async sendAdminWelcomeSMS(adminPhone, adminName, creatorName) {
    const startTime = Date.now();
    logger.info(`📩 Sending admin welcome SMS to new admin: ${adminName} (${adminPhone})`);

    try {
        // Create a personalized admin welcome message
        const welcomeMessage = this.createAdminWelcomeMessage(adminName, creatorName);
        
        // Send the welcome SMS
        const result = await this.sendSMS(adminPhone, welcomeMessage, 2); // 2 retries for admin messages
        
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('admin_welcome_sms', durationMs, result.success);

        if (result.success) {
            // Log successful welcome SMS
            await this.dbManager.recordAnalytic('admin_welcome_sms_sent', 1, 
                `New Admin: ${adminName} (${adminPhone}), Created by: ${creatorName}`);
            
            logger.info(`✅ Admin welcome SMS sent to ${adminName}: ${result.sid}`);
            return {
                success: true,
                sid: result.sid,
                message: "Admin welcome SMS sent successfully"
            };
        } else {
            // Log failed welcome SMS
            await this.dbManager.recordAnalytic('admin_welcome_sms_failed', 1, 
                `New Admin: ${adminName} (${adminPhone}), Error: ${result.error}`);
            
            logger.error(`❌ Admin welcome SMS failed to ${adminName}: ${result.error}`);
            return {
                success: false,
                error: result.error,
                message: "Admin welcome SMS delivery failed"
            };
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('admin_welcome_sms', durationMs, false, error.message);
        
        logger.error(`❌ Admin welcome SMS system error for ${adminName}: ${error.message}`);
        return {
            success: false,
            error: error.message,
            message: "Admin welcome SMS system error"
        };
    }
}



// 🔧 IMMEDIATE FIX: Replace these two methods in your app.js file
// Find these methods in your ProductionChurchSMS class and replace them

// Method 1: Replace createAdminPromotionMessage
createAdminPromotionMessage(adminName, promoterName) {
    const promotionMessage = `🔑 ADMIN PRIVILEGES GRANTED

${adminName}, you've been promoted to Church Administrator by ${promoterName}.

🔑 YOUR ADMIN COMMANDS:
• ADD +1234567890 Name (add members)
• REMOVE +1234567890 Name (remove members)  
• ADMIN +1234567890 Name (grant admin)
• WIPE CONFIRM (emergency reset)
• CLEANUP STATUS (system health)

⚠️ RESPONSIBILITIES:
• All commands are logged
• Coordinate with other admins
• Use WIPE only in emergencies

Send "HELP" for full command list.

Welcome to the admin team!
- YesuWay Church Leadership`;

    return promotionMessage;
}

// Method 2: Replace createAdminWelcomeMessage  
createAdminWelcomeMessage(adminName, creatorName) {
    const welcomeMessage = `🏛️ YESUWAY CHURCH ADMIN

Welcome ${adminName}!

${creatorName} added you as Church Administrator.

🔑 ADMIN COMMANDS:
• ADD +1234567890 Name (add members)
• REMOVE +1234567890 Name (remove members)
• ADMIN +1234567890 Name (grant admin privileges)
• WIPE CONFIRM (emergency database reset)
• CLEANUP STATUS (check system health)

⚠️ ADMIN RESPONSIBILITIES:
• Protect member privacy
• All actions are logged
• Coordinate with other admins
• WIPE destroys ALL data permanently

📱 GETTING STARTED:
1. Send "HELP" for full commands
2. Send "CLEANUP STATUS" for system check
3. Contact ${creatorName} with questions

Welcome to the admin team!
- YesuWay Church Leadership`;

    return welcomeMessage;
}





// Ultra-short promotion message (around 500 characters)
createShortAdminPromotionMessage(adminName, promoterName) {
    return `🔑 ADMIN PROMOTION

${adminName}, you're now a Church Administrator!

Promoted by: ${promoterName}

🔑 YOUR COMMANDS:
• ADD +1234567890 Name
• REMOVE +1234567890 Name  
• ADMIN +1234567890 Name
• WIPE CONFIRM
• CLEANUP STATUS

Send "HELP" for details.

Welcome to the admin team!
- YesuWay Church`;
}

// Ultra-short welcome message (around 600 characters)
createShortAdminWelcomeMessage(adminName, creatorName) {
    return `🏛️ YESUWAY CHURCH ADMIN

Welcome ${adminName}!

Added by: ${creatorName}

🔑 ADMIN COMMANDS:
• ADD +1234567890 Name
• REMOVE +1234567890 Name
• ADMIN +1234567890 Name
• WIPE CONFIRM (⚠️ DANGER)
• CLEANUP STATUS

⚠️ All actions logged
⚠️ WIPE destroys ALL data

Send "HELP" for full guide.

Welcome to leadership!
- YesuWay Church`;
}

async getCleanupStatus() {
    try {
        // Find duplicates
        const duplicates = await Member.aggregate([
            { $group: { _id: "$phoneNumber", count: { $sum: 1 }, docs: { $push: "$$ROOT" } } },
            { $match: { count: { $gt: 1 } } }
        ]);

        // Count inactive members
        const inactiveCount = await Member.countDocuments({ active: false });
        
        // Count orphaned data
        const orphanedMessages = await BroadcastMessage.countDocuments({
            fromPhone: { $nin: await Member.distinct('phoneNumber') }
        });

        let status = `🧹 DATABASE CLEANUP STATUS\n\n`;
        status += `📊 Duplicate phone numbers: ${duplicates.length}\n`;
        status += `👻 Inactive members: ${inactiveCount}\n`;
        status += `📨 Orphaned messages: ${orphanedMessages}\n\n`;

        if (duplicates.length > 0) {
            status += `⚠️ DUPLICATES FOUND:\n`;
            duplicates.slice(0, 5).forEach(dup => {
                status += `📱 ${dup._id}: ${dup.count} copies\n`;
            });
            if (duplicates.length > 5) {
                status += `... and ${duplicates.length - 5} more\n`;
            }
            status += `\n💡 Use: CLEANUP DUPLICATES to fix\n`;
        }

        if (inactiveCount > 0) {
            status += `\n👻 ${inactiveCount} inactive members taking up space\n`;
            status += `💡 Use: CLEANUP ORPHANED to remove\n`;
        }

        return status;

    } catch (error) {
        logger.error(`❌ Error getting cleanup status: ${error.message}`);
        return "❌ Error checking cleanup status";
    }
}

async cleanupDuplicates() {
    try {
        const duplicates = await Member.aggregate([
            { $group: { _id: "$phoneNumber", count: { $sum: 1 }, docs: { $push: "$$ROOT" } } },
            { $match: { count: { $gt: 1 } } }
        ]);

        if (duplicates.length === 0) {
            return "✅ No duplicate phone numbers found";
        }

        let deletedCount = 0;
        let keptCount = 0;
        let results = `🧹 CLEANING UP ${duplicates.length} DUPLICATE PHONE NUMBERS\n\n`;

        for (const duplicate of duplicates) {
            // Keep the oldest active member, or just the oldest if none are active
            const activeDocs = duplicate.docs.filter(doc => doc.active);
            const keepDoc = activeDocs.length > 0 
                ? activeDocs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0]
                : duplicate.docs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
            
            const toDelete = duplicate.docs.filter(doc => doc._id.toString() !== keepDoc._id.toString());
            
            results += `📱 ${duplicate._id}: Keeping ${keepDoc.name}, deleting ${toDelete.length}\n`;
            
            // Delete the duplicates
            for (const doc of toDelete) {
                await Member.findByIdAndDelete(doc._id);
                deletedCount++;
            }
            keptCount++;
        }

        results += `\n✅ CLEANUP COMPLETE:\n`;
        results += `🗑️ Deleted: ${deletedCount} duplicates\n`;
        results += `✅ Kept: ${keptCount} members\n`;
        results += `💡 All phone numbers are now unique`;

        await this.dbManager.recordAnalytic('duplicates_cleaned', deletedCount, `Deleted ${deletedCount} duplicates, kept ${keptCount}`);

        return results;

    } catch (error) {
        logger.error(`❌ Error cleaning duplicates: ${error.message}`);
        return `❌ Error cleaning duplicates: ${error.message}`;
    }
}

async cleanupPhone(phoneInput) {
    try {
        const cleanPhone = this.cleanPhoneNumber(phoneInput);
        if (!cleanPhone) {
            return `❌ Invalid phone number: ${phoneInput}`;
        }
        
        // Find all members with this phone (any format)
        const phoneDigits = cleanPhone.replace(/\D/g, '');
        const formats = [
            cleanPhone,
            phoneInput,
            phoneDigits,
            `+1${phoneDigits}`,
            `+${phoneDigits}`,
            `1${phoneDigits}`
        ];

        const members = await Member.find({ phoneNumber: { $in: formats } });
        
        if (members.length === 0) {
            return `❌ No members found with phone: ${cleanPhone}`;
        }

        // Delete all members with this phone
        const memberIds = members.map(m => m._id);
        const phoneNumbers = members.map(m => m.phoneNumber);

        await Member.deleteMany({ _id: { $in: memberIds } });
        await BroadcastMessage.deleteMany({ fromPhone: { $in: phoneNumbers } });
        await DeliveryLog.deleteMany({ toPhone: { $in: phoneNumbers } });

        let result = `✅ COMPLETELY REMOVED ALL DATA FOR: ${cleanPhone}\n\n`;
        result += `🗑️ Deleted members: ${members.length}\n`;
        members.forEach((member, index) => {
            const status = member.active ? 'Active' : 'Inactive';
            const admin = member.isAdmin ? ' [ADMIN]' : '';
            result += `${index + 1}. ${member.name}${admin} (${status})\n`;
        });
        result += `\n✅ Phone number ${cleanPhone} is now completely available\n`;
        result += `💡 You can now ADD a new member with this phone number`;

        return result;

    } catch (error) {
        logger.error(`❌ Error cleaning phone: ${error.message}`);
        return `❌ Error cleaning phone: ${error.message}`;
    }
}

async cleanupOrphanedData() {
    try {
        const activePhones = await Member.distinct('phoneNumber', { active: true });
        
        // Remove inactive members completely
        const inactiveResult = await Member.deleteMany({ active: false });
        
        // Remove orphaned messages
        const messagesResult = await BroadcastMessage.deleteMany({
            fromPhone: { $nin: activePhones }
        });
        
        // Remove orphaned delivery logs
        const deliveryResult = await DeliveryLog.deleteMany({
            toPhone: { $nin: activePhones }
        });

        let result = `🧹 ORPHANED DATA CLEANUP COMPLETE\n\n`;
        result += `👻 Removed inactive members: ${inactiveResult.deletedCount}\n`;
        result += `📨 Removed orphaned messages: ${messagesResult.deletedCount}\n`;
        result += `📊 Removed orphaned delivery logs: ${deliveryResult.deletedCount}\n\n`;
        result += `✅ Database is now clean and optimized`;

        return result;

    } catch (error) {
        logger.error(`❌ Error cleaning orphaned data: ${error.message}`);
        return `❌ Error cleaning orphaned data: ${error.message}`;
    }
}


async handleReactionsCommand(adminPhone, commandText) {
    const startTime = Date.now();
    logger.info(`📊 Admin REACTIONS command from ${adminPhone}: ${commandText}`);

    try {
        const admin = await this.getMemberInfo(adminPhone);
        if (!admin || !admin.isAdmin) {
            return "❌ Access denied. Only administrators can view reaction analytics.";
        }

        const parts = commandText.trim().split(/\s+/);
        const subCommand = parts[1]?.toUpperCase() || 'STATS';

        switch (subCommand) {
            case 'STATS':
            case 'ANALYTICS':
                return await this.getReactionStats();
            
            case 'SUMMARY':
            case 'GENERATE':
                return await this.forceReactionSummary();
            
            case 'RECENT':
                return await this.getRecentReactions();
            
            case 'HELP':
                return this.getReactionsHelpMessage();
            
            default:
                return `❌ Unknown reactions command: ${subCommand}\n\n📋 Available commands:\n• REACTIONS STATS - View reaction analytics\n• REACTIONS SUMMARY - Force generate summary\n• REACTIONS RECENT - View recent reactions\n• REACTIONS HELP - Show detailed help`;
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('reactions_command', durationMs, false, error.message);
        
        logger.error(`❌ REACTIONS command error: ${error.message}`);
        return "❌ Error processing reactions command. Check system logs.";
    }
}

async getReactionStats() {
    try {
        const analytics = await this.reactionSystem.getReactionAnalytics(7);
        if (!analytics) {
            return "❌ Unable to retrieve reaction analytics.";
        }

        const unprocessedCount = await MessageReaction.countDocuments({ isProcessed: false });
        const totalReactions = await MessageReaction.countDocuments({});

        let stats = `📊 REACTION ANALYTICS (7 days)\n`;
        stats += `═══════════════════════════════════\n\n`;
        stats += `📈 Total Reactions: ${analytics.totalReactions}\n`;
        stats += `👥 Unique Reactors: ${analytics.uniqueReactors}\n`;
        stats += `⏳ Pending Processing: ${unprocessedCount}\n`;
        stats += `📚 All-time Total: ${totalReactions}\n\n`;

        if (Object.keys(analytics.byType).length > 0) {
            stats += `🎭 BY REACTION TYPE:\n`;
            for (const [type, count] of Object.entries(analytics.byType)) {
                const emoji = this.reactionSystem.emojiMap[type]?.emoji || '❓';
                stats += `   ${emoji} ${type}: ${count}\n`;
            }
            stats += `\n`;
        }

        if (Object.keys(analytics.byDevice).length > 0) {
            stats += `📱 BY DEVICE TYPE:\n`;
            for (const [device, count] of Object.entries(analytics.byDevice)) {
                stats += `   📱 ${device}: ${count}\n`;
            }
        }

        stats += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
        stats += `YesuWay Church • Reaction System`;

        return stats;

    } catch (error) {
        logger.error(`❌ Error getting reaction stats: ${error.message}`);
        return "❌ Error retrieving reaction statistics.";
    }
}

async forceReactionSummary() {
    try {
        const summary = await this.reactionSystem.generateReactionSummary();
        
        if (summary) {
            return `✅ Reaction summary generated and sent to congregation.\n\n${summary.substring(0, 300)}${summary.length > 300 ? '...' : ''}`;
        } else {
            return "ℹ️ No pending reactions to summarize.";
        }

    } catch (error) {
        logger.error(`❌ Error forcing reaction summary: ${error.message}`);
        return "❌ Error generating reaction summary.";
    }
}

async getRecentReactions() {
    try {
        const recentReactions = await MessageReaction.find({})
            .populate('originalMessageId', 'originalMessage fromName sentAt')
            .sort({ createdAt: -1 })
            .limit(10);

        if (recentReactions.length === 0) {
            return "ℹ️ No recent reactions found.";
        }

        let response = `📝 RECENT REACTIONS (${recentReactions.length})\n`;
        response += `═══════════════════════════════════\n\n`;

        for (const reaction of recentReactions) {
            const messagePreview = reaction.originalMessageId.originalMessage.length > 40
                ? reaction.originalMessageId.originalMessage.substring(0, 40) + '...'
                : reaction.originalMessageId.originalMessage;

            const timeAgo = this.getTimeAgo(reaction.createdAt);
            const processed = reaction.isProcessed ? '✅' : '⏳';

            response += `${processed} ${reaction.reactionEmoji} ${reaction.reactorName}\n`;
            response += `   → "${messagePreview}"\n`;
            response += `   📅 ${timeAgo} • ${reaction.deviceType}\n\n`;
        }

        response += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
        response += `YesuWay Church • Recent Reactions`;

        return response;

    } catch (error) {
        logger.error(`❌ Error getting recent reactions: ${error.message}`);
        return "❌ Error retrieving recent reactions.";
    }
}

getReactionsHelpMessage() {
    return `📊 REACTIONS SYSTEM HELP\n` +
           `═══════════════════════════════════\n\n` +
           `🎭 WHATSAPP-STYLE REACTIONS:\n` +
           `Your church SMS system now supports WhatsApp-style reactions!\n\n` +
           `✅ HOW IT WORKS:\n` +
           `• Members react to messages (❤️, 😂, 👍, etc.)\n` +
           `• Reactions are processed silently (no spam)\n` +
           `• Daily summaries show reaction counts\n` +
           `• Professional presentation to congregation\n\n` +
           `📱 SUPPORTED REACTIONS:\n` +
           `❤️ Love • 😂 Laugh • 👍 Like • 👎 Dislike\n` +
           `😮 Wow • 😢 Sad • 😠 Angry • 🙏 Pray\n` +
           `✨ Praise • 💯 Amen\n\n` +
           `🔑 ADMIN COMMANDS:\n` +
           `• REACTIONS STATS - View analytics\n` +
           `• REACTIONS SUMMARY - Force summary\n` +
           `• REACTIONS RECENT - Recent activity\n\n` +
           `⏰ AUTOMATIC SUMMARIES:\n` +
           `• Daily at 8:00 PM\n` +
           `• After 30min conversation silence\n` +
           `• Only when reactions are pending\n\n` +
           `YesuWay Church • Advanced Reactions`;
}

getTimeAgo(date) {
    const now = new Date();
    const diffInMinutes = Math.floor((now - date) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
}


async getReactionAnalytics(days = 7) {
    try {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        const pipeline = [
            { $match: { createdAt: { $gte: since } } },
            {
                $group: {
                    _id: {
                        reactionType: '$reactionType',
                        deviceType: '$deviceType'
                    },
                    count: { $sum: 1 },
                    reactors: { $addToSet: '$reactorName' }
                }
            }
        ];

        const results = await MessageReaction.aggregate(pipeline);
        
        return {
            totalReactions: results.reduce((sum, r) => sum + r.count, 0),
            byType: results.reduce((acc, r) => {
                acc[r._id.reactionType] = (acc[r._id.reactionType] || 0) + r.count;
                return acc;
            }, {}),
            byDevice: results.reduce((acc, r) => {
                acc[r._id.deviceType] = (acc[r._id.deviceType] || 0) + r.count;
                return acc;
            }, {}),
            uniqueReactors: new Set(results.flatMap(r => r.reactors)).size
        };
    } catch (error) {
        this.logger.error(`❌ Error getting reaction analytics: ${error.message}`);
        return null;
    }
}


// 🔥 PART 3: Replace the handleIncomingMessage method in app.js with this enhanced version
async handleIncomingMessage(fromPhone, messageBody, mediaUrls) {
    logger.info(`📨 ENHANCED: Incoming message from ${fromPhone}`);

    try {
        fromPhone = this.cleanPhoneNumber(fromPhone);
        messageBody = messageBody ? messageBody.trim() : "";
        
        if (!messageBody && mediaUrls && mediaUrls.length > 0) {
            messageBody = "";
        }

        if (!messageBody && (!mediaUrls || mediaUrls.length === 0)) {
            messageBody = "[Empty message]";
        }

        const member = await this.getMemberInfo(fromPhone);

        if (!member) {
            logger.warn(`❌ Rejected message from unregistered number: ${fromPhone}`);
            await this.sendSMS(
                fromPhone,
                "You are not registered in the church SMS system. Please contact a church administrator to be added."
            );
            return null;
        }

        logger.info(`👤 Sender: ${member.name} (Admin: ${member.isAdmin})`);


// Add this command handler to your handleIncomingMessage method:
if (messageBody.toUpperCase() === 'TEST REACTIONS' && member.isAdmin) {
    try {
        const testResults = await this.testReactionSystemFull();
        let response = '🧪 REACTION SYSTEM FULL TEST\n';
        response += '═══════════════════════════════\n\n';
        
        testResults.forEach(test => {
            const icon = test.status === 'pass' ? '✅' : '❌';
            response += `${icon} ${test.test}: ${test.result || test.error}\n`;
        });
        
        response += '\n💡 Send actual reactions to test full workflow';
        return response;
    } catch (error) {
        return `❌ Test failed: ${error.message}`;
    }
}

        // ========================================================================
        // 🔥 ENHANCED REACTION DETECTION - ALWAYS FIRST PRIORITY
        // ========================================================================
        
        if (messageBody && messageBody.length > 0) {
            logger.info(`🔍 ENHANCED: Checking for reactions in: "${messageBody}"`);
            
            // 🔥 EMERGENCY PATTERN CHECK - Catch obvious reactions immediately
            const emergencyReactionPatterns = [
                /❤️.*to\s*"/i,
                /😂.*to\s*"/i,
                /👍.*to\s*"/i,
                /👎.*to\s*"/i,
                /😮.*to\s*"/i,
                /😢.*to\s*"/i,
                /😠.*to\s*"/i,
                /🙏.*to\s*"/i,
                /✨.*to\s*"/i,
                /💯.*to\s*"/i,
                /‼️.*to\s*"/i,
                /❓.*to\s*"/i,
                /Loved\s*"/i,
                /Liked\s*"/i,
                /Disliked\s*"/i,
                /Laughed at\s*"/i,
                /Emphasized\s*"/i,
                /Questioned\s*"/i
            ];

            // Quick emergency check
            let isLikelyReaction = false;
            for (const pattern of emergencyReactionPatterns) {
                if (pattern.test(messageBody)) {
                    isLikelyReaction = true;
                    logger.info(`🚨 EMERGENCY: Detected likely reaction pattern, processing silently`);
                    break;
                }
            }

            // Full reaction system processing
            if (!this.reactionSystem) {
                logger.error(`❌ CRITICAL: reactionSystem not initialized!`);
            } else {
                logger.info(`✅ Enhanced reaction system available, detecting...`);
                
                // Check if this is a reaction
                const reactionData = await this.reactionSystem.detectReaction(messageBody, fromPhone);
                
                if (reactionData) {
                    // 🔥 CRITICAL: This is a reaction - ALWAYS process silently, NEVER broadcast
                    logger.info(`🔇 ENHANCED REACTION DETECTED - PROCESSING SILENTLY (NO BROADCAST)`);
                    
                    try {
                        await this.reactionSystem.storeReaction(reactionData);
                        logger.info(`✅ ENHANCED REACTION STORED: ${member.name} ${reactionData.reactionInfo.emoji} → Message ${reactionData.originalMessage.message._id}`);
                    } catch (reactionError) {
                        logger.error(`❌ Enhanced reaction storage failed: ${reactionError.message}`);
                        logger.warn(`⚠️ REACTION STORAGE FAILED BUT STILL PROCESSING SILENTLY`);
                    }
                    
                    // Record reaction activity
                    try {
                        await this.updateMemberActivity(fromPhone);
                    } catch (activityError) {
                        logger.warn(`⚠️ Could not update member activity: ${activityError.message}`);
                    }
                    
                    // 🔥 CRITICAL: ALWAYS return null for reactions - NEVER broadcast
                    logger.info(`🔇 ENHANCED REACTION PROCESSED SILENTLY - NO MESSAGE SENT TO CONGREGATION`);
                    return null;
                    
                } else if (isLikelyReaction) {
                    // Emergency fallback - if it looks like a reaction but wasn't detected, still process silently
                    logger.warn(`⚠️ EMERGENCY FALLBACK: Message looks like reaction but wasn't detected, processing silently anyway`);
                    logger.warn(`⚠️ EMERGENCY SILENT: "${messageBody}"`);
                    return null;
                    
                } else {
                    logger.info(`ℹ️ Enhanced analysis: Not a reaction, processing as regular message`);
                }
            }
        }

        // ========================================================================
        // REGULAR MESSAGE PROCESSING (only if not a reaction)
        // ========================================================================

        // Check for HELP command
        if (messageBody.toUpperCase() === 'HELP') {
            return await this.generateHelpMessage(member);
        }

        // Check for admin commands
        if (messageBody.toUpperCase().startsWith('ADD ')) {
            return await this.handleAddMemberCommand(fromPhone, messageBody);
        }

        if (messageBody.toUpperCase().startsWith('REMOVE ')) {
            return await this.handleRemoveMemberCommand(fromPhone, messageBody);
        }

        if (messageBody.toUpperCase().startsWith('WIPE ') || messageBody.toUpperCase() === 'WIPE') {
            return await this.handleWipeCommand(fromPhone, messageBody);
        }

        if (messageBody.toUpperCase().startsWith('ADMIN ')) {
            return await this.handleAdminCommand(fromPhone, messageBody);
        }

        if (messageBody.toUpperCase().startsWith('DEMOTE ')) {
            return await this.handleDemoteCommand(fromPhone, messageBody);
        }

        if (messageBody.toUpperCase().startsWith('CLEANUP ') || messageBody.toUpperCase() === 'CLEANUP') {
            return await this.handleCleanupCommand(fromPhone, messageBody);
        }

        if (messageBody.toUpperCase().startsWith('REACTIONS')) {
            return await this.handleReactionsCommand(fromPhone, messageBody);
        }

        // 🔥 NEW: Manual reaction summary trigger for testing
        if (messageBody.toUpperCase() === 'FORCE SUMMARY' && member.isAdmin) {
            try {
                const summary = await this.reactionSystem.forceSummaryGeneration();
                if (summary) {
                    return `✅ Manual reaction summary generated and sent to congregation.\n\nPreview:\n${summary.substring(0, 200)}...`;
                } else {
                    return "ℹ️ No pending reactions to summarize.";
                }
            } catch (error) {
                logger.error(`❌ Manual summary generation failed: ${error.message}`);
                return "❌ Failed to generate manual summary. Check logs for details.";
            }
        }

        // Regular message broadcasting
        logger.info('📡 Processing enhanced message broadcast...');
        return await this.broadcastMessage(fromPhone, messageBody, mediaUrls);
        
    } catch (error) {
        logger.error(`❌ Enhanced message processing error: ${error.message}`);
        logger.error(`❌ Stack trace: ${error.stack}`);
        return "Message processing temporarily unavailable - please try again";
    }
}


// ============================================================================
// STEP 2: ADD DEBUG VERSION OF REACTION DETECTION
// ============================================================================
// Add this temporary debug method to your WhatsAppStyleReactionSystem class

async detectReaction(messageText, senderPhone) {
    const startTime = Date.now();
    
    try {
        this.logger.info(`🔍 DEBUGGING: Analyzing potential reaction from ${senderPhone}: "${messageText}"`);

        // Debug: Check if patterns are loaded
        if (!this.reactionPatterns) {
            this.logger.error(`❌ CRITICAL: reactionPatterns not initialized!`);
            return null;
        }

        this.logger.info(`🔧 Available pattern types: ${Object.keys(this.reactionPatterns).join(', ')}`);

        // Try each device type pattern
        for (const deviceType of ['iphone', 'android', 'generic']) {
            const patterns = this.reactionPatterns[deviceType];
            this.logger.info(`🔧 Testing ${deviceType} patterns (${patterns.length} patterns)`);
            
            for (let i = 0; i < patterns.length; i++) {
                const pattern = patterns[i];
                this.logger.info(`🔧 Testing pattern ${i + 1}: ${pattern}`);
                
                const match = messageText.match(pattern);
                
                if (match) {
                    this.logger.info(`✅ PATTERN MATCH FOUND! Device: ${deviceType}, Pattern: ${i + 1}`);
                    this.logger.info(`✅ Match groups: ${JSON.stringify(match)}`);
                    
                    const reaction = await this.processReactionMatch(
                        match, deviceType, messageText, senderPhone
                    );
                    
                    if (reaction) {
                        const durationMs = Date.now() - startTime;
                        await this.smsSystem.recordPerformanceMetric(
                            'reaction_detection', durationMs, true
                        );
                        
                        this.logger.info(`🎉 REACTION SUCCESSFULLY DETECTED AND PROCESSED!`);
                        return reaction;
                    } else {
                        this.logger.warn(`⚠️ Pattern matched but reaction processing failed`);
                    }
                } else {
                    this.logger.info(`ℹ️ Pattern ${i + 1} no match`);
                }
            }
        }

        // No reaction pattern matched
        this.logger.info(`ℹ️ No reaction pattern detected in: "${messageText}"`);
        this.logger.info(`💡 For manual testing, try: ❤️ "test message"`);
        return null;

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.smsSystem.recordPerformanceMetric(
            'reaction_detection', durationMs, false, error.message
        );
        
        this.logger.error(`❌ Reaction detection error: ${error.message}`);
        this.logger.error(`❌ Stack trace: ${error.stack}`);
        return null;
    }
}

    // ========================================================================
    // ADMIN REACTIONS COMMAND
    // ========================================================================
    
async handleReactionsCommand(adminPhone, commandText) {
    const startTime = Date.now();
    logger.info(`📊 ENHANCED Admin REACTIONS command from ${adminPhone}: ${commandText}`);

    try {
        const admin = await this.getMemberInfo(adminPhone);
        if (!admin || !admin.isAdmin) {
            return "❌ Access denied. Only administrators can view reaction analytics.";
        }

        const parts = commandText.trim().split(/\s+/);
        const subCommand = parts[1]?.toUpperCase() || 'STATS';

        switch (subCommand) {
            case 'STATS':
            case 'ANALYTICS':
                return await this.getEnhancedReactionStats();
            
            case 'SUMMARY':
            case 'GENERATE':
            case 'FORCE':
                return await this.forceEnhancedReactionSummary();
            
            case 'RECENT':
                return await this.getEnhancedRecentReactions();
            
            case 'DEBUG':
                return await this.getReactionDebugInfo();
            
            case 'TEST':
                return await this.testReactionDetection();
            
            case 'HELP':
                return this.getEnhancedReactionsHelp();
            
            default:
                return `❌ Unknown reactions command: ${subCommand}\n\n📋 Available commands:\n• REACTIONS STATS - View reaction analytics\n• REACTIONS SUMMARY - Force generate summary\n• REACTIONS RECENT - View recent reactions\n• REACTIONS DEBUG - System debug info\n• REACTIONS TEST - Test reaction detection\n• REACTIONS HELP - Show detailed help`;
        }

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('reactions_command', durationMs, false, error.message);
        
        logger.error(`❌ ENHANCED REACTIONS command error: ${error.message}`);
        return "❌ Error processing reactions command. Check system logs.";
    }
}



async getEnhancedReactionStats() {
    try {
        const analytics = await this.reactionSystem.getReactionAnalytics(7);
        if (!analytics) {
            return "❌ Unable to retrieve reaction analytics.";
        }

        const unprocessedCount = await MessageReaction.countDocuments({ isProcessed: false });
        const totalReactions = await MessageReaction.countDocuments({});
        const processedCount = await MessageReaction.countDocuments({ isProcessed: true });

        let stats = `📊 ENHANCED REACTION ANALYTICS (7 days)\n`;
        stats += `═══════════════════════════════════════════\n\n`;
        stats += `📈 Recent Reactions: ${analytics.totalReactions}\n`;
        stats += `👥 Unique Reactors: ${analytics.uniqueReactors}\n`;
        stats += `⏳ Pending Processing: ${unprocessedCount}\n`;
        stats += `✅ Processed: ${processedCount}\n`;
        stats += `📚 All-time Total: ${totalReactions}\n\n`;

        if (Object.keys(analytics.byType).length > 0) {
            stats += `🎭 BY REACTION TYPE:\n`;
            for (const [type, count] of Object.entries(analytics.byType)) {
                const emoji = this.reactionSystem.emojiMap[type]?.emoji || '❓';
                stats += `   ${emoji} ${type}: ${count}\n`;
            }
            stats += `\n`;
        }

        if (Object.keys(analytics.byDevice).length > 0) {
            stats += `📱 BY DEVICE TYPE:\n`;
            for (const [device, count] of Object.entries(analytics.byDevice)) {
                stats += `   📱 ${device}: ${count}\n`;
            }
        }

        stats += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        stats += `YesuWay Church • Enhanced Reaction System`;

        return stats;

    } catch (error) {
        logger.error(`❌ Error getting enhanced reaction stats: ${error.message}`);
        return "❌ Error retrieving enhanced reaction statistics.";
    }
}

async forceEnhancedReactionSummary() {
    try {
        logger.info('🔧 ADMIN: Forcing enhanced reaction summary generation...');
        const summary = await this.reactionSystem.forceSummaryGeneration();
        
        if (summary) {
            return `✅ Enhanced reaction summary generated and sent to congregation.\n\nSummary preview:\n${summary.substring(0, 400)}${summary.length > 400 ? '...' : ''}`;
        } else {
            return "ℹ️ No pending reactions to summarize.";
        }

    } catch (error) {
        logger.error(`❌ Error forcing enhanced reaction summary: ${error.message}`);
        return "❌ Error generating enhanced reaction summary.";
    }
}

async getEnhancedRecentReactions() {
    try {
        const recentReactions = await MessageReaction.find({})
            .populate('originalMessageId', 'originalMessage fromName sentAt')
            .sort({ createdAt: -1 })
            .limit(15);

        if (recentReactions.length === 0) {
            return "ℹ️ No recent reactions found.";
        }

        let response = `📝 ENHANCED RECENT REACTIONS (${recentReactions.length})\n`;
        response += `═══════════════════════════════════════════\n\n`;

        for (const reaction of recentReactions) {
            const messagePreview = reaction.originalMessageId?.originalMessage?.length > 35
                ? reaction.originalMessageId.originalMessage.substring(0, 35) + '...'
                : reaction.originalMessageId?.originalMessage || 'Unknown message';

            const timeAgo = this.getTimeAgo(reaction.createdAt);
            const processed = reaction.isProcessed ? '✅' : '⏳';
            const confidence = Math.round(reaction.confidence * 100);

            response += `${processed} ${reaction.reactionEmoji} ${reaction.reactorName}\n`;
            response += `   → "${messagePreview}"\n`;
            response += `   📅 ${timeAgo} • ${reaction.deviceType} • ${confidence}% confidence\n`;
            response += `   🔧 Method: ${reaction.processingMethod}\n\n`;
        }

        response += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        response += `YesuWay Church • Enhanced Recent Reactions`;

        return response;

    } catch (error) {
        logger.error(`❌ Error getting enhanced recent reactions: ${error.message}`);
        return "❌ Error retrieving enhanced recent reactions.";
    }
}

async getReactionDebugInfo() {
    try {
        const totalReactions = await MessageReaction.countDocuments({});
        const unprocessedReactions = await MessageReaction.countDocuments({ isProcessed: false });
        const processedReactions = await MessageReaction.countDocuments({ isProcessed: true });
        const recentMessages = await this.dbManager.getRecentMessages(24);

        let debug = `🔧 REACTION SYSTEM DEBUG INFO\n`;
        debug += `═══════════════════════════════════════\n\n`;
        debug += `📊 DATABASE STATUS:\n`;
        debug += `   • Total reactions: ${totalReactions}\n`;
        debug += `   • Unprocessed: ${unprocessedReactions}\n`;
        debug += `   • Processed: ${processedReactions}\n`;
        debug += `   • Recent messages (24h): ${recentMessages.length}\n\n`;
        
        debug += `🔧 REACTION SYSTEM STATUS:\n`;
        debug += `   • System initialized: ${this.reactionSystem ? 'Yes' : 'No'}\n`;
        debug += `   • Scheduler active: ${schedule ? 'Yes' : 'No'}\n`;
        debug += `   • Pattern count: ${this.reactionSystem ? Object.values(this.reactionSystem.reactionPatterns).flat().length : 'N/A'}\n`;
        debug += `   • Emoji mappings: ${this.reactionSystem ? Object.keys(this.reactionSystem.emojiMap).length : 'N/A'}\n\n`;

        debug += `📱 SAMPLE TEST PATTERNS:\n`;
        debug += `   • "❤️ to "test message"" - Generic love reaction\n`;
        debug += `   • "Loved "test message"" - iPhone love reaction\n`;
        debug += `   • "Reacted ❤️ to "test message"" - Android love reaction\n`;
        debug += `   • "🙏 to "prayer request"" - Pray reaction\n\n`;

        debug += `💡 TROUBLESHOOTING:\n`;
        debug += `   • Send "FORCE SUMMARY" to manually trigger summary\n`;
        debug += `   • Check logs for detailed reaction detection info\n`;
        debug += `   • Use "REACTIONS TEST" to verify pattern matching\n\n`;

        debug += `YesuWay Church • Debug Info`;

        return debug;

    } catch (error) {
        logger.error(`❌ Error getting reaction debug info: ${error.message}`);
        return "❌ Error retrieving reaction debug information.";
    }
}

async testReactionDetection() {
    try {
        const testMessages = [
            '❤️ to "test message"',
            'Loved "hello everyone"',
            'Reacted ❤️ to "prayer request"',
            '🙏 to "sunday service"',
            'Laughed at "funny story"',
            '👍 "great sermon"'
        ];

        let testResults = `🧪 REACTION DETECTION TEST\n`;
        testResults += `═══════════════════════════════════\n\n`;

        for (const testMessage of testMessages) {
            try {
                const isReaction = await this.reactionSystem.detectReaction(testMessage, '+1234567890');
                const result = isReaction ? '✅ DETECTED' : '❌ NOT DETECTED';
                testResults += `📝 "${testMessage}"\n`;
                testResults += `   ${result}\n\n`;
            } catch (testError) {
                testResults += `📝 "${testMessage}"\n`;
                testResults += `   ❌ ERROR: ${testError.message}\n\n`;
            }
        }

        testResults += `💡 Note: Detection requires actual message matching.\n`;
        testResults += `Send real reactions to test full functionality.\n\n`;
        testResults += `YesuWay Church • Reaction Test`;

        return testResults;

    } catch (error) {
        logger.error(`❌ Error testing reaction detection: ${error.message}`);
        return "❌ Error running reaction detection test.";
    }
}

getEnhancedReactionsHelp() {
    return `📊 ENHANCED REACTIONS SYSTEM HELP\n` +
           `═══════════════════════════════════════════\n\n` +
           `🎭 ADVANCED WHATSAPP-STYLE REACTIONS:\n` +
           `Your church SMS system supports industry-grade reaction processing!\n\n` +
           `✅ HOW IT WORKS:\n` +
           `• Members react to messages with emojis or text\n` +
           `• Reactions are processed silently (no spam)\n` +
           `• Smart pattern matching for all device types\n` +
           `• Professional summaries sent to congregation\n` +
           `• Complete analytics and tracking\n\n` +
           `📱 SUPPORTED REACTIONS:\n` +
           `❤️ Love • 😂 Laugh • 👍 Like • 👎 Dislike\n` +
           `😮 Wow • 😢 Sad • 😠 Angry • 🙏 Pray\n` +
           `✨ Praise • 💯 Amen • ‼️ Emphasis • ❓ Question\n\n` +
           `🔑 ENHANCED ADMIN COMMANDS:\n` +
           `• REACTIONS STATS - Detailed analytics\n` +
           `• REACTIONS SUMMARY - Force generate summary\n` +
           `• REACTIONS RECENT - Recent activity with details\n` +
           `• REACTIONS DEBUG - System debug information\n` +
           `• REACTIONS TEST - Test pattern detection\n` +
           `• FORCE SUMMARY - Manual summary trigger\n\n` +
           `⏰ AUTOMATIC SUMMARIES:\n` +
           `• Daily at 8:00 PM\n` +
           `• After 20min conversation silence (3+ reactions)\n` +
           `• Smart timing based on activity\n\n` +
           `🔧 TROUBLESHOOTING:\n` +
           `• Use DEBUG command for system status\n` +
           `• Check logs for detailed processing info\n` +
           `• TEST command verifies pattern matching\n` +
           `• FORCE SUMMARY for manual testing\n\n` +
           `YesuWay Church • Enhanced Professional Reactions`;
}



    async getReactionStats() {
        try {
            const analytics = await this.reactionSystem.getReactionAnalytics(7);
            if (!analytics) {
                return "❌ Unable to retrieve reaction analytics.";
            }

            const unprocessedCount = await MessageReaction.countDocuments({ isProcessed: false });
            const totalReactions = await MessageReaction.countDocuments({});

            let stats = `📊 REACTION ANALYTICS (7 days)\n`;
            stats += `═══════════════════════════════════\n\n`;
            stats += `📈 Total Reactions: ${analytics.totalReactions}\n`;
            stats += `👥 Unique Reactors: ${analytics.uniqueReactors}\n`;
            stats += `⏳ Pending Processing: ${unprocessedCount}\n`;
            stats += `📚 All-time Total: ${totalReactions}\n\n`;

            if (Object.keys(analytics.byType).length > 0) {
                stats += `🎭 BY REACTION TYPE:\n`;
                for (const [type, count] of Object.entries(analytics.byType)) {
                    const emoji = this.reactionSystem.emojiMap[type] || '❓';
                    stats += `   ${emoji} ${type}: ${count}\n`;
                }
                stats += `\n`;
            }

            if (Object.keys(analytics.byDevice).length > 0) {
                stats += `📱 BY DEVICE TYPE:\n`;
                for (const [device, count] of Object.entries(analytics.byDevice)) {
                    stats += `   📱 ${device}: ${count}\n`;
                }
            }

            stats += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
            stats += `YesuWay Church • Reaction System`;

            return stats;

        } catch (error) {
            logger.error(`❌ Error getting reaction stats: ${error.message}`);
            return "❌ Error retrieving reaction statistics.";
        }
    }

    async forceReactionSummary() {
        try {
            const summary = await this.reactionSystem.generateReactionSummary();
            
            if (summary) {
                return `✅ Reaction summary generated and sent to congregation.\n\n${summary.substring(0, 300)}${summary.length > 300 ? '...' : ''}`;
            } else {
                return "ℹ️ No pending reactions to summarize.";
            }

        } catch (error) {
            logger.error(`❌ Error forcing reaction summary: ${error.message}`);
            return "❌ Error generating reaction summary.";
        }
    }

    async getRecentReactions() {
        try {
            const recentReactions = await MessageReaction.find({})
                .populate('originalMessageId', 'originalMessage fromName sentAt')
                .sort({ createdAt: -1 })
                .limit(10);

            if (recentReactions.length === 0) {
                return "ℹ️ No recent reactions found.";
            }

            let response = `📝 RECENT REACTIONS (${recentReactions.length})\n`;
            response += `═══════════════════════════════════\n\n`;

            for (const reaction of recentReactions) {
                const messagePreview = reaction.originalMessageId.originalMessage.length > 40
                    ? reaction.originalMessageId.originalMessage.substring(0, 40) + '...'
                    : reaction.originalMessageId.originalMessage;

                const timeAgo = this.getTimeAgo(reaction.createdAt);
                const processed = reaction.isProcessed ? '✅' : '⏳';

                response += `${processed} ${reaction.reactionEmoji} ${reaction.reactorName}\n`;
                response += `   → "${messagePreview}"\n`;
                response += `   📅 ${timeAgo} • ${reaction.deviceType}\n\n`;
            }

            response += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
            response += `YesuWay Church • Recent Reactions`;

            return response;

        } catch (error) {
            logger.error(`❌ Error getting recent reactions: ${error.message}`);
            return "❌ Error retrieving recent reactions.";
        }
    }

    getReactionsHelpMessage() {
        return `📊 REACTIONS SYSTEM HELP\n` +
               `═══════════════════════════════════\n\n` +
               `🎭 WHATSAPP-STYLE REACTIONS:\n` +
               `Your church SMS system now supports WhatsApp-style reactions!\n\n` +
               `✅ HOW IT WORKS:\n` +
               `• Members react to messages (❤️, 😂, 👍, etc.)\n` +
               `• Reactions are processed silently (no spam)\n` +
               `• Daily summaries show reaction counts\n` +
               `• Professional presentation to congregation\n\n` +
               `📱 SUPPORTED REACTIONS:\n` +
               `❤️ Love • 😂 Laugh • 👍 Like • 👎 Dislike\n` +
               `😮 Wow • 😢 Sad • 😠 Angry • 🙏 Pray\n` +
               `✨ Praise • 💯 Amen\n\n` +
               `🔑 ADMIN COMMANDS:\n` +
               `• REACTIONS STATS - View analytics\n` +
               `• REACTIONS SUMMARY - Force summary\n` +
               `• REACTIONS RECENT - Recent activity\n\n` +
               `⏰ AUTOMATIC SUMMARIES:\n` +
               `• Daily at 8:00 PM\n` +
               `• After 30min conversation silence\n` +
               `• Only when reactions are pending\n\n` +
               `YesuWay Church • Advanced Reactions`;
    }

    getTimeAgo(date) {
        const now = new Date();
        const diffInMinutes = Math.floor((now - date) / (1000 * 60));
        
        if (diffInMinutes < 1) return 'just now';
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
        
        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours}h ago`;
        
        const diffInDays = Math.floor(diffInHours / 24);
        return `${diffInDays}d ago`;
    }
}

async function setupProductionCongregation() {
    logger.info('🔧 Setting up production congregation...');

    try {
        if (!smsSystem.dbManager.isConnected) {
            logger.warn('❌ Database not connected - skipping congregation setup');
            return;
        }

        const congregationGroup = await smsSystem.dbManager.getGroupByName("YesuWay Congregation");
        const leadershipGroup = await smsSystem.dbManager.getGroupByName("Church Leadership");
        const mediaGroup = await smsSystem.dbManager.getGroupByName("Media Team");

        if (!congregationGroup || !leadershipGroup || !mediaGroup) {
            logger.warn('❌ Required groups not found - run setup.js first');
            return;
        }

        const adminPhone = smsSystem.cleanPhoneNumber("+14257729189");
        let admin = await smsSystem.dbManager.getMemberByPhone(adminPhone);
        
        if (!admin) {
            admin = await smsSystem.dbManager.createMember({
                phoneNumber: adminPhone,
                name: "Church Admin",
                isAdmin: true,
                active: true,
                messageCount: 0,
                groups: [{
                    groupId: leadershipGroup._id,
                    joinedAt: new Date()
                }]
            });
            logger.info(`✅ Created admin: Church Admin (${adminPhone})`);
        } else {
            logger.info(`ℹ️ Admin already exists: ${admin.name}`);
        }

        const productionMembers = [
            { phone: "+12068001141", name: "Mike", groupName: "YesuWay Congregation" },
            { phone: "+14257729189", name: "Sam", groupName: "YesuWay Congregation" },
            { phone: "+12065910943", name: "Sami", groupName: "Media Team" },
            { phone: "+12064349652", name: "Yab", groupName: "YesuWay Congregation" }
        ];

        for (const memberData of productionMembers) {
            const cleanPhone = smsSystem.cleanPhoneNumber(memberData.phone);
            let member = await smsSystem.dbManager.getMemberByPhone(cleanPhone);
            
            let targetGroup;
            switch (memberData.groupName) {
                case "YesuWay Congregation":
                    targetGroup = congregationGroup;
                    break;
                case "Church Leadership":
                    targetGroup = leadershipGroup;
                    break;
                case "Media Team":
                    targetGroup = mediaGroup;
                    break;
                default:
                    targetGroup = congregationGroup;
            }

            if (!member) {
                member = await smsSystem.dbManager.createMember({
                    phoneNumber: cleanPhone,
                    name: memberData.name,
                    isAdmin: false,
                    active: true,
                    messageCount: 0,
                    groups: [{
                        groupId: targetGroup._id,
                        joinedAt: new Date()
                    }]
                });
                logger.info(`✅ Added member: ${memberData.name} (${cleanPhone}) to ${targetGroup.name}`);
            } else {
                const isInGroup = member.groups.some(g => g.groupId.toString() === targetGroup._id.toString());
                if (!isInGroup) {
                    await smsSystem.dbManager.addMemberToGroup(member._id, targetGroup._id);
                    logger.info(`✅ Added existing member ${member.name} to ${targetGroup.name}`);
                } else {
                    logger.info(`ℹ️ Member ${member.name} already in ${targetGroup.name}`);
                }
            }
        }

        logger.info('✅ Production congregation setup completed with MongoDB');
    } catch (error) {
        logger.error(`❌ Production setup error: ${error.message}`);
    }
}

const smsSystem = new ProductionChurchSMS();

// Express Routes
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
        const fromNumber = (req.body.From || '').trim();
        const messageBody = (req.body.Body || '').trim();
        const numMedia = parseInt(req.body.NumMedia || 0);
        const messageSid = req.body.MessageSid || '';

        logger.info(`📨 [${requestId}] From: ${fromNumber}, Body: '${messageBody}', Media: ${numMedia}`);

        if (!fromNumber) {
            logger.warn(`⚠️ [${requestId}] Missing From number`);
            return res.status(200).send('OK');
        }

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

        const processAsync = async () => {
            try {
                const response = await smsSystem.handleIncomingMessage(
                    fromNumber, messageBody, mediaUrls
                );

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

        processAsync();

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
            version: "Production Church SMS System with MongoDB v4.0",
            environment: "production"
        };

        try {
            if (smsSystem.dbManager.isConnected) {
                const stats = await smsSystem.dbManager.getHealthStats();
                healthData.mongodb = {
                    status: "connected",
                    connection: smsSystem.dbManager.getConnectionStatus(),
                    ...stats
                };
            } else {
                healthData.mongodb = { status: "disconnected" };
            }
        } catch (error) {
            healthData.mongodb = { status: "error", error: error.message };
        }

        try {
            if (smsSystem.twilioClient) {
                const account = await smsSystem.twilioClient.api.accounts(config.twilio.accountSid).fetch();
                healthData.twilio = {
                    status: "connected",
                    account_status: account.status,
                    phone_number: config.twilio.phoneNumber
                };
            } else {
                healthData.twilio = { status: "development_mode" };
            }
        } catch (error) {
            healthData.twilio = { status: "error", error: error.message };
        }


        try {
            if (smsSystem.r2Client) {
                await smsSystem.r2Client.headBucket({ Bucket: config.r2.bucketName }).promise();
                healthData.r2_storage = {
                    status: "connected",
                    bucket: config.r2.bucketName
                };
            } else {
                healthData.r2_storage = { status: "development_mode" };
            }
        } catch (error) {
            healthData.r2_storage = { status: "error", error: error.message };
        }

        healthData.features = {
            clean_media_display: "enabled",
            manual_registration_only: "enabled",
            auto_registration: "disabled",
            mongodb_storage: "enabled",
            admin_commands: "disabled"
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
        let stats = {
            activeMemberCount: 0,
            recentMessages24h: 0,
            processedMediaCount: 0
        };

        if (smsSystem.dbManager.isConnected) {
            stats = await smsSystem.dbManager.getHealthStats();
        }

        const homePageContent = `
🏛️ YesuWay Church SMS Broadcasting System
📅 Production Environment - ${new Date().toLocaleString()}

🚀 PRODUCTION STATUS: MONGODB ACTIVE

📊 LIVE STATISTICS:
✅ Registered Members: ${stats.activeMemberCount}
✅ Messages (24h): ${stats.recentMessages24h}
✅ Media Files Processed: ${stats.processedMediaCount}
✅ Church Number: ${config.twilio.phoneNumber}
✅ Database: MongoDB ${smsSystem.dbManager.isConnected ? 'Connected' : 'Disconnected'}

🗄️ MONGODB FEATURES:
✅ SCALABLE DOCUMENT STORAGE
✅ Optimized indexes for performance
✅ Automatic connection recovery
✅ Real-time analytics and metrics
✅ Transaction support for data integrity

🛡️ SECURITY FEATURES:
✅ REGISTERED MEMBERS ONLY
✅ No auto-registration
✅ Manual member management (MongoDB only)
✅ Unknown numbers rejected
✅ No SMS admin commands

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
✅ MongoDB analytics and reporting

📱 MEMBER EXPERIENCE:
• Only registered members can send
• Unknown numbers receive rejection
• Large files become clean links
• Professional presentation

💚 SERVING YOUR CONGREGATION 24/7 - PROFESSIONAL WITH MONGODB
        `;

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(homePageContent);
    } catch (error) {
        logger.error(`❌ Home page error: ${error.message}`);
        res.status(500).send(`❌ System temporarily unavailable: ${error.message}`);
    }
});

app.all('/test', async (req, res) => {
    try {
        if (req.method === 'POST') {
            const fromNumber = req.body.From || '+1234567890';
            const messageBody = req.body.Body || 'test message';

            logger.info(`🧪 Test message: ${fromNumber} -> ${messageBody}`);

            const testAsync = async () => {
                try {
                    const result = await smsSystem.handleIncomingMessage(fromNumber, messageBody, []);
                    logger.info(`🧪 Test result: ${result}`);
                } catch (error) {
                    logger.error(`🧪 Test error: ${error.message}`);
                }
            };

            testAsync();

            res.json({
                status: "✅ Test processed",
                from: fromNumber,
                body: messageBody,
                timestamp: new Date().toISOString(),
                processing: "async",
                admin_commands: "disabled",
                database: smsSystem.dbManager.isConnected ? "MongoDB Connected" : "MongoDB Disconnected"
            });
        } else {
            res.json({
                status: "✅ Test endpoint active",
                method: "GET",
                database: {
                    type: "MongoDB",
                    connected: smsSystem.dbManager.isConnected,
                    status: smsSystem.dbManager.getConnectionStatus()
                },
                features: [
                    "Clean media display", 
                    "Manual registration only", 
                    "No admin commands",
                    "MongoDB storage",
                    "Scalable performance"
                ],
                test_examples: [
                    "curl -X POST /test -d 'From=+1234567890&Body=Test message'",
                    "curl -X POST /test -d 'From=+1234567890&Body=Hello everyone'"
                ],
                usage: "POST with From and Body parameters to test message broadcasting"
            });
        }
    } catch (error) {
        logger.error(`❌ Test endpoint error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/debug', async (req, res) => {
    try {
        if (!smsSystem.dbManager.isConnected) {
            return res.status(503).json({
                error: "Database not connected",
                timestamp: new Date().toISOString(),
                suggestion: "Check MongoDB connection status"
            });
        }

        const members = await smsSystem.dbManager.getAllActiveMembers();
        const recentMessages = await smsSystem.dbManager.getRecentMessages(24);
        const deliveryStats = await smsSystem.dbManager.getDeliveryStats();
        const healthStats = await smsSystem.dbManager.getHealthStats();
        
        res.json({
            timestamp: new Date().toISOString(),
            system_status: {
                twilio_connected: smsSystem.twilioClient !== null,
                r2_connected: smsSystem.r2Client !== null,
                mongodb_connected: smsSystem.dbManager.isConnected,
                database_connection: smsSystem.dbManager.getConnectionStatus()
            },
            congregation: {
                total_members: members.length,
                active_members: members.filter(m => m.active).length,
                admin_members: members.filter(m => m.isAdmin).length,
                members: members.map(m => ({
                    name: m.name,
                    phone: m.phoneNumber,
                    isAdmin: m.isAdmin,
                    groups: m.groups.map(g => g.groupId.name || 'Unknown Group')
                }))
            },
            recent_activity: {
                recent_messages: recentMessages.map(m => ({
                    from: m.fromName,
                    message: m.originalMessage.substring(0, 100),
                    sentAt: m.sentAt,
                    hasMedia: m.hasMedia
                })),
                delivery_statistics: deliveryStats,
                health_stats: healthStats
            },
            troubleshooting: {
                common_issues: [
                    "Members not in MongoDB database",
                    "Phone numbers not properly formatted", 
                    "Twilio credentials not working",
                    "MongoDB connection issues"
                ]
            }
        });
        
    } catch (error) {
        logger.error(`❌ Debug endpoint error: ${error.message}`);
        res.status(500).json({ 
            error: error.message,
            timestamp: new Date().toISOString(),
            suggestion: "Database may not be connected. Check MongoDB status and try /setup endpoint."
        });
    }
});

app.post('/setup', async (req, res) => {
    try {
        logger.info('🔧 Manual database setup/recovery initiated...');
        
        if (!smsSystem.dbManager.isConnected) {
            return res.status(503).json({
                status: "❌ Setup failed",
                error: "MongoDB not connected",
                timestamp: new Date().toISOString(),
                suggestion: "Check MongoDB connection and try again"
            });
        }

        await setupProductionCongregation();
        
        const stats = await smsSystem.dbManager.getHealthStats();
        const groups = await smsSystem.dbManager.getAllGroups();
        
        logger.info('✅ Manual setup completed successfully');
        
        res.json({
            status: "✅ Database setup completed",
            timestamp: new Date().toISOString(),
            results: {
                groups_available: groups.length,
                members_active: stats.activeMemberCount,
                database_connected: smsSystem.dbManager.isConnected,
                connection_status: smsSystem.dbManager.getConnectionStatus()
            },
            next_steps: [
                "Test sending a message to your church number",
                "Check /debug endpoint to verify members",
                "Monitor logs for message processing"
            ]
        });
        
    } catch (error) {
        logger.error(`❌ Manual setup failed: ${error.message}`);
        res.status(500).json({
            status: "❌ Setup failed",
            error: error.message,
            timestamp: new Date().toISOString(),
            suggestion: "Check logs for detailed error information"
        });
    }
});

app.get('/analytics', async (req, res) => {
    try {
        if (!smsSystem.dbManager.isConnected) {
            return res.status(503).json({
                error: "Database not connected",
                timestamp: new Date().toISOString()
            });
        }

        const healthStats = await smsSystem.dbManager.getHealthStats();
        const deliveryStats = await smsSystem.dbManager.getDeliveryStats();
        
        const performanceData = await PerformanceMetrics.find({
            recordedAt: { 
                $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) 
            }
        }).sort({ recordedAt: -1 }).limit(100);

        const analyticsData = await SystemAnalytics.find({
            recordedAt: { 
                $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) 
            }
        }).sort({ recordedAt: -1 }).limit(50);

        res.json({
            timestamp: new Date().toISOString(),
            health_stats: healthStats,
            delivery_stats: deliveryStats,
            performance_metrics: {
                total_entries: performanceData.length,
                operations: performanceData.reduce((acc, metric) => {
                    acc[metric.operationType] = (acc[metric.operationType] || 0) + 1;
                    return acc;
                }, {}),
                average_durations: performanceData.reduce((acc, metric) => {
                    if (!acc[metric.operationType]) {
                        acc[metric.operationType] = [];
                    }
                    acc[metric.operationType].push(metric.operationDurationMs);
                    return acc;
                }, {})
            },
            system_analytics: analyticsData.map(a => ({
                metric: a.metricName,
                value: a.metricValue,
                metadata: a.metricMetadata,
                recorded: a.recordedAt
            }))
        });

    } catch (error) {
        logger.error(`❌ Analytics endpoint error: ${error.message}`);
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ADD THESE ROUTES TO YOUR EXPRESS APP IN app.js (after existing routes, before error handlers)

// Serve local media files (fallback when R2 is unavailable)
app.get('/media/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const path = require('path');
        const fs = require('fs').promises;
        
        // Security: prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        const mediaDir = path.join(process.cwd(), 'temp_media');
        const filePath = path.join(mediaDir, filename);
        
        try {
            // Check if file exists
            await fs.access(filePath);
            
            // Get file stats and mime type
            const stats = await fs.stat(filePath);
            const mimeType = require('mime-types').lookup(filename) || 'application/octet-stream';
            
            // Set appropriate headers
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Length', stats.size);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
            res.setHeader('Content-Disposition', 'inline');
            
            // Stream the file
            const fileStream = require('fs').createReadStream(filePath);
            fileStream.pipe(res);
            
            logger.info(`📎 Served local media file: ${filename} (${stats.size} bytes)`);
            
        } catch (fileError) {
            logger.warn(`❌ Media file not found: ${filename}`);
            res.status(404).json({ 
                error: 'Media file not found',
                filename: filename,
                suggestion: 'File may have been moved or deleted'
            });
        }
        
    } catch (error) {
        logger.error(`❌ Error serving media file: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Media file info endpoint (for debugging)
app.get('/media-info/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const path = require('path');
        const fs = require('fs').promises;
        
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        const mediaDir = path.join(process.cwd(), 'temp_media');
        const filePath = path.join(mediaDir, filename);
        
        try {
            const stats = await fs.stat(filePath);
            const mimeType = require('mime-types').lookup(filename) || 'application/octet-stream';
            
            res.json({
                filename: filename,
                size: stats.size,
                mimeType: mimeType,
                created: stats.birthtime,
                modified: stats.mtime,
                accessible: true
            });
            
        } catch (fileError) {
            res.status(404).json({
                filename: filename,
                accessible: false,
                error: 'File not found'
            });
        }
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handlers
app.use((req, res) => {
    res.status(404).json({
        error: "Endpoint not found",
        status: "production",
        database: "MongoDB",
        available_endpoints: ["/", "/health", "/webhook/sms", "/test", "/debug", "/analytics"]
    });
});

app.use((error, req, res, next) => {
    logger.error(`❌ Internal server error: ${error.message}`);
    res.status(500).json({
        error: "Internal server error",
        status: "production",
        database: "MongoDB"
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    if (smsSystem.dbManager.isConnected) {
        await smsSystem.dbManager.disconnect();
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    if (smsSystem.dbManager.isConnected) {
        await smsSystem.dbManager.disconnect();
    }
    process.exit(0);
});

// Start the server with enhanced error handling
async function startServer() {
    logger.info('STARTING: Production Church SMS System with MongoDB...');
    logger.info('INFO: Professional church communication platform');
    logger.info('INFO: Clean media presentation enabled');
    logger.info('INFO: Manual registration only - secure access');
    logger.info('INFO: Auto-registration disabled');
    logger.info('INFO: SMS admin commands disabled');
    logger.info('INFO: MongoDB database for scalable performance');

    const validationWarnings = [];
    
    if (!smsSystem.isValidTwilioCredentials()) {
        validationWarnings.push('Twilio credentials not configured - SMS functionality will be mocked');
    }
    
    if (!smsSystem.isValidR2Credentials()) {
        validationWarnings.push('R2 credentials not configured - media storage will use local fallback');
    }

    if (!config.mongodb.uri && config.mongodb.host === 'localhost') {
        validationWarnings.push('MongoDB credentials not configured - using localhost defaults');
    }

    if (validationWarnings.length > 0) {
        logger.warn('⚠️ CONFIGURATION WARNINGS:');
        validationWarnings.forEach(warning => logger.warn(`   • ${warning}`));
        logger.info('');
        logger.info('💡 TO FIX: Set environment variables for production use:');
        logger.info('   • MongoDB Configuration:');
        logger.info('     MONGODB_URI=mongodb://username:password@host:port/database');
        logger.info('     OR individual components:');
        logger.info('     MONGODB_HOST=your-mongodb-host');
        logger.info('     MONGODB_PORT=27017');
        logger.info('     MONGODB_DATABASE=yesuway_church');
        logger.info('     MONGODB_USERNAME=your_username');
        logger.info('     MONGODB_PASSWORD=your_password');
        logger.info('   • TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
        logger.info('   • TWILIO_AUTH_TOKEN=your_auth_token');
        logger.info('   • TWILIO_PHONE_NUMBER=+1234567890');
        logger.info('   • R2_ACCESS_KEY_ID=your_r2_access_key');
        logger.info('   • R2_SECRET_ACCESS_KEY=your_r2_secret_key');
        logger.info('   • R2_ENDPOINT_URL=https://account.r2.cloudflarestorage.com');
        logger.info('');
    }

    try {
        await setupProductionCongregation();
    } catch (error) {
        logger.error(`❌ Congregation setup failed: ${error.message}`);
    }

    logger.info('SUCCESS: Production Church SMS System: READY FOR MESSAGING');
    logger.info('INFO: Webhook endpoint: /webhook/sms');
    logger.info('INFO: Health monitoring: /health');
    logger.info('INFO: System overview: /');
    logger.info('INFO: Test endpoint: /test');
    logger.info('INFO: Debug endpoint: /debug');
    logger.info('INFO: Analytics endpoint: /analytics');
    logger.info('INFO: Enterprise-grade system active');
    logger.info('INFO: Clean media display enabled');
    logger.info('INFO: Secure member registration (MongoDB only)');
    logger.info('INFO: Admin commands completely removed');
    logger.info('INFO: Serving YesuWay Church congregation');
    logger.info('INFO: MongoDB database for scalable performance');

    const server = app.listen(config.port, '0.0.0.0', () => {
        logger.info(`🚀 Production Church SMS System running on port ${config.port}`);
        
        if (smsSystem.twilioClient && smsSystem.r2Client && smsSystem.dbManager.isConnected) {
            logger.info('💚 FULLY OPERATIONAL: All services connected and ready');
        } else {
            logger.info('🛠️ PARTIAL OPERATION: Some services in mock mode');
            logger.info('   Set production credentials to enable full functionality');
        }
        
        logger.info('💚 SERVING YOUR CONGREGATION 24/7 - PROFESSIONAL WITH MONGODB');
    });

    const gracefulShutdown = async (signal) => {
        logger.info(`${signal} received, shutting down gracefully`);
        server.close(async () => {
            if (smsSystem.dbManager.isConnected) {
                await smsSystem.dbManager.disconnect();
            }
            logger.info('Server closed successfully');
            process.exit(0);
        });
        
        setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception:', error);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        if (config.environment === 'production') {
            logger.warn('Continuing operation despite unhandled rejection');
        } else {
            gracefulShutdown('UNHANDLED_REJECTION');
        }
    });
}

(async () => {
    try {
        logger.info('SUCCESS: Production system with MongoDB initialized');
        await startServer();
        
    } catch (error) {
        logger.error(`❌ Critical startup failure: ${error.message}`);
        logger.error('Stack trace:', error.stack);
        
        if (config.environment === 'production') {
            logger.warn('🔄 Attempting to continue with limited functionality...');
            try {
                app.listen(config.port, '0.0.0.0', () => {
                    logger.info(`🚨 Emergency mode: Server running on port ${config.port}`);
                    logger.warn('⚠️ Limited functionality due to initialization errors');
                });
            } catch (emergencyError) {
                logger.error(`❌ Emergency startup also failed: ${emergencyError.message}`);
                process.exit(1);
            }
        } else {
            process.exit(1);
        }
    }
})();

module.exports = app;