const crypto = require('crypto');
const schedule = require('node-schedule');
const mongoose = require('mongoose');
const { Schema } = mongoose;


// Add this to your models.js file - Enhanced Message Reactions Schema
const messageReactionSchema = new Schema({
    originalMessageId: {
        type: Schema.Types.ObjectId,
        ref: 'BroadcastMessage',
        required: true,
        index: true
    },
    originalMessageText: {
        type: String,
        required: true,
        index: 'text' // Text search index for fuzzy matching
    },
    originalMessageHash: {
        type: String,
        required: true,
        index: true // Fast exact matching
    },
    reactorPhone: {
        type: String,
        required: true,
        index: true
    },
    reactorName: {
        type: String,
        required: true
    },
    reactionType: {
        type: String,
        enum: ['love', 'laugh', 'like', 'dislike', 'surprise', 'sad', 'angry', 'praise', 'amen', 'pray', 'emphasis', 'question'],
        required: true,
        index: true
    },
    reactionEmoji: {
        type: String,
        required: true
    },
    originalReactionText: {
        type: String,
        required: true // Store the exact reaction text received
    },
    deviceType: {
        type: String,
        enum: ['iphone', 'android', 'generic'],
        default: 'generic'
    },
    processingMethod: {
        type: String,
        enum: ['exact_match', 'fuzzy_match', 'keyword_match'],
        required: true
    },
    confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 1.0 // Confidence in the reaction match
    },
    isProcessed: {
        type: Boolean,
        default: false,
        index: true
    },
    includedInSummary: {
        type: Boolean,
        default: false,
        index: true
    }
}, {
    timestamps: true,
    collection: 'message_reactions'
});

// Enhanced compound indexes for better performance
messageReactionSchema.index({ originalMessageId: 1, reactionType: 1 });
messageReactionSchema.index({ originalMessageHash: 1, createdAt: -1 });
messageReactionSchema.index({ isProcessed: 1, createdAt: -1 });
messageReactionSchema.index({ reactorPhone: 1, createdAt: -1 });
messageReactionSchema.index({ processingMethod: 1, confidence: -1 });

const MessageReaction = mongoose.model('MessageReaction', messageReactionSchema);
// ============================================================================
// PRODUCTION REACTION DETECTION ENGINE
// ============================================================================

class WhatsAppStyleReactionSystem {
    constructor(smsSystem, logger) {
        this.smsSystem = smsSystem;
        this.logger = logger;
        
        // WhatsApp-style reaction patterns (production-tested)
        this.reactionPatterns = {
            // iPhone patterns (iOS 15+)
            iphone: [
                /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned)\s+"(.+)"$/,
                /^(❤️|👍|👎|😂|‼️|❓)\s+"(.+)"$/,
                /^Reacted\s+(❤️|👍|👎|😂|‼️|❓)\s+to\s+"(.+)"$/
            ],
            
            // Android patterns (RCS/SMS)
            android: [
                /^Reacted\s+(❤️|😂|😮|😢|😠|👍|👎)\s+to\s+"(.+)"$/,
                /^(❤️|😂|😮|😢|😠|👍|👎)\s+"(.+)"$/,
                /^Reaction:\s+(❤️|😂|😮|😢|😠|👍|👎)\s+-\s+"(.+)"$/
            ],
            
            // Generic/fallback patterns
            generic: [
                /^(❤️|😂|😮|😢|😠|👍|👎|🙏|✨|💯)\s*(.+)$/,
                /^Reacted\s+(.+)\s+to\s+"(.+)"$/,
                /^(.+)\s+reaction:\s+"(.+)"$/
            ]
        };

