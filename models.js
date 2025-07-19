

const mongoose = require('mongoose');
const { Schema } = mongoose;

// PRODUCTION REACTION MODELS
// Add this to your models.js file (after existing schemas)

// Message Reaction Schema - Industrial Grade
const messageReactionSchema = new Schema({
    reactorPhone: {
        type: String,
        required: true,
        index: true
    },
    reactorName: {
        type: String,
        required: true
    },
    emoji: {
        type: String,
        required: true,
        index: true
    },
    targetMessage: {
        type: String,
        required: true,
        maxlength: 200
    },
    reactionType: {
        type: String,
        enum: ['iphone_reaction', 'android_reaction', 'direct_emoji', 'unknown'],
        required: true,
        index: true
    },
    originalReactionText: {
        type: String,
        required: true
    },
    processedForSummary: {
        type: Boolean,
        default: false,
        index: true
    },
    summaryDate: {
        type: Date,
        index: true
    },
    detectedAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true,
    collection: 'message_reactions'
});

// Daily Reaction Summary Schema - Production Ready
const dailyReactionSummarySchema = new Schema({
    summaryDate: {
        type: Date,
        required: true,
        index: true
    },
    totalReactions: {
        type: Number,
        required: true,
        default: 0
    },
    totalMessages: {
        type: Number,
        required: true,
        default: 0
    },
    reactionsByMessage: [{
        targetMessage: {
            type: String,
            required: true,
            maxlength: 100
        },
        reactions: [{
            emoji: {
                type: String,
                required: true
            },
            count: {
                type: Number,
                required: true,
                min: 1
            }
        }],
        totalReactionCount: {
            type: Number,
            required: true,
            default: 0
        }
    }],
    topReactedMessage: {
        message: String,
        reactionCount: {
            type: Number,
            default: 0
        }
    },
    summaryStatus: {
        type: String,
        enum: ['pending', 'generated', 'sent', 'failed'],
        default: 'pending',
        index: true
    },
    summaryText: {
        type: String
    },
    sentAt: {
        type: Date
    },
    deliveryResults: {
        successCount: {
            type: Number,
            default: 0
        },
        failureCount: {
            type: Number,
            default: 0
        }
    }
}, {
    timestamps: true,
    collection: 'daily_reaction_summaries'
});

// Reaction Summary Settings Schema - Admin Configuration
const reactionSummarySettingsSchema = new Schema({
    isEnabled: {
        type: Boolean,
        default: true
    },
    summaryTime: {
        hour: {
            type: Number,
            min: 0,
            max: 23,
            default: 20 // 8 PM
        },
        minute: {
            type: Number,
            min: 0,
            max: 59,
            default: 0
        }
    },
    minimumReactionsThreshold: {
        type: Number,
        min: 1,
        default: 3
    },
    maximumMessagesInSummary: {
        type: Number,
        min: 1,
        max: 20,
        default: 10
    },
    includeReactorNames: {
        type: Boolean,
        default: false
    },
    summaryFormat: {
        type: String,
        enum: ['compact', 'detailed', 'minimal'],
        default: 'compact'
    },
    lastModifiedBy: {
        type: String
    },
    lastModifiedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'reaction_summary_settings'
});



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

// Optimized indexes for production performance
messageReactionSchema.index({ detectedAt: -1, processedForSummary: 1 });
messageReactionSchema.index({ summaryDate: 1, processedForSummary: 1 });
messageReactionSchema.index({ reactorPhone: 1, detectedAt: -1 });
messageReactionSchema.index({ emoji: 1, detectedAt: -1 });

dailyReactionSummarySchema.index({ summaryDate: -1 });
dailyReactionSummarySchema.index({ summaryStatus: 1, summaryDate: -1 });
dailyReactionSummarySchema.index({ sentAt: -1 });



// Create and export models
const Group = mongoose.model('Group', groupSchema);
const Member = mongoose.model('Member', memberSchema);
const BroadcastMessage = mongoose.model('BroadcastMessage', broadcastMessageSchema);
const MediaFile = mongoose.model('MediaFile', mediaFileSchema);
const DeliveryLog = mongoose.model('DeliveryLog', deliveryLogSchema);
const SystemAnalytics = mongoose.model('SystemAnalytics', systemAnalyticsSchema);
const PerformanceMetrics = mongoose.model('PerformanceMetrics', performanceMetricsSchema);

// Export the new models (add these to your existing exports)
const MessageReaction = mongoose.model('MessageReaction', messageReactionSchema);
const DailyReactionSummary = mongoose.model('DailyReactionSummary', dailyReactionSummarySchema);
const ReactionSummarySettings = mongoose.model('ReactionSummarySettings', reactionSummarySettingsSchema);




module.exports = {
    Group,
    Member,
    BroadcastMessage,
    MediaFile,
    DeliveryLog,
    SystemAnalytics,
    PerformanceMetrics,
    MessageReaction,           // NEW
    DailyReactionSummary,      // NEW  
    ReactionSummarySettings    // NEW

};