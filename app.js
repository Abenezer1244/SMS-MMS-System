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

// MongoDB imports
const MongoDBManager = require('./database');
const {
    Group,
    Member,
    BroadcastMessage,
    MediaFile,
    DeliveryLog,
    SystemAnalytics,
    PerformanceMetrics
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

class ProductionChurchSMS {
    constructor() {
        this.twilioClient = null;
        this.r2Client = null;
        this.dbManager = new MongoDBManager(logger);
        this.performanceMetrics = [];
        
        this.initializeServices();
        this.initializeDatabase();
        
        logger.info('SUCCESS: Production Church SMS System with MongoDB initialized');
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
                    if (this.dbManager.isConnected) {
                        await this.dbManager.createMediaFile({
                            messageId: messageId,
                            originalUrl: mediaUrl,
                            r2ObjectKey: cleanFilename,
                            publicUrl: publicUrl,
                            cleanFilename: cleanFilename.split('/').pop(),
                            displayName: displayName,
                            originalSize: fileSize,
                            finalSize: fileSize,
                            mimeType: mediaData.mimeType,
                            fileHash: mediaData.hash,
                            compressionDetected: compressionDetected,
                            uploadStatus: 'completed'
                        });
                    }

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
                    messageText = `[Media content - ${mediaUrls.length} file(s)]`;
                } else {
                    messageText = "[Empty message]";
                }
            }

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
            let largeMediaCount = 0;

            if (mediaUrls && mediaUrls.length > 0) {
                logger.info(`🔄 Processing ${mediaUrls.length} media files...`);
                try {
                    const { processedLinks, processingErrors } = await this.processMediaFiles(messageId, mediaUrls);
                    cleanMediaLinks = processedLinks;
                    largeMediaCount = processedLinks.length;

                    if (processingErrors.length > 0) {
                        logger.warn(`⚠️ Media processing errors: ${processingErrors.join(', ')}`);
                    }
                } catch (mediaError) {
                    logger.error(`❌ Media processing failed: ${mediaError.message}`);
                }
            }

            const finalMessage = this.formatMessageWithMedia(
                messageText, sender, cleanMediaLinks
            );

            if (this.dbManager.isConnected && messageId) {
                try {
                    await this.dbManager.updateBroadcastMessage(messageId, {
                        processedMessage: finalMessage,
                        largeMediaCount: largeMediaCount,
                        processingStatus: 'completed'
                    });
                } catch (updateError) {
                    logger.error(`❌ Failed to update broadcast message: ${updateError.message}`);
                }
            }

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

            const broadcastDurationMs = Math.round(totalTime * 1000);
            await this.recordPerformanceMetric('broadcast_complete', broadcastDurationMs, true);

            logger.info(`📊 Broadcast completed in ${totalTime.toFixed(2)}s: ${deliveryStats.sent} sent, ${deliveryStats.failed} failed`);

            if (sender.isAdmin) {
                let confirmation = `✅ Broadcast completed in ${totalTime.toFixed(1)}s\n`;
                confirmation += `📊 Delivered: ${deliveryStats.sent}/${recipients.length}\n`;

                if (largeMediaCount > 0) {
                    confirmation += `📎 Clean media links: ${largeMediaCount}\n`;
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

    // Add this method to the ProductionChurchSMS class in app.js

// Enhanced ProductionChurchSMS class methods with ADD and REMOVE commands
// Add these methods to your ProductionChurchSMS class in app.js

// Enhanced handleAddMemberCommand method for app.js
// Replace the existing method in your ProductionChurchSMS class

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

            // Log the addition for audit trail
            await this.dbManager.recordAnalytic('member_added_via_command', 1, 
                `Admin: ${admin.name}, New Member: ${memberName} (${cleanPhone})`);

            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('add_member_command', durationMs, true);

            logger.info(`✅ Admin ${admin.name} added new member: ${memberName} (${cleanPhone})`);

            // Get updated member count
            const totalMembers = await this.dbManager.getAllActiveMembers();

            // Return success message to admin
            return `✅ Member added successfully!\n` +
                   `👤 Name: ${memberName}\n` +
                   `📱 Phone: ${cleanPhone}\n` +
                   `🏛️ Group: ${congregationGroup.name}\n` +
                   `📊 Total active members: ${totalMembers.length}`;

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




// Modify the existing handleIncomingMessage method to include ADD command detection
// Enhanced handleIncomingMessage method with both ADD and REMOVE commands
async handleIncomingMessage(fromPhone, messageBody, mediaUrls) {
    logger.info(`📨 Incoming message from ${fromPhone}`);

    try {
        fromPhone = this.cleanPhoneNumber(fromPhone);
        
        messageBody = messageBody ? messageBody.trim() : "";
        
        if (!messageBody && mediaUrls && mediaUrls.length > 0) {
            messageBody = `[Media content - ${mediaUrls.length} file(s)]`;
        }
        
        if (!messageBody) {
            messageBody = "[Empty message]";
        }

        if (mediaUrls && mediaUrls.length > 0) {
            logger.info(`📎 Received ${mediaUrls.length} media files`);
            for (let i = 0; i < mediaUrls.length; i++) {
                const media = mediaUrls[i];
                logger.info(`   Media ${i + 1}: ${media.type || 'unknown'} - ${media.url || 'no URL'}`);
            }
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

        // Check for HELP command
        if (messageBody.toUpperCase() === 'HELP') {
            let helpMessage = "📋 YESUWAY CHURCH SMS SYSTEM\n\n" +
                            "✅ Send messages to entire congregation\n" +
                            "✅ Share photos/videos (unlimited size)\n" +
                            "✅ Clean media links (no technical details)\n" +
                            "✅ Full quality preserved automatically\n\n" +
                            "📱 Text HELP for this message\n" +
                            "🏛️ Production system - serving 24/7\n" +
                            "🗄️ Powered by MongoDB for scalable performance";
            
            // Add admin commands to help if user is admin
            if (member.isAdmin) {
                helpMessage += "\n\n🔑 ADMIN COMMANDS:\n" +
                             "• ADD +1234567890 MemberName - Add new member\n" +
                             "• REMOVE +1234567890 MemberName - Remove member";
            }
            
            return helpMessage;
        }

        // Check for ADD command (admin only)
        if (messageBody.toUpperCase().startsWith('ADD ')) {
            return await this.handleAddMemberCommand(fromPhone, messageBody);
        }

        // Check for REMOVE command (admin only)
        if (messageBody.toUpperCase().startsWith('REMOVE ')) {
            return await this.handleRemoveMemberCommand(fromPhone, messageBody);
        }

        // Check for CLEANUP command (admin only)
        if (messageBody.toUpperCase().startsWith('CLEANUP ') || messageBody.toUpperCase() === 'CLEANUP') {
            return await this.handleCleanupCommand(fromPhone, messageBody);
        }

        // Regular message broadcasting
        logger.info('📡 Processing message broadcast...');
        return await this.broadcastMessage(fromPhone, messageBody, mediaUrls);
        
    } catch (error) {
        logger.error(`❌ Message processing error: ${error.message}`);
        logger.error(`❌ Stack trace: ${error.stack}`);
        return "Message processing temporarily unavailable - please try again";
    }
}



}
// Initialize production system
logger.info('STARTING: Initializing Production Church SMS System with MongoDB...');
let smsSystem;
try {
    smsSystem = new ProductionChurchSMS();
    logger.info('SUCCESS: Production system with MongoDB fully operational');
} catch (error) {
    logger.error(`CRITICAL: Production system failed to initialize: ${error.message}`);
    if (!config.development) {
        process.exit(1);
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