        // Emoji to reaction type mapping
        this.emojiMap = {
            '❤️': { type: 'love', name: 'Love' },
            '😍': { type: 'love', name: 'Love' },
            '😂': { type: 'laugh', name: 'Laugh' },
            '🤣': { type: 'laugh', name: 'Laugh' },
            '👍': { type: 'like', name: 'Like' },
            '👎': { type: 'dislike', name: 'Dislike' },
            '😮': { type: 'surprise', name: 'Wow' },
            '😯': { type: 'surprise', name: 'Wow' },
            '😢': { type: 'sad', name: 'Sad' },
            '😭': { type: 'sad', name: 'Sad' },
            '😠': { type: 'angry', name: 'Angry' },
            '😡': { type: 'angry', name: 'Angry' },
            '🙏': { type: 'pray', name: 'Pray' },
            '✨': { type: 'praise', name: 'Praise' },
            '💯': { type: 'amen', name: 'Amen' },
            '‼️': { type: 'surprise', name: 'Wow' },
            '❓': { type: 'surprise', name: 'Question' }
        };

        // Text reaction keywords
        this.textReactionMap = {
            'loved': { type: 'love', emoji: '❤️' },
            'liked': { type: 'like', emoji: '👍' },
            'disliked': { type: 'dislike', emoji: '👎' },
            'laughed at': { type: 'laugh', emoji: '😂' },
            'emphasized': { type: 'praise', emoji: '✨' },
            'questioned': { type: 'surprise', emoji: '❓' },
            'amen': { type: 'amen', emoji: '💯' },
            'praise': { type: 'praise', emoji: '✨' },
            'pray': { type: 'pray', emoji: '🙏' }
        };

