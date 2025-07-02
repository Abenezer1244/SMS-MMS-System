const mongoose = require('mongoose');
const {
    Group,
    Member,
    BroadcastMessage,
    MessageReaction,
    ReactionSummary,
    MediaFile,
    DeliveryLog,
    SystemAnalytics,
    PerformanceMetrics
} = require('./models');

class MongoDBManager {
    constructor(logger) {
        this.logger = logger;
        this.isConnected = false;
        this.connectionRetries = 0;
        this.maxRetries = 5;
    }

    async connect(connectionString, options = {}) {
        // Updated connection options that are compatible with latest MongoDB driver
        const defaultOptions = {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            // Removed deprecated options:
            // - bufferCommands (now handled automatically)
            // - bufferMaxEntries (deprecated)
            ...options
        };

        try {
            // Set Mongoose to use strict mode for queries
            mongoose.set('strictQuery', false);
            
            await mongoose.connect(connectionString, defaultOptions);
            this.isConnected = true;
            this.connectionRetries = 0;
            this.logger.info('✅ MongoDB connected successfully');
            
            // Setup connection event handlers
            this.setupEventHandlers();
            
            return true;
        } catch (error) {
            this.connectionRetries++;
            this.logger.error(`❌ MongoDB connection failed (attempt ${this.connectionRetries}/${this.maxRetries}): ${error.message}`);
            
            if (this.connectionRetries < this.maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, this.connectionRetries), 30000);
                this.logger.info(`🔄 Retrying connection in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.connect(connectionString, options);
            }
            
            throw error;
        }
    }

    setupEventHandlers() {
        mongoose.connection.on('error', (error) => {
            this.logger.error(`❌ MongoDB connection error: ${error.message}`);
            this.isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
            this.logger.warn('⚠️ MongoDB disconnected');
            this.isConnected = false;
        });

        mongoose.connection.on('reconnected', () => {
            this.logger.info('✅ MongoDB reconnected');
            this.isConnected = true;
        });
    }

    async disconnect() {
        try {
            await mongoose.disconnect();
            this.isConnected = false;
            this.logger.info('✅ MongoDB disconnected gracefully');
        } catch (error) {
            this.logger.error(`❌ Error disconnecting from MongoDB: ${error.message}`);
        }
    }

    // Member Operations
    async getMemberByPhone(phoneNumber) {
        try {
            return await Member.findOne({ 
                phoneNumber: phoneNumber, 
                active: true 
            }).populate('groups.groupId', 'name description');
        } catch (error) {
            this.logger.error(`❌ Error getting member by phone: ${error.message}`);
            return null;
        }
    }

    async getAllActiveMembers(excludePhone = null) {
        try {
            const filter = { active: true };
            if (excludePhone) {
                filter.phoneNumber = { $ne: excludePhone };
            }

            return await Member.find(filter)
                .populate('groups.groupId', 'name description')
                .sort({ name: 1 });
        } catch (error) {
            this.logger.error(`❌ Error getting active members: ${error.message}`);
            return [];
        }
    }

    async createMember(memberData) {
        try {
            const member = new Member(memberData);
            return await member.save();
        } catch (error) {
            this.logger.error(`❌ Error creating member: ${error.message}`);
            throw error;
        }
    }

    async updateMemberActivity(phoneNumber) {
        try {
            return await Member.findOneAndUpdate(
                { phoneNumber: phoneNumber, active: true },
                { 
                    lastActivity: new Date(),
                    $inc: { messageCount: 1 }
                },
                { new: true }
            );
        } catch (error) {
            this.logger.error(`❌ Error updating member activity: ${error.message}`);
            return null;
        }
    }

    async addMemberToGroup(memberId, groupId) {
        try {
            return await Member.findByIdAndUpdate(
                memberId,
                {
                    $addToSet: {
                        groups: {
                            groupId: groupId,
                            joinedAt: new Date()
                        }
                    }
                },
                { new: true }
            );
        } catch (error) {
            this.logger.error(`❌ Error adding member to group: ${error.message}`);
            throw error;
        }
    }

    // Group Operations
    async getAllGroups() {
        try {
            return await Group.find({ active: true }).sort({ name: 1 });
        } catch (error) {
            this.logger.error(`❌ Error getting groups: ${error.message}`);
            return [];
        }
    }

    async createGroup(name, description) {
        try {
            const group = new Group({ name, description });
            return await group.save();
        } catch (error) {
            this.logger.error(`❌ Error creating group: ${error.message}`);
            throw error;
        }
    }

    async getGroupByName(name) {
        try {
            return await Group.findOne({ name: name, active: true });
        } catch (error) {
            this.logger.error(`❌ Error getting group by name: ${error.message}`);
            return null;
        }
    }

    // Message Operations
    async createBroadcastMessage(messageData) {
        try {
            const message = new BroadcastMessage(messageData);
            return await message.save();
        } catch (error) {
            this.logger.error(`❌ Error creating broadcast message: ${error.message}`);
            throw error;
        }
    }

    async updateBroadcastMessage(messageId, updateData) {
        try {
            return await BroadcastMessage.findByIdAndUpdate(
                messageId,
                updateData,
                { new: true }
            );
        } catch (error) {
            this.logger.error(`❌ Error updating broadcast message: ${error.message}`);
            throw error;
        }
    }

    async getRecentMessages(hoursBack = 24, excludeReactions = true) {
        try {
            const sinceTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
            const filter = { sentAt: { $gt: sinceTime } };
            
            if (excludeReactions) {
                filter.isReaction = false;
            }

            return await BroadcastMessage.find(filter)
                .sort({ sentAt: -1 })
                .limit(10);
        } catch (error) {
            this.logger.error(`❌ Error getting recent messages: ${error.message}`);
            return [];
        }
    }

    async findTargetMessageForReaction(targetFragment, reactorPhone, hoursBack = 24) {
        try {
            const sinceTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
            
            const recentMessages = await BroadcastMessage.find({
                sentAt: { $gt: sinceTime },
                fromPhone: { $ne: reactorPhone },
                isReaction: false
            })
            .sort({ sentAt: -1 })
            .limit(10);

            if (recentMessages.length === 0) {
                return null;
            }

            if (!targetFragment || targetFragment.trim() === '') {
                return recentMessages[0];
            }

            // Smart matching algorithm
            let bestMatch = null;
            let bestScore = 0;
            const targetWords = new Set(targetFragment.toLowerCase().split(/\s+/));

            for (const msg of recentMessages) {
                if (!msg.originalMessage) continue;

                const messageWords = new Set(msg.originalMessage.toLowerCase().split(/\s+/));
                
                if (targetWords.size > 0 && messageWords.size > 0) {
                    const commonWords = new Set([...targetWords].filter(x => messageWords.has(x)));
                    let score = commonWords.size / Math.max(targetWords.size, messageWords.size);

                    // Boost score for exact substring matches
                    if (msg.originalMessage.toLowerCase().includes(targetFragment.toLowerCase())) {
                        score += 0.5;
                    }

                    if (score > bestScore && score > 0.3) {
                        bestScore = score;
                        bestMatch = msg;
                    }
                }
            }

            return bestMatch || recentMessages[0];
        } catch (error) {
            this.logger.error(`❌ Error finding target message for reaction: ${error.message}`);
            return null;
        }
    }

    // Reaction Operations
    async createReaction(reactionData) {
        try {
            const reaction = new MessageReaction(reactionData);
            return await reaction.save();
        } catch (error) {
            this.logger.error(`❌ Error creating reaction: ${error.message}`);
            throw error;
        }
    }

    async getUnprocessedReactions(sinceTime = null) {
        try {
            const filter = { isProcessed: false };
            if (sinceTime) {
                filter.createdAt = { $gt: sinceTime };
            }

            return await MessageReaction.find(filter)
                .populate('targetMessageId', 'fromName originalMessage sentAt')
                .sort({ createdAt: -1 });
        } catch (error) {
            this.logger.error(`❌ Error getting unprocessed reactions: ${error.message}`);
            return [];
        }
    }

    async markReactionsAsProcessed(sinceTime) {
        try {
            const filter = { isProcessed: false };
            if (sinceTime) {
                filter.createdAt = { $gt: sinceTime };
            }

            const result = await MessageReaction.updateMany(
                filter,
                { isProcessed: true }
            );

            return result.modifiedCount;
        } catch (error) {
            this.logger.error(`❌ Error marking reactions as processed: ${error.message}`);
            return 0;
        }
    }

    async createReactionSummary(summaryData) {
        try {
            const summary = new ReactionSummary(summaryData);
            return await summary.save();
        } catch (error) {
            this.logger.error(`❌ Error creating reaction summary: ${error.message}`);
            throw error;
        }
    }

    // Media Operations
    async createMediaFile(mediaData) {
        try {
            const mediaFile = new MediaFile(mediaData);
            return await mediaFile.save();
        } catch (error) {
            this.logger.error(`❌ Error creating media file: ${error.message}`);
            throw error;
        }
    }

    async updateMediaFile(mediaId, updateData) {
        try {
            return await MediaFile.findByIdAndUpdate(
                mediaId,
                updateData,
                { new: true }
            );
        } catch (error) {
            this.logger.error(`❌ Error updating media file: ${error.message}`);
            throw error;
        }
    }

    // Delivery Operations
    async createDeliveryLog(deliveryData) {
        try {
            const delivery = new DeliveryLog(deliveryData);
            return await delivery.save();
        } catch (error) {
            this.logger.error(`❌ Error creating delivery log: ${error.message}`);
            throw error;
        }
    }

    async updateDeliveryStatus(deliveryId, status, errorDetails = null) {
        try {
            const updateData = { deliveryStatus: status };
            if (errorDetails) {
                updateData.errorCode = errorDetails.code;
                updateData.errorMessage = errorDetails.message;
            }

            return await DeliveryLog.findByIdAndUpdate(
                deliveryId,
                updateData,
                { new: true }
            );
        } catch (error) {
            this.logger.error(`❌ Error updating delivery status: ${error.message}`);
            throw error;
        }
    }

    // Analytics Operations
    async recordAnalytic(metricName, metricValue, metadata = null) {
        try {
            const analytic = new SystemAnalytics({
                metricName,
                metricValue,
                metricMetadata: metadata
            });
            return await analytic.save();
        } catch (error) {
            this.logger.error(`❌ Error recording analytic: ${error.message}`);
            throw error;
        }
    }

    async recordPerformanceMetric(operationType, durationMs, success = true, errorDetails = null) {
        try {
            const metric = new PerformanceMetrics({
                operationType,
                operationDurationMs: durationMs,
                success,
                errorDetails
            });
            return await metric.save();
        } catch (error) {
            this.logger.error(`❌ Error recording performance metric: ${error.message}`);
            throw error;
        }
    }

    // Health and Statistics
    async getHealthStats() {
        try {
            const [
                activeMemberCount,
                recentMessages24h,
                recentReactions24h,
                processedMediaCount
            ] = await Promise.all([
                Member.countDocuments({ active: true }),
                BroadcastMessage.countDocuments({
                    sentAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                    isReaction: false
                }),
                MessageReaction.countDocuments({
                    createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                }),
                MediaFile.countDocuments({ uploadStatus: 'completed' })
            ]);

            return {
                activeMemberCount,
                recentMessages24h,
                recentReactions24h,
                processedMediaCount
            };
        } catch (error) {
            this.logger.error(`❌ Error getting health stats: ${error.message}`);
            return {
                activeMemberCount: 0,
                recentMessages24h: 0,
                recentReactions24h: 0,
                processedMediaCount: 0
            };
        }
    }

    async getDeliveryStats() {
        try {
            const pipeline = [
                {
                    $group: {
                        _id: '$deliveryStatus',
                        count: { $sum: 1 }
                    }
                }
            ];

            const results = await DeliveryLog.aggregate(pipeline);
            const stats = {};
            
            results.forEach(result => {
                stats[result._id] = result.count;
            });

            return stats;
        } catch (error) {
            this.logger.error(`❌ Error getting delivery stats: ${error.message}`);
            return {};
        }
    }

    // Database Maintenance
    async performMaintenance() {
        try {
            this.logger.info('🔧 Starting database maintenance...');

            // Clean up old performance metrics (keep last 30 days)
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            
            const deletedMetrics = await PerformanceMetrics.deleteMany({
                recordedAt: { $lt: thirtyDaysAgo }
            });

            // Clean up old delivery logs (keep last 90 days)
            const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            
            const deletedDeliveries = await DeliveryLog.deleteMany({
                deliveredAt: { $lt: ninetyDaysAgo }
            });

            this.logger.info(`✅ Maintenance completed: Cleaned ${deletedMetrics.deletedCount} old metrics, ${deletedDeliveries.deletedCount} old delivery logs`);

            return {
                deletedMetrics: deletedMetrics.deletedCount,
                deletedDeliveries: deletedDeliveries.deletedCount
            };
        } catch (error) {
            this.logger.error(`❌ Error during maintenance: ${error.message}`);
            throw error;
        }
    }

    // Transaction Support
    async withTransaction(callback) {
        const session = await mongoose.startSession();
        try {
            return await session.withTransaction(callback);
        } catch (error) {
            this.logger.error(`❌ Transaction error: ${error.message}`);
            throw error;
        } finally {
            await session.endSession();
        }
    }

    // Connection Status
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            readyState: mongoose.connection.readyState,
            host: mongoose.connection.host,
            port: mongoose.connection.port,
            name: mongoose.connection.name
        };
    }
}

module.exports = MongoDBManager;