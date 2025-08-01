const mongoose = require('mongoose');
const {
    Group,
    Member,
    BroadcastMessage,
    MediaFile,
    DeliveryLog,
    SystemAnalytics,
    PerformanceMetrics,
} = require('./models');

class MongoDBManager {
    constructor(logger) {
        this.logger = logger;
        this.isConnected = false;
        this.connectionRetries = 0;
        this.maxRetries = 5;
    }


    async connect(connectionString, options = {}) {
        const defaultOptions = {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            retryWrites: true,
            retryReads: true
        };

        const finalOptions = { ...defaultOptions, ...options };

        try {
            mongoose.set('strictQuery', false);
            mongoose.set('bufferCommands', false);
            
            await mongoose.connect(connectionString, finalOptions);
            this.isConnected = true;
            this.connectionRetries = 0;
            this.logger.info('✅ MongoDB connected successfully');
            
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

        mongoose.connection.on('connected', () => {
            this.logger.info('🔗 MongoDB connection established');
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
    // Add this enhanced validation method to your MongoDBManager class in database.js

async createMemberSafe(memberData) {
    try {
        // Clean phone number
        const cleanPhone = memberData.phoneNumber.replace(/\D/g, '');
        let formattedPhone;
        
        if (cleanPhone.length === 10) {
            formattedPhone = `+1${cleanPhone}`;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            formattedPhone = `+${cleanPhone}`;
        } else {
            formattedPhone = memberData.phoneNumber;
        }

        // Check for existing member first
        const existingMember = await Member.findOne({ 
            phoneNumber: formattedPhone 
        });

        if (existingMember) {
            throw new Error(`Member with phone number ${formattedPhone} already exists. Name: ${existingMember.name}, Status: ${existingMember.active ? 'Active' : 'Inactive'}`);
        }

        // Create the member with formatted phone
        const memberToCreate = {
            ...memberData,
            phoneNumber: formattedPhone
        };

        const member = new Member(memberToCreate);
        return await member.save();
        
    } catch (error) {
        this.logger.error(`❌ Error creating member: ${error.message}`);
        throw error;
    }
}

// Enhanced getMemberByPhone with better error handling
async getMemberByPhoneSafe(phoneNumber) {
    try {
        // Clean and format phone number
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        let formattedPhone;
        
        if (cleanPhone.length === 10) {
            formattedPhone = `+1${cleanPhone}`;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            formattedPhone = `+${cleanPhone}`;
        } else {
            formattedPhone = phoneNumber;
        }

        // Try exact match first
        let member = await Member.findOne({ 
            phoneNumber: formattedPhone, 
            active: true 
        }).populate('groups.groupId', 'name description');

        // If not found, try alternative formats
        if (!member) {
            const alternatives = [
                phoneNumber, // Original format
                `+1${cleanPhone}`, // Add +1 prefix
                `+${cleanPhone}`, // Add + prefix
                cleanPhone // Just digits
            ];

            for (const altPhone of alternatives) {
                member = await Member.findOne({ 
                    phoneNumber: altPhone, 
                    active: true 
                }).populate('groups.groupId', 'name description');
                
                if (member) {
                    this.logger.info(`📞 Found member with alternative phone format: ${altPhone} for query: ${phoneNumber}`);
                    break;
                }
            }
        }

        return member;
        
    } catch (error) {
        this.logger.error(`❌ Error getting member by phone: ${error.message}`);
        return null;
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

async getRecentMessages(hoursBack = 24) {
    try {
        const sinceTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
        const filter = { sentAt: { $gt: sinceTime } };

        return await BroadcastMessage.find(filter)
            .sort({ sentAt: -1 })
            .limit(50); // Increased limit for better reaction matching
    } catch (error) {
        this.logger.error(`❌ Error getting recent messages: ${error.message}`);
        return [];
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

            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            
            const deletedMetrics = await PerformanceMetrics.deleteMany({
                recordedAt: { $lt: thirtyDaysAgo }
            });

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

    // ADD THIS METHOD TO YOUR MongoDBManager CLASS IN database.js
// Place it at the end of your MongoDBManager class, before the closing bracket

// PRODUCTION HEALTH STATS METHOD
async getHealthStats() {
    try {
        if (!this.isConnected) {
            return {
                activeMemberCount: 0,
                recentMessages24h: 0,
                processedMediaCount: 0,
                error: 'Database not connected'
            };
        }

        // Get active member count
        const activeMemberCount = await Member.countDocuments({ active: true });

        // Get recent messages count (last 24 hours)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentMessages24h = await BroadcastMessage.countDocuments({
            sentAt: { $gte: twentyFourHoursAgo }
        });

        // Get processed media count
        const processedMediaCount = await MediaFile.countDocuments({
            uploadStatus: 'completed'
        });

        // Get total reactions (if reaction system is implemented)
        let totalReactions = 0;
        try {
            // This will work if you've implemented the reaction system
            const MessageReaction = require('./models').MessageReaction;
            if (MessageReaction) {
                totalReactions = await MessageReaction.countDocuments({});
            }
        } catch (reactionError) {
            // Reaction system not implemented yet - ignore
        }

        const stats = {
            activeMemberCount,
            recentMessages24h,
            processedMediaCount,
            totalReactions,
            databaseStatus: 'connected',
            lastUpdated: new Date()
        };

        this.logger.info(`📊 Health stats generated: ${activeMemberCount} members, ${recentMessages24h} recent messages`);
        
        return stats;

    } catch (error) {
        this.logger.error(`❌ Error generating health stats: ${error.message}`);
        
        return {
            activeMemberCount: 0,
            recentMessages24h: 0,
            processedMediaCount: 0,
            totalReactions: 0,
            databaseStatus: 'error',
            error: error.message,
            lastUpdated: new Date()
        };
    }
}
}

module.exports = MongoDBManager;