        this.setupReactionScheduler();
        this.logger.info('✅ WhatsApp-style reaction system initialized');
    }

    // ========================================================================
    // CORE REACTION DETECTION
    // ========================================================================

    async detectReaction(messageText, senderPhone) {
        const startTime = Date.now();
        
        try {
            this.logger.info(`🔍 Analyzing potential reaction from ${senderPhone}: "${messageText}"`);

            // Try each device type pattern
            for (const deviceType of ['iphone', 'android', 'generic']) {
                const patterns = this.reactionPatterns[deviceType];
                
                for (const pattern of patterns) {
                    const match = messageText.match(pattern);
                    
                    if (match) {
                        const reaction = await this.processReactionMatch(
                            match, deviceType, messageText, senderPhone
                        );
                        
                        if (reaction) {
                            const durationMs = Date.now() - startTime;
                            await this.smsSystem.recordPerformanceMetric(
                                'reaction_detection', durationMs, true
                            );
                            
                            return reaction;
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
            return null;
        }
    }

    async processReactionMatch(match, deviceType, originalText, senderPhone) {
        try {
            let reactionIdentifier, messageQuote;

            // Extract reaction and message based on device pattern
            if (deviceType === 'iphone') {
                reactionIdentifier = match[1];
                messageQuote = match[2];
            } else if (deviceType === 'android') {
                reactionIdentifier = match[1];
                messageQuote = match[2];
            } else { // generic
                reactionIdentifier = match[1];
                messageQuote = match[2] || match[1];
            }

            if (!messageQuote) {
                this.logger.warn(`⚠️ No message quote found in reaction: ${originalText}`);
                return null;
            }

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

    parseReactionType(identifier) {
        // Check if it's an emoji
        if (this.emojiMap[identifier]) {
            return {
                type: this.emojiMap[identifier].type,
                emoji: identifier,
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
                    emoji: emoji,
                    name: data.name
                };
            }
        }

        return null;
    }

    // ========================================================================
    // SMART MESSAGE MATCHING (WhatsApp-like)
    // ========================================================================

    async findOriginalMessage(messageQuote) {
        try {
            // Clean the quote for better matching
            const cleanQuote = this.cleanMessageForMatching(messageQuote);
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
                
                // Consider it a match if similarity > 80%
                if (similarity > 0.8 && similarity > bestScore) {
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
            if (cleanQuote.length < 30) {
                const keywords = cleanQuote.split(' ').filter(word => word.length > 3);
                
                for (const message of recentMessages) {
                    const cleanMessage = this.cleanMessageForMatching(message.originalMessage);
                    const keywordMatches = keywords.filter(keyword => 
                        cleanMessage.toLowerCase().includes(keyword.toLowerCase())
                    );
                    
                    if (keywordMatches.length === keywords.length && keywords.length > 0) {
                        this.logger.info(`✅ Keyword match found: ${keywordMatches.join(', ')}`);
                        return {
                            message,
                            matchType: 'keyword_match',
                            confidence: 0.7
                        };
                    }
                }
            }

            this.logger.warn(`⚠️ No matching message found for: "${cleanQuote}"`);
            return null;

        } catch (error) {
            this.logger.error(`❌ Error finding original message: ${error.message}`);
            return null;
        }
    }

    cleanMessageForMatching(message) {
        return message
            .replace(/[\n\r\t]/g, ' ')  // Replace line breaks with spaces
            .replace(/\s+/g, ' ')       // Collapse multiple spaces
            .replace(/['"'""`]/g, '"')  // Normalize quotes
            .replace(/[^\w\s".,!?-]/g, '') // Remove special chars except basic punctuation
            .toLowerCase()
            .trim();
    }

    generateMessageHash(message) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(message).digest('hex');
    }

    calculateSimilarity(str1, str2) {
        // Levenshtein distance-based similarity
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

    // ========================================================================
    // REACTION STORAGE & PROCESSING
    // ========================================================================

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

            // Check for duplicate reactions
            const existingReaction = await MessageReaction.findOne({
                originalMessageId: originalMessage.message._id,
                reactorPhone: reactor.phone || this.smsSystem.cleanPhoneNumber(reactor.phoneNumber),
                reactionType: reactionInfo.type
            });

            if (existingReaction) {
                this.logger.info(`ℹ️ Duplicate reaction ignored: ${reactor.name} already ${reactionInfo.name}d this message`);
                return null;
            }

            // Create reaction record
            const reaction = new MessageReaction({
                originalMessageId: originalMessage.message._id,
                originalMessageText: originalMessage.message.originalMessage,
                originalMessageHash: this.generateMessageHash(
                    this.cleanMessageForMatching(originalMessage.message.originalMessage)
                ),
                reactorPhone: reactor.phone || this.smsSystem.cleanPhoneNumber(reactor.phoneNumber),
                reactorName: reactor.name,
                reactionType: reactionInfo.type,
                reactionEmoji: reactionInfo.emoji,
                originalReactionText: originalText,
                deviceType: deviceType,
                processingMethod: originalMessage.matchType,
                confidence: confidence || 1.0,
                isProcessed: false,
                includedInSummary: false
            });

            await reaction.save();

            this.logger.info(`✅ Reaction stored: ${reactor.name} ${reactionInfo.emoji} → Message ${originalMessage.message._id}`);

            // Record analytics
            await this.smsSystem.dbManager.recordAnalytic(
                'reaction_received',
                1,
                `${reactionInfo.type} by ${reactor.name} (${deviceType}, ${originalMessage.matchType}, ${(confidence * 100).toFixed(1)}% confidence)`
            );

            return reaction;

        } catch (error) {
            this.logger.error(`❌ Error storing reaction: ${error.message}`);
            throw error;
        }
    }

    // ========================================================================
    // WHATSAPP-STYLE REACTION SUMMARIES
    // ========================================================================

    async generateReactionSummary() {
        try {
            this.logger.info('📊 Generating WhatsApp-style reaction summary...');

            // Get unprocessed reactions
            const unprocessedReactions = await MessageReaction.find({
                isProcessed: false
            }).populate('originalMessageId', 'originalMessage fromName sentAt');

            if (unprocessedReactions.length === 0) {
                this.logger.info('ℹ️ No new reactions to summarize');
                return null;
            }

            // Group reactions by original message
            const messageReactions = {};
            
            for (const reaction of unprocessedReactions) {
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

            // Generate professional summary message
            const summary = this.formatReactionSummary(messageReactions);
            
            if (summary) {
                // Mark reactions as processed
                await MessageReaction.updateMany(
                    { _id: { $in: unprocessedReactions.map(r => r._id) } },
                    { isProcessed: true, includedInSummary: true }
                );

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

        let summary = '📊 RECENT REACTIONS\n';
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
        summary += 'YesuWay Church • Reactions Summary';

        return summary;
    }

    async broadcastReactionSummary(summary) {
        try {
            // Use system user for summary broadcast
            const systemMessage = await this.smsSystem.dbManager.createBroadcastMessage({
                fromPhone: 'SYSTEM',
                fromName: 'YesuWay Church',
                originalMessage: summary,
                processedMessage: summary,
                messageType: 'text',
                hasMedia: false,
                mediaCount: 0,
                processingStatus: 'completed',
                deliveryStatus: 'pending',
                sentAt: new Date()
            });

            // Get all active members
            const recipients = await this.smsSystem.getAllActiveMembers();
            
            if (recipients.length === 0) {
                this.logger.warn('⚠️ No recipients found for reaction summary');
                return;
            }

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

            // Update message status
            await this.smsSystem.dbManager.updateBroadcastMessage(systemMessage._id, {
                deliveryStatus: 'completed'
            });

            // Record analytics
            await this.smsSystem.dbManager.recordAnalytic(
                'reaction_summary_broadcast',
                1,
                `Sent to ${deliveryStats.sent} members, ${deliveryStats.failed} failed`
            );

            this.logger.info(`📊 Reaction summary broadcast completed: ${deliveryStats.sent} sent, ${deliveryStats.failed} failed`);

        } catch (error) {
            this.logger.error(`❌ Error broadcasting reaction summary: ${error.message}`);
            throw error;
        }
    }

    // ========================================================================
    // AUTOMATED SCHEDULING (WhatsApp-style)
    // ========================================================================

    setupReactionScheduler() {
        // Daily summary at 8 PM
        schedule.scheduleJob('0 20 * * *', async () => {
            this.logger.info('⏰ Daily reaction summary triggered');
            try {
                await this.generateReactionSummary();
            } catch (error) {
                this.logger.error(`❌ Daily reaction summary failed: ${error.message}`);
            }
        });

        // Periodic check every 30 minutes for active conversations
        schedule.scheduleJob('*/30 * * * *', async () => {
            try {
                await this.checkForPeriodicSummary();
            } catch (error) {
                this.logger.error(`❌ Periodic reaction check failed: ${error.message}`);
            }
        });

        this.logger.info('✅ Reaction scheduler configured');
    }

    async checkForPeriodicSummary() {
        try {
            // Check if there's been conversation silence for 30+ minutes
            const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
            
            const recentMessages = await this.smsSystem.dbManager.getRecentMessages(1);
            const lastMessage = recentMessages[0];
            
            if (lastMessage && lastMessage.sentAt < thirtyMinutesAgo) {
                // Check for unprocessed reactions
                const unprocessedCount = await MessageReaction.countDocuments({
                    isProcessed: false
                });
                
                if (unprocessedCount >= 5) { // Only if we have 5+ reactions
                    this.logger.info('⏰ Conversation silence detected with pending reactions - generating summary');
                    await this.generateReactionSummary();
                }
            }
        } catch (error) {
            this.logger.error(`❌ Error checking for periodic summary: ${error.message}`);
        }
    }

    // ========================================================================
    // ANALYTICS & MONITORING
    // ========================================================================

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
}


// Group Schema
const groupSchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    collection: 'groups'
});

// Member Schema
const memberSchema = new Schema({
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    active: {
        type: Boolean,
        default: true,
        index: true
    },
    lastActivity: {
        type: Date,
        default: Date.now
    },
    messageCount: {
        type: Number,
        default: 0
    },
    groups: [{
        groupId: {
            type: Schema.Types.ObjectId,
            ref: 'Group',
            required: true
        },
        joinedAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true,
    collection: 'members'
});

// Broadcast Message Schema
const broadcastMessageSchema = new Schema({
    fromPhone: {
        type: String,
        required: true,
        index: true
    },
    fromName: {
        type: String,
        required: true
    },
    originalMessage: {
        type: String,
        required: true
    },
    processedMessage: {
        type: String,
        required: true
    },
    messageType: {
        type: String,
        enum: ['text', 'media'],
        default: 'text'
    },
    hasMedia: {
        type: Boolean,
        default: false
    },
    mediaCount: {
        type: Number,
        default: 0
    },
    largeMediaCount: {
        type: Number,
        default: 0
    },
    processingStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'error'],
        default: 'completed'
    },
    deliveryStatus: {
        type: String,
        enum: ['pending', 'sending', 'completed', 'failed'],
        default: 'pending'
    },
    sentAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true,
    collection: 'broadcast_messages'
});

// Media File Schema
const mediaFileSchema = new Schema({
    messageId: {
        type: Schema.Types.ObjectId,
        ref: 'BroadcastMessage',
        required: true,
        index: true
    },
    originalUrl: {
        type: String,
        required: true
    },
    twilioMediaSid: {
        type: String
    },
    r2ObjectKey: {
        type: String
    },
    publicUrl: {
        type: String
    },
    cleanFilename: {
        type: String
    },
    displayName: {
        type: String
    },
    originalSize: {
        type: Number
    },
    finalSize: {
        type: Number
    },
    mimeType: {
        type: String
    },
    fileHash: {
        type: String
    },
    compressionDetected: {
        type: Boolean,
        default: false
    },
    uploadStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending',
        index: true
    },
    uploadError: {
        type: String
    },
    accessCount: {
        type: Number,
        default: 0
    },
    lastAccessed: {
        type: Date
    },
    expiresAt: {
        type: Date
    }
}, {
    timestamps: true,
    collection: 'media_files'
});

// Delivery Log Schema
const deliveryLogSchema = new Schema({
    messageId: {
        type: Schema.Types.ObjectId,
        ref: 'BroadcastMessage',
        required: true,
        index: true
    },
    memberId: {
        type: Schema.Types.ObjectId,
        ref: 'Member',
        required: true
    },
    toPhone: {
        type: String,
        required: true
    },
    deliveryMethod: {
        type: String,
        enum: ['sms', 'mms'],
        required: true
    },
    deliveryStatus: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'failed', 'undelivered'],
        default: 'pending',
        index: true
    },
    twilioMessageSid: {
        type: String
    },
    errorCode: {
        type: String
    },
    errorMessage: {
        type: String
    },
    deliveryTimeMs: {
        type: Number
    },
    retryCount: {
        type: Number,
        default: 0
    },
    deliveredAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'delivery_log'
});

// System Analytics Schema
const systemAnalyticsSchema = new Schema({
    metricName: {
        type: String,
        required: true,
        index: true
    },
    metricValue: {
        type: Number,
        required: true
    },
    metricMetadata: {
        type: String
    },
    recordedAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true,
    collection: 'system_analytics'
});

// Performance Metrics Schema
const performanceMetricsSchema = new Schema({
    operationType: {
        type: String,
        required: true,
        index: true
    },
    operationDurationMs: {
        type: Number,
        required: true
    },
    success: {
        type: Boolean,
        default: true
    },
    errorDetails: {
        type: String
    },
    recordedAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true,
    collection: 'performance_metrics'
});



// Add indexes for optimized queries
groupSchema.index({ active: 1, name: 1 });
memberSchema.index({ active: 1, phoneNumber: 1 });
memberSchema.index({ 'groups.groupId': 1 });
broadcastMessageSchema.index({ sentAt: -1 });
broadcastMessageSchema.index({ fromPhone: 1, sentAt: -1 });
deliveryLogSchema.index({ messageId: 1, deliveryStatus: 1 });
systemAnalyticsSchema.index({ metricName: 1, recordedAt: -1 });
performanceMetricsSchema.index({ operationType: 1, recordedAt: -1 });

// Create and export models
const Group = mongoose.model('Group', groupSchema);
const Member = mongoose.model('Member', memberSchema);
const BroadcastMessage = mongoose.model('BroadcastMessage', broadcastMessageSchema);
const MediaFile = mongoose.model('MediaFile', mediaFileSchema);
const DeliveryLog = mongoose.model('DeliveryLog', deliveryLogSchema);
const SystemAnalytics = mongoose.model('SystemAnalytics', systemAnalyticsSchema);
const PerformanceMetrics = mongoose.model('PerformanceMetrics', performanceMetricsSchema);

module.exports = {
    Group,
    Member,
    BroadcastMessage,
    MediaFile,
    DeliveryLog,
    SystemAnalytics,
    PerformanceMetrics,
    MessageReaction
};