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
// UPDATE this import line
// UPDATE this import line
const {
    Group,
    Member,
    BroadcastMessage,
    MediaFile,
    DeliveryLog,
    SystemAnalytics,
    PerformanceMetrics,
    QualityUpgradeSession
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
const multer = require('multer');

// Security and performance middleware
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


// Configure multer for HD uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        // Accept images, videos, and audio
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|mp3|wav|m4a|webm|quicktime/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images, videos, and audio files are allowed.'));
        }
    }
}).array('media', 10);

// Custom upload handler with error handling
const handleFileUpload = (req, res, next) => {
    upload(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    error: 'File too large. Maximum size is 100MB per file.'
                });
            }
            if (err.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({
                    success: false,
                    error: 'Too many files. Maximum is 10 files per upload.'
                });
            }
            return res.status(400).json({
                success: false,
                error: `Upload error: ${err.message}`
            });
        } else if (err) {
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
        next();
    });
};

// Apply upload middleware to quality upload route
app.use('/quality/:token/upload', handleFileUpload);


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

                if (process.env.CLOUDFLARE_STREAM_ENABLED === 'true') {
            this.validateCloudflareStreamConfig().then(isValid => {
                if (isValid) {
                    logger.info('🎥 Cloudflare Stream: ✅ Ready for professional video processing');
                } else {
                    logger.warn('🎥 Cloudflare Stream: ❌ Configuration issues detected');
                    logger.info('💡 Videos will use original quality processing');
                }
            }).catch(error => {
                logger.error('🎥 Cloudflare Stream validation error:', error.message);
            });
        } else {
            logger.info('🎥 Cloudflare Stream: Disabled (set CLOUDFLARE_STREAM_ENABLED=true to enable)');
        }
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

// 1. Add this after your existing downloadMediaFromTwilio method
async processVideoWithCloudflareStream(mediaData, mediaIndex) {
    const startTime = Date.now();
    
    try {
        logger.info(`🎥 Processing video ${mediaIndex} with Cloudflare Stream`);
        
        // Check if Cloudflare Stream is enabled
        if (process.env.CLOUDFLARE_STREAM_ENABLED !== 'true') {
            throw new Error('Cloudflare Stream not enabled');
        }
        
        const streamApiUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream`;
        
        // Create form data for upload
        const FormData = require('form-data');
        const formData = new FormData();
        
        // Add the video file
        formData.append('file', mediaData.content, {
            filename: `yesuway_church_video_${mediaIndex}_${Date.now()}.mp4`,
            contentType: mediaData.mimeType
        });
        
        // Add metadata
        formData.append('meta', JSON.stringify({
            name: `YesuWay Church Video ${mediaIndex} - ${new Date().toLocaleDateString()}`,
            requireSignedURLs: false,
            allowedOrigins: ['*'],
            creator: 'YesuWay Church SMS System'
        }));

        logger.info(`📤 Uploading ${(mediaData.size / 1024 / 1024).toFixed(2)}MB video to Cloudflare Stream...`);

        // Upload to Cloudflare Stream
        const streamResponse = await axios.post(streamApiUrl, formData, {
            headers: {
                'Authorization': `Bearer ${process.env.CLOUDFLARE_STREAM_TOKEN}`,
                ...formData.getHeaders()
            },
            timeout: 300000, // 5 minutes timeout for large videos
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        if (streamResponse.status === 200 && streamResponse.data.success) {
            const videoId = streamResponse.data.result.uid;
            const videoInfo = streamResponse.data.result;
            
            logger.info(`✅ Video uploaded to Cloudflare Stream: ${videoId}`);
            
            // Create an optimized HTML5 video player
            const optimizedVideoHtml = this.createCloudflareStreamPlayer(videoId, mediaIndex, videoInfo);
            
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('cloudflare_stream_processing', durationMs, true);
            
            // Log the successful processing
            if (this.dbManager.isConnected) {
                await this.dbManager.recordAnalytic('video_stream_processed', 1, 
                    `Video ${mediaIndex}, Stream ID: ${videoId}, Original Size: ${(mediaData.size / 1024 / 1024).toFixed(2)}MB, Processing Time: ${(durationMs / 1000).toFixed(1)}s`);
            }
            
            logger.info(`✅ Video ${mediaIndex} processed with Cloudflare Stream in ${(durationMs / 1000).toFixed(1)}s`);
            
            return {
                success: true,
                content: Buffer.from(optimizedVideoHtml),
                mimeType: 'text/html',
                qualityInfo: `cloudflare_stream_hd_${(mediaData.size / 1024 / 1024).toFixed(1)}MB`,
                streamId: videoId,
                processingTime: durationMs
            };
        } else {
            const errorMessage = streamResponse.data.errors?.[0]?.message || 'Unknown Cloudflare Stream API error';
            throw new Error(`Cloudflare Stream API error: ${errorMessage}`);
        }
        
    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('cloudflare_stream_processing', durationMs, false, error.message);
        
        logger.error(`❌ Cloudflare Stream processing failed for video ${mediaIndex}: ${error.message}`);
        
        // Log the failure for monitoring
        if (this.dbManager.isConnected) {
            await this.dbManager.recordAnalytic('video_stream_failed', 1, 
                `Video ${mediaIndex}, Error: ${error.message}, Size: ${(mediaData.size / 1024 / 1024).toFixed(2)}MB`);
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

// 2. Add this method to create the professional video player
createCloudflareStreamPlayer(videoId, mediaIndex, videoInfo) {
    const playerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="YesuWay Church Video ${mediaIndex} - Professional HD streaming">
    <title>🏛️ YesuWay Church Video ${mediaIndex}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 10px;
        }
        .container { 
            max-width: 900px; 
            margin: 20px auto; 
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
            overflow: hidden;
        }
        .header { 
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: white;
            padding: 25px;
            text-align: center;
        }
        .header h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .quality-badge { 
            background: rgba(255,255,255,0.2);
            backdrop-filter: blur(10px);
            color: white; 
            padding: 8px 16px; 
            border-radius: 25px; 
            font-size: 14px;
            font-weight: 600;
            display: inline-block;
            border: 1px solid rgba(255,255,255,0.3);
        }
        .video-wrapper {
            position: relative;
            background: #000;
            padding: 0;
        }
        .video-frame {
            width: 100%;
            height: 500px;
            border: none;
            display: block;
        }
        .info-section { 
            padding: 25px;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            text-align: center;
        }
        .features {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-bottom: 15px;
            flex-wrap: wrap;
        }
        .feature {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #495057;
            font-size: 14px;
            font-weight: 500;
        }
        .footer {
            background: #2c3e50;
            color: white;
            padding: 20px;
            text-align: center;
        }
        .footer h3 {
            font-size: 18px;
            margin-bottom: 8px;
        }
        .footer p {
            color: #bdc3c7;
            font-size: 14px;
        }
        
        @media (max-width: 768px) {
            .container { margin: 10px; }
            .video-frame { height: 300px; }
            .header h1 { font-size: 24px; }
            .features { gap: 15px; }
            .feature { font-size: 13px; }
        }
        
        @media (max-width: 480px) {
            body { padding: 5px; }
            .header { padding: 20px 15px; }
            .info-section { padding: 20px 15px; }
            .video-frame { height: 250px; }
            .features { flex-direction: column; gap: 10px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>🏛️ YesuWay Church Video ${mediaIndex}</h1>
            <div class="quality-badge">✨ HD Quality • Professional Streaming</div>
        </header>
        
        <div class="video-wrapper">
            <iframe 
                class="video-frame"
                src="https://customer-${process.env.CLOUDFLARE_CUSTOMER_CODE}.cloudflarestream.com/${videoId}/iframe?preload=true&autoplay=false&loop=false&muted=false&controls=true"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowfullscreen="true">
            </iframe>
        </div>
        
        <div class="info-section">
            <div class="features">
                <div class="feature">🎥 HD Video Quality</div>
                <div class="feature">📱 Mobile Optimized</div>
                <div class="feature">⚡ Fast Loading</div>
                <div class="feature">🔄 Adaptive Streaming</div>
            </div>
            <p style="color: #6c757d; font-size: 14px; margin: 0;">
                Professional video streaming powered by Cloudflare • Optimized for all devices
            </p>
        </div>
        
        <footer class="footer">
            <h3>💚 YesuWay Church</h3>
            <p>Connecting our congregation through technology and faith</p>
        </footer>
    </div>
    
    <script>
        // Analytics tracking for video engagement
        document.addEventListener('DOMContentLoaded', function() {
            const iframe = document.querySelector('.video-frame');
            let engagementLogged = false;
            
            iframe.addEventListener('load', function() {
                if (!engagementLogged) {
                    console.log('YesuWay Church Video ${mediaIndex} loaded successfully');
                    engagementLogged = true;
                }
            });
        });
    </script>
</body>
</html>`;

    return playerHtml;
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

// 3. REPLACE your existing processMediaFiles method with this enhanced version
async processMediaFiles(messageId, mediaUrls) {
    logger.info(`🔄 Processing ${mediaUrls.length} media files with Cloudflare Stream integration for message ${messageId}`);

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

            let processedContent = mediaData.content;
            let finalMimeType = mediaData.mimeType;
            let qualityInfo = 'original';
            let isStreamOptimized = false;

            // 🎥 CLOUDFLARE STREAM PROCESSING FOR VIDEOS
            if (mediaData.mimeType.includes('video') && process.env.CLOUDFLARE_STREAM_ENABLED === 'true') {
                logger.info(`🎥 Video detected (${(mediaData.size / 1024 / 1024).toFixed(2)}MB), processing with Cloudflare Stream...`);
                
                const streamResult = await this.processVideoWithCloudflareStream(mediaData, i + 1);
                if (streamResult.success) {
                    processedContent = streamResult.content;
                    finalMimeType = streamResult.mimeType;
                    qualityInfo = streamResult.qualityInfo;
                    isStreamOptimized = true;
                    logger.info(`✅ Video ${i + 1} processed with Cloudflare Stream: ${streamResult.qualityInfo}`);
                } else {
                    logger.warn(`⚠️ Cloudflare Stream processing failed for video ${i + 1}, using original: ${streamResult.error}`);
                    // Continue with original video processing
                }
            }

            // Enhanced filename generation for stream-optimized content
            const { cleanFilename, displayName } = this.generateCleanFilename(finalMimeType, i + 1);

            const publicUrl = await this.uploadToR2(
                processedContent,
                cleanFilename,
                finalMimeType,
                {
                    'original-size': mediaData.size.toString(),
                    'final-size': processedContent.length.toString(),
                    'quality-info': qualityInfo,
                    'stream-optimized': isStreamOptimized.toString(),
                    'media-index': i.toString(),
                    'display-name': displayName,
                    'processing-timestamp': new Date().toISOString(),
                    'church-system': 'yesuway-production-stream'
                }
            );

            if (publicUrl) {
                // Enhanced database storage with stream information
                if (this.dbManager.isConnected) {
                    await this.dbManager.createMediaFile({
                        messageId: messageId,
                        originalUrl: mediaUrl,
                        r2ObjectKey: cleanFilename,
                        publicUrl: publicUrl,
                        cleanFilename: cleanFilename.split('/').pop(),
                        displayName: displayName,
                        originalSize: mediaData.size,
                        finalSize: processedContent.length,
                        mimeType: finalMimeType,
                        fileHash: mediaData.hash,
                        compressionDetected: isStreamOptimized, // True if we used Cloudflare Stream
                        uploadStatus: 'completed',
                        qualityInfo: qualityInfo,
                        streamOptimized: isStreamOptimized,
                        processingMetadata: {
                            cloudflareStreamEnabled: process.env.CLOUDFLARE_STREAM_ENABLED === 'true',
                            originalMimeType: mediaData.mimeType,
                            qualityPreservation: isStreamOptimized,
                            processingTimestamp: new Date()
                        }
                    });
                }

                processedLinks.push({
                    url: publicUrl,
                    displayName: displayName,
                    type: finalMimeType,
                    qualityInfo: qualityInfo,
                    streamOptimized: isStreamOptimized
                });
                
                if (isStreamOptimized) {
                    logger.info(`✅ Video ${i + 1} processed with Cloudflare Stream and uploaded successfully`);
                } else {
                    logger.info(`✅ Media ${i + 1} processed successfully (original quality)`);
                }
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

    // Enhanced completion logging
    const streamProcessedCount = processedLinks.filter(link => link.streamOptimized).length;
    const originalProcessedCount = processedLinks.filter(link => !link.streamOptimized).length;
    
    logger.info(`✅ Media processing complete: ${processedLinks.length} successful (${streamProcessedCount} Cloudflare Stream, ${originalProcessedCount} original), ${processingErrors.length} errors`);
    
    // Record analytics for stream usage
    if (this.dbManager.isConnected && streamProcessedCount > 0) {
        await this.dbManager.recordAnalytic('cloudflare_stream_usage', streamProcessedCount, 
            `Total videos processed: ${streamProcessedCount}, Total media items: ${processedLinks.length}`);
    }
    
    return { processedLinks, processingErrors };
}


// INDUSTRY QUALITY DETECTION SYSTEM - ADD AFTER processMediaFiles method
    async analyzeMediaQuality(mediaUrls, messageBody) {
        const startTime = Date.now();
        
        try {
            // Production quality triggers
            const qualityKeywords = [
                'hd', 'high quality', 'best quality', 'clear video', 'quality',
                'important video', 'sermon', 'testimony', 'wedding', 'baptism',
                'church event', 'special', 'recording', 'broadcast', 'live',
                'crystal clear', 'professional', 'original quality'
            ];
            
            const hasQualityKeyword = qualityKeywords.some(keyword => 
                messageBody.toLowerCase().includes(keyword)
            );
            
            // Analyze media characteristics
            let hasLargeMedia = false;
            let totalMediaSize = 0;
            
            if (mediaUrls && mediaUrls.length > 0) {
                for (const media of mediaUrls) {
                    // Download headers to check size without full download
                    try {
                        const headResponse = await axios.head(media.url, {
                            auth: {
                                username: config.twilio.accountSid,
                                password: config.twilio.authToken
                            },
                            timeout: 5000
                        });
                        
                        const contentLength = parseInt(headResponse.headers['content-length'] || 0);
                        totalMediaSize += contentLength;
                        
                        // Consider large if > 5MB or video content
                        if (contentLength > 5 * 1024 * 1024 || 
                            media.type?.includes('video') ||
                            headResponse.headers['content-type']?.includes('video')) {
                            hasLargeMedia = true;
                        }
                    } catch (headError) {
                        logger.warn(`⚠️ Could not analyze media size: ${headError.message}`);
                        // Default to quality upgrade if we can't determine size
                        hasLargeMedia = true;
                    }
                }
            }
            
            const shouldUpgrade = hasQualityKeyword || hasLargeMedia || totalMediaSize > 10 * 1024 * 1024;
            
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('quality_analysis', durationMs, true);
            
            logger.info(`🔍 Quality analysis: Keywords=${hasQualityKeyword}, Large=${hasLargeMedia}, Size=${(totalMediaSize/1024/1024).toFixed(2)}MB, Upgrade=${shouldUpgrade}`);
            
            return {
                shouldUpgrade,
                hasQualityKeyword,
                hasLargeMedia,
                totalMediaSize,
                mediaCount: mediaUrls?.length || 0
            };
            
        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('quality_analysis', durationMs, false, error.message);
            
            logger.error(`❌ Quality analysis error: ${error.message}`);
            return {
                shouldUpgrade: false,
                hasQualityKeyword: false,
                hasLargeMedia: false,
                totalMediaSize: 0,
                mediaCount: 0
            };
        }
    }

    async generateQualityUpgradeToken() {
        const crypto = require('crypto');
        return crypto.randomBytes(20).toString('hex');
    }

    async createQualityUpgradeSession(fromPhone, fromName, originalMessageId, mediaUrls, analysisResult) {
        const startTime = Date.now();
        
        try {
            const token = await this.generateQualityUpgradeToken();
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
            
            const sessionData = {
                token,
                fromPhone,
                fromName,
                originalMessageId,
                originalMediaUrls: mediaUrls.map(media => ({
                    url: media.url,
                    type: media.type,
                    size: analysisResult.totalMediaSize
                })),
                expiresAt,
                status: 'pending'
            };
            
            const session = await this.dbManager.createQualityUpgradeSession(sessionData);
            
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('upgrade_session_creation', durationMs, true);
            
            logger.info(`✅ Created quality upgrade session: ${token} for ${fromName}`);
            
            return {
                token,
                upgradeUrl: `${this.getBaseUrl()}/quality/${token}`,
                expiresAt
            };
            
        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('upgrade_session_creation', durationMs, false, error.message);
            
            logger.error(`❌ Failed to create upgrade session: ${error.message}`);
            throw error;
        }
    }

    getBaseUrl() {
        // Production URL detection
        if (process.env.RENDER_EXTERNAL_URL) {
            return process.env.RENDER_EXTERNAL_URL;
        }
        if (process.env.PRODUCTION_URL) {
            return process.env.PRODUCTION_URL;
        }
        // Fallback for development
        return `http://localhost:${config.port}`;
    }

    async handleDualTrackMedia(fromPhone, messageBody, mediaUrls, member) {
        const startTime = Date.now();
        
        try {
            logger.info(`🎬 Processing dual-track media for ${member.name}`);
            
            // 1. IMMEDIATE BROADCAST (no delays)
            const broadcastPromise = this.broadcastMessage(fromPhone, messageBody, mediaUrls);
            
            // 2. QUALITY ANALYSIS (parallel)
            const analysisPromise = this.analyzeMediaQuality(mediaUrls, messageBody);
            
            // Wait for both
            const [broadcastResult, analysisResult] = await Promise.all([
                broadcastPromise,
                analysisPromise
            ]);
            
            // 3. CREATE UPGRADE SESSION if quality upgrade is beneficial
            if (analysisResult.shouldUpgrade) {
                try {
                    // Find the message ID from broadcast result
                    const messageId = broadcastResult?.messageId || null;
                    
                    const upgradeSession = await this.createQualityUpgradeSession(
                        fromPhone, member.name, messageId, mediaUrls, analysisResult
                    );
                    
                    // 4. SEND UPGRADE OFFER (only to sender)
                    const upgradeMessage = this.formatQualityUpgradeMessage(
                        upgradeSession, analysisResult
                    );
                    
                    // Send upgrade offer asynchronously
                    const upgradePromise = this.sendSMS(fromPhone, upgradeMessage);
                    
                    // Log analytics
                    await this.dbManager.recordAnalytic('quality_upgrade_offered', 1,
                        `User: ${member.name}, MediaCount: ${mediaUrls.length}, Size: ${(analysisResult.totalMediaSize/1024/1024).toFixed(2)}MB`);
                    
                    // Don't wait for upgrade SMS to complete
                    upgradePromise.catch(error => {
                        logger.error(`❌ Failed to send upgrade offer: ${error.message}`);
                    });
                    
                    logger.info(`✅ Dual-track complete: Broadcast delivered + upgrade offered`);
                } catch (upgradeError) {
                    logger.error(`❌ Upgrade session creation failed: ${upgradeError.message}`);
                    // Continue anyway - broadcast was successful
                }
            } else {
                logger.info(`ℹ️ Quality upgrade not beneficial for this media`);
            }
            
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('dual_track_processing', durationMs, true);
            
            return broadcastResult;
            
        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('dual_track_processing', durationMs, false, error.message);
            
            logger.error(`❌ Dual-track processing failed: ${error.message}`);
            
            // Fallback to standard broadcast
            return await this.broadcastMessage(fromPhone, messageBody, mediaUrls);
        }
    }

    formatQualityUpgradeMessage(upgradeSession, analysisResult) {
        const sizeMB = (analysisResult.totalMediaSize / 1024 / 1024).toFixed(1);
        const expirationTime = upgradeSession.expiresAt.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        });
        
        let upgradeMessage = `📱 QUALITY UPGRADE AVAILABLE\n\n`;
        upgradeMessage += `✅ Your message was broadcast successfully!\n\n`;
        
        if (analysisResult.hasQualityKeyword) {
            upgradeMessage += `🎥 Quality keyword detected\n`;
        }
        if (analysisResult.hasLargeMedia) {
            upgradeMessage += `📊 Large media detected (${sizeMB}MB)\n`;
        }
        
        upgradeMessage += `\n📹 Upload HD version:\n`;
        upgradeMessage += `${upgradeSession.upgradeUrl}\n\n`;
        upgradeMessage += `⏰ Available until ${expirationTime}\n`;
        upgradeMessage += `🔄 HD version will auto-replace current`;
        
        return upgradeMessage;
    }


// 4. ADD this method to enhance your message formatting with stream indicators
formatMessageWithMedia(originalMessage, sender, mediaLinks = null) {
    if (mediaLinks && mediaLinks.length > 0) {
        let messageText = `💬 ${sender.name}:\n${originalMessage}\n\n`;
        
        mediaLinks.forEach((mediaItem, index) => {
            const qualityIndicator = mediaItem.streamOptimized ? '🎥 HD' : '📎';
            const streamBadge = mediaItem.streamOptimized ? ' [Professional Streaming]' : '';
            messageText += `${qualityIndicator} ${mediaItem.displayName}${streamBadge}: ${mediaItem.url}\n`;
        });
        
        return messageText.trim();
    } else {
        return `💬 ${sender.name}:\n${originalMessage}`;
    }
}

// HD BROADCAST SYSTEM - ADD AFTER handleDualTrackMedia method
    async broadcastHDUpgrade(session, processedMedia) {
        const startTime = Date.now();
        
        try {
            logger.info(`📡 Broadcasting HD upgrade for ${session.fromName}: ${processedMedia.length} files`);
            
            // Get all active members except the sender
            const recipients = await this.getAllActiveMembers(session.fromPhone);
            
            if (recipients.length === 0) {
                logger.warn('❌ No active recipients for HD broadcast');
                return { success: false, error: 'No active recipients' };
            }
            
            // Format HD upgrade message
            const hdMessage = this.formatHDUpgradeMessage(session.fromName, processedMedia);
            
            // Broadcast to all recipients
            const deliveryStats = {
                sent: 0,
                failed: 0,
                errors: []
            };
            
            const sendPromises = recipients.map(async (member) => {
                try {
                    const result = await this.sendSMS(member.phone, hdMessage);
                    
                    if (result.success) {
                        deliveryStats.sent++;
                        logger.info(`✅ HD broadcast delivered to ${member.name}: ${result.sid}`);
                    } else {
                        deliveryStats.failed++;
                        deliveryStats.errors.push(`${member.name}: ${result.error}`);
                    }
                } catch (error) {
                    deliveryStats.failed++;
                    deliveryStats.errors.push(`${member.name}: ${error.message}`);
                }
            });
            
            await Promise.allSettled(sendPromises);
            
            // Send confirmation to original sender
            const confirmationMessage = `✅ HD UPGRADE COMPLETE\n\n` +
                `📹 ${processedMedia.length} HD file(s) broadcast\n` +
                `📊 Delivered to ${deliveryStats.sent}/${recipients.length} members\n` +
                `🎥 Original quality preserved\n\n` +
                `Your congregation now has the HD version!`;
            
            await this.sendSMS(session.fromPhone, confirmationMessage);
            
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('hd_broadcast', durationMs, true);
            
            logger.info(`✅ HD broadcast completed: ${deliveryStats.sent} sent, ${deliveryStats.failed} failed`);
            
            return {
                success: true,
                delivered: deliveryStats.sent,
                failed: deliveryStats.failed,
                totalRecipients: recipients.length,
                processingTime: durationMs
            };
            
        } catch (error) {
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('hd_broadcast', durationMs, false, error.message);
            
            logger.error(`❌ HD broadcast failed: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    formatHDUpgradeMessage(senderName, processedMedia) {
        let message = `🔄 HD QUALITY UPDATE\n\n`;
        message += `💬 ${senderName} uploaded HD version:\n\n`;
        
        processedMedia.forEach((media, index) => {
            message += `🎥 ${media.displayName}: ${media.url}\n`;
        });
        
        message += `\n✨ Original quality preserved\n`;
        message += `📱 Tap links for best viewing experience`;
        
        return message;
    }


// 5. ADD this method to check Cloudflare Stream configuration
async validateCloudflareStreamConfig() {
    try {
        logger.info('🔧 Validating Cloudflare Stream configuration...');
        
        const requiredVars = [
            'CLOUDFLARE_STREAM_ENABLED',
            'CLOUDFLARE_ACCOUNT_ID', 
            'CLOUDFLARE_STREAM_TOKEN',
            'CLOUDFLARE_CUSTOMER_CODE'
        ];
        
        const missing = requiredVars.filter(varName => !process.env[varName]);
        
        if (missing.length > 0) {
            logger.warn(`⚠️ Missing Cloudflare Stream environment variables: ${missing.join(', ')}`);
            return false;
        }
        
        if (process.env.CLOUDFLARE_STREAM_ENABLED !== 'true') {
            logger.info('ℹ️ Cloudflare Stream is disabled');
            return false;
        }
        
        // Test API connectivity
        const testUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream`;
        
        try {
            const response = await axios.get(testUrl, {
                headers: {
                    'Authorization': `Bearer ${process.env.CLOUDFLARE_STREAM_TOKEN}`
                },
                timeout: 10000
            });
            
            if (response.status === 200 && response.data.success) {
                logger.info('✅ Cloudflare Stream configuration validated successfully');
                return true;
            } else {
                logger.error('❌ Cloudflare Stream API test failed:', response.data.errors);
                return false;
            }
        } catch (apiError) {
            logger.error('❌ Cloudflare Stream API connectivity test failed:', apiError.message);
            return false;
        }
        
    } catch (error) {
        logger.error('❌ Cloudflare Stream configuration validation error:', error.message);
        return false;
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
                logger.info(`🔄 Processing ${mediaUrls.length} media files with quality preservation...`);
                try {
                    const { processedLinks, processingErrors } = await this.processMediaFilesWithQualityPreservation(messageId, mediaUrls);
                    cleanMediaLinks = processedLinks;
                    largeMediaCount = processedLinks.length;

                    if (processingErrors.length > 0) {
                        logger.warn(`⚠️ Media processing errors: ${processingErrors.join(', ')}`);
                    }
                } catch (mediaError) {
                    logger.error(`❌ Quality-preserved media processing failed: ${mediaError.message}`);
                    // Fallback to original processing
                    const { processedLinks, processingErrors } = await this.processMediaFiles(messageId, mediaUrls);
                    cleanMediaLinks = processedLinks;
                    largeMediaCount = processedLinks.length;
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
        // Get system statistics for help message
        const stats = await this.dbManager.getHealthStats();
        const currentTime = new Date().toLocaleString();
        
        // Base help message for all members
        let helpMessage = `📋 YESUWAY CHURCH SMS SYSTEM
═══════════════════════════════════

🏛️ CHURCH COMMUNICATION PLATFORM
📅 Current Time: ${currentTime}
👥 Active Members: ${stats.activeMemberCount}
📱 Church Number: ${config.twilio.phoneNumber}

📱 FOR ALL MEMBERS:
═══════════════════════════════════
✅ Send messages to entire congregation
✅ Share photos/videos (unlimited size)
✅ Send prayer requests and announcements
✅ Share testimonies and encouragement
✅ Ask for help or volunteers

💬 HOW TO USE:
• Text anything to broadcast to everyone
• Share photos from church events
• Send prayer requests for immediate support
• Post announcements and reminders
• Express reactions (tracked in summaries)

📝 EXAMPLES:
• "Prayer meeting tonight at 7 PM!"
• "Thank you for the wonderful service!"
• "Does anyone have a truck I could borrow?"
• [Send photos from church events]

🔇 REACTIONS:
Your thumbs up, hearts, etc. are tracked
silently and appear in daily summaries.

🏛️ SYSTEM INFO:
• Production system - serving 24/7
• MongoDB database - enterprise grade
• Clean media links - professional presentation
• Secure registration - members only

📋 AVAILABLE COMMANDS:
═══════════════════════════════════
• HELP - Show this information`;



        // Add admin commands if user is admin
        if (member.isAdmin) {
            helpMessage += `

🔑 ADMIN COMMANDS:
═══════════════════════════════════
• ADD +1234567890 MemberName
  └─ Add new member (sends welcome SMS)
  
• REMOVE +1234567890 [MemberName]  
  └─ Permanently delete member
  
• ADMIN +1234567890 AdminName
  └─ Grant full admin privileges
  
• WIPE CONFIRM
  └─ Emergency complete database wipe
  
• CLEANUP STATUS
  └─ Show database health status
  
• CLEANUP DUPLICATES
  └─ Remove duplicate phone numbers
  
• CLEANUP PHONE +1234567890
  └─ Remove all data for phone number
  
• CLEANUP ORPHANED
  └─ Remove inactive members & orphaned data

📊 ADMIN EXAMPLES:
• ADD +12065551234 John Smith
• REMOVE +12065551234 John Smith
• ADMIN +12065551234 Jane Doe
• WIPE CONFIRM
• CLEANUP STATUS
• CLEANUP DUPLICATES

⚠️ ADMIN NOTES:
• All admin commands are permanently logged
• REMOVE permanently deletes all member data
• ADMIN grants full system privileges
• WIPE destroys ALL database content
• CLEANUP operations cannot be undone
• New members receive automatic welcome SMS
• New admins receive privilege notification SMS`;
        }

        // Add footer
        helpMessage += `

🙏 CHURCH FELLOWSHIP:
═══════════════════════════════════
"Let us consider how we may spur one another 
on toward love and good deeds." - Hebrews 10:24

💚 SERVING YOUR CONGREGATION 24/7
🏛️ Professional Church Communication System`;

        // Record help command usage
        await this.dbManager.recordAnalytic('help_command_used', 1, 
            `User: ${member.name} (${member.isAdmin ? 'Admin' : 'Member'})`);

        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('help_command', durationMs, true);

        logger.info(`📋 HELP command used by ${member.name} (Admin: ${member.isAdmin})`);

        return helpMessage;

    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('help_command', durationMs, false, error.message);
        
        logger.error(`❌ HELP command error: ${error.message}`);
        
        // Fallback help message if database fails
        let fallbackMessage = `📋 YESUWAY CHURCH SMS SYSTEM

💬 BASIC USAGE:
• Text anything to broadcast to congregation
• Share photos and prayer requests
• Send announcements and updates

📱 Church Number: ${config.twilio.phoneNumber}`;

        if (member.isAdmin) {
            fallbackMessage += `

🔑 ADMIN COMMANDS:
• ADD +1234567890 MemberName
• REMOVE +1234567890 MemberName
• ADMIN +1234567890 AdminName
• WIPE CONFIRM
• CLEANUP STATUS`;
        }

        fallbackMessage += `

💚 Professional Church Communication System`;

        return fallbackMessage;
    }
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

// INDUSTRIAL VIDEO QUALITY SOLUTION - Add to your ProductionChurchSMS class

// Enhanced media processing with video quality preservation
async processMediaFilesWithQualityPreservation(messageId, mediaUrls) {
    logger.info(`🎥 Processing ${mediaUrls.length} media files with quality preservation for message ${messageId}`);

    const processedLinks = [];
    const processingErrors = [];

    for (let i = 0; i < mediaUrls.length; i++) {
        const media = mediaUrls[i];
        const mediaUrl = media.url || '';
        const mediaType = media.type || 'unknown';

        try {
            logger.info(`📎 Processing media ${i + 1}/${mediaUrls.length}: ${mediaType}`);

            // Download original media from Twilio
            const mediaData = await this.downloadMediaFromTwilio(mediaUrl);

            if (!mediaData) {
                const errorMsg = `Failed to download media ${i + 1}`;
                processingErrors.push(errorMsg);
                logger.error(errorMsg);
                continue;
            }

            let processedContent = mediaData.content;
            let finalMimeType = mediaData.mimeType;
            let qualityInfo = 'original';

            // ENHANCED VIDEO PROCESSING
            if (mediaData.mimeType.includes('video')) {
                const videoResult = await this.processVideoForQuality(mediaData, i + 1);
                if (videoResult.success) {
                    processedContent = videoResult.content;
                    finalMimeType = videoResult.mimeType;
                    qualityInfo = videoResult.qualityInfo;
                    logger.info(`✅ Video ${i + 1} processed: ${videoResult.qualityInfo}`);
                } else {
                    logger.warn(`⚠️ Video processing failed, using original: ${videoResult.error}`);
                }
            }

            // ENHANCED IMAGE PROCESSING  
            else if (mediaData.mimeType.includes('image')) {
                const imageResult = await this.processImageForQuality(mediaData, i + 1);
                if (imageResult.success) {
                    processedContent = imageResult.content;
                    finalMimeType = imageResult.mimeType;
                    qualityInfo = imageResult.qualityInfo;
                    logger.info(`✅ Image ${i + 1} processed: ${imageResult.qualityInfo}`);
                }
            }

            const { cleanFilename, displayName } = this.generateCleanFilename(finalMimeType, i + 1);

            // Upload to R2 with optimized settings
            const publicUrl = await this.uploadToR2WithOptimization(
                processedContent,
                cleanFilename,
                finalMimeType,
                {
                    'original-size': mediaData.size.toString(),
                    'final-size': processedContent.length.toString(),
                    'quality-info': qualityInfo,
                    'media-index': i.toString(),
                    'display-name': displayName,
                    'processing-timestamp': new Date().toISOString()
                }
            );

            if (publicUrl) {
                // Store enhanced media information
                if (this.dbManager.isConnected) {
                    await this.dbManager.createMediaFile({
                        messageId: messageId,
                        originalUrl: mediaUrl,
                        r2ObjectKey: cleanFilename,
                        publicUrl: publicUrl,
                        cleanFilename: cleanFilename.split('/').pop(),
                        displayName: displayName,
                        originalSize: mediaData.size,
                        finalSize: processedContent.length,
                        mimeType: finalMimeType,
                        fileHash: mediaData.hash,
                        qualityInfo: qualityInfo,
                        uploadStatus: 'completed',
                        processingMetadata: {
                            qualityPreservation: true,
                            originalMimeType: mediaData.mimeType,
                            compressionRatio: (processedContent.length / mediaData.size),
                            processingTime: new Date()
                        }
                    });
                }

                processedLinks.push({
                    url: publicUrl,
                    displayName: displayName,
                    type: finalMimeType,
                    qualityInfo: qualityInfo
                });
                logger.info(`✅ Media ${i + 1} processed successfully with quality preservation`);
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

    logger.info(`✅ Quality-preserved media processing complete: ${processedLinks.length} successful, ${processingErrors.length} errors`);
    return { processedLinks, processingErrors };
}

// ENHANCED VIDEO PROCESSING WITH QUALITY PRESERVATION
async processVideoForQuality(mediaData, mediaIndex) {
    const startTime = Date.now();
    
    try {
        logger.info(`🎥 Processing video ${mediaIndex} for quality preservation`);
        
        // Check if video needs processing based on size and type
        const originalSize = mediaData.content.length;
        const sizeMB = originalSize / (1024 * 1024);
        
        // For videos larger than 10MB, apply smart compression
        if (sizeMB > 10) {
            logger.info(`🎥 Video ${mediaIndex} is ${sizeMB.toFixed(2)}MB, applying smart compression`);
            
            // OPTION 1: Convert to optimized MP4 format (requires ffmpeg in production)
            if (process.env.FFMPEG_ENABLED === 'true') {
                return await this.compressVideoWithFFmpeg(mediaData, mediaIndex);
            }
            
            // OPTION 2: Use cloud video processing service
            if (process.env.CLOUDFLARE_STREAM_ENABLED === 'true') {
                return await this.processVideoWithCloudflareStream(mediaData, mediaIndex);
            }
            
            // OPTION 3: Use AWS Elemental MediaConvert
            if (process.env.AWS_MEDIACONVERT_ENABLED === 'true') {
                return await this.processVideoWithMediaConvert(mediaData, mediaIndex);
            }
        }

        // For smaller videos or when no processing service is available
        logger.info(`🎥 Video ${mediaIndex} keeping original quality (${sizeMB.toFixed(2)}MB)`);
        
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('video_quality_processing', durationMs, true);
        
        return {
            success: true,
            content: mediaData.content,
            mimeType: mediaData.mimeType,
            qualityInfo: `original_quality_${sizeMB.toFixed(1)}MB`
        };
        
    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('video_quality_processing', durationMs, false, error.message);
        
        logger.error(`❌ Video quality processing failed: ${error.message}`);
        return {
            success: false,
            error: error.message,
            content: mediaData.content,
            mimeType: mediaData.mimeType,
            qualityInfo: 'processing_failed'
        };
    }
}

// CLOUDFLARE STREAM INTEGRATION (Recommended for production)
async processVideoWithCloudflareStream(mediaData, mediaIndex) {
    const startTime = Date.now();
    
    try {
        logger.info(`🎥 Processing video ${mediaIndex} with Cloudflare Stream`);
        
        const streamApiUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream`;
        
        // Upload to Cloudflare Stream
        const formData = new FormData();
        formData.append('file', new Blob([mediaData.content]), `church_video_${mediaIndex}_${Date.now()}.mp4`);
        formData.append('meta', JSON.stringify({
            name: `Church Video ${mediaIndex}`,
            requireSignedURLs: false
        }));

        const streamResponse = await axios.post(streamApiUrl, formData, {
            headers: {
                'Authorization': `Bearer ${process.env.CLOUDFLARE_STREAM_TOKEN}`,
                'Content-Type': 'multipart/form-data'
            },
            timeout: 300000 // 5 minutes timeout for large videos
        });

        if (streamResponse.status === 200 && streamResponse.data.success) {
            const videoId = streamResponse.data.result.uid;
            const streamUrl = `https://customer-${process.env.CLOUDFLARE_CUSTOMER_CODE}.cloudflarestream.com/${videoId}/manifest/video.m3u8`;
            const thumbnailUrl = `https://customer-${process.env.CLOUDFLARE_CUSTOMER_CODE}.cloudflarestream.com/${videoId}/thumbnails/thumbnail.jpg`;
            
            // Create an HTML5 video player response
            const optimizedVideoHtml = this.createOptimizedVideoResponse(streamUrl, thumbnailUrl, mediaIndex);
            
            const durationMs = Date.now() - startTime;
            await this.recordPerformanceMetric('cloudflare_stream_processing', durationMs, true);
            
            logger.info(`✅ Video ${mediaIndex} processed with Cloudflare Stream: ${videoId}`);
            
            return {
                success: true,
                content: Buffer.from(optimizedVideoHtml),
                mimeType: 'text/html',
                qualityInfo: `cloudflare_stream_optimized`,
                streamId: videoId,
                streamUrl: streamUrl,
                thumbnailUrl: thumbnailUrl
            };
        } else {
            throw new Error(`Cloudflare Stream API error: ${streamResponse.data.errors?.[0]?.message || 'Unknown error'}`);
        }
        
    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('cloudflare_stream_processing', durationMs, false, error.message);
        
        logger.error(`❌ Cloudflare Stream processing failed: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}



// CREATE OPTIMIZED VIDEO RESPONSE HTML
createOptimizedVideoResponse(streamUrl, thumbnailUrl, mediaIndex) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Church Video ${mediaIndex}</title>
    <style>
        body { margin: 0; padding: 20px; background: #1a1a1a; font-family: Arial, sans-serif; }
        .video-container { max-width: 800px; margin: 0 auto; }
        .church-header { text-align: center; color: white; margin-bottom: 20px; }
        .video-player { width: 100%; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
        .video-info { color: #ccc; text-align: center; margin-top: 15px; }
        .quality-badge { background: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
    </style>
</head>
<body>
    <div class="video-container">
        <div class="church-header">
            <h2>🏛️ YesuWay Church Video ${mediaIndex}</h2>
            <span class="quality-badge">HD Quality Preserved</span>
        </div>
        <video class="video-player" controls preload="metadata" poster="${thumbnailUrl}">
            <source src="${streamUrl}" type="application/x-mpegURL">
            <p>Your browser doesn't support HTML5 video. <a href="${streamUrl}">Download the video</a> instead.</p>
        </video>
        <div class="video-info">
            <p>Professional quality video streaming powered by Cloudflare</p>
        </div>
    </div>
</body>
</html>`;
}



// AWS ELEMENTAL MEDIACONVERT INTEGRATION
async processVideoWithMediaConvert(mediaData, mediaIndex) {
    const startTime = Date.now();
    
    try {
        logger.info(`🎥 Processing video ${mediaIndex} with AWS MediaConvert`);
        
        const AWS = require('aws-sdk');
        const mediaConvert = new AWS.MediaConvert({
            region: process.env.AWS_REGION || 'us-east-1',
            endpoint: process.env.AWS_MEDIACONVERT_ENDPOINT
        });
        
        // First, upload original video to S3
        const s3Key = `church/videos/original_${mediaIndex}_${Date.now()}.mp4`;
        const s3Url = await this.uploadToS3(mediaData.content, s3Key, mediaData.mimeType);
        
        // Create MediaConvert job for optimization
        const jobParams = {
            Role: process.env.AWS_MEDIACONVERT_ROLE,
            Settings: {
                Inputs: [{
                    FileInput: s3Url,
                    VideoSelector: {},
                    AudioSelectors: {
                        'Audio Selector 1': {
                            DefaultSelection: 'DEFAULT'
                        }
                    }
                }],
                OutputGroups: [{
                    Name: 'Church Video Optimized',
                    OutputGroupSettings: {
                        Type: 'FILE_GROUP_SETTINGS',
                        FileGroupSettings: {
                            Destination: `s3://${process.env.AWS_S3_BUCKET}/church/videos/optimized/`
                        }
                    },
                    Outputs: [{
                        NameModifier: `_optimized_${mediaIndex}`,
                        VideoDescription: {
                            CodecSettings: {
                                Codec: 'H_264',
                                H264Settings: {
                                    RateControlMode: 'QVBR',
                                    QvbrSettings: {
                                        QvbrQualityLevel: 8 // High quality
                                    },
                                    MaxBitrate: 5000000, // 5 Mbps max
                                    FramerateControl: 'SPECIFIED',
                                    FramerateNumerator: 30,
                                    FramerateDenominator: 1
                                }
                            },
                            Width: 1920,
                            Height: 1080
                        },
                        AudioDescriptions: [{
                            CodecSettings: {
                                Codec: 'AAC',
                                AacSettings: {
                                    Bitrate: 128000,
                                    SampleRate: 48000
                                }
                            }
                        }],
                        ContainerSettings: {
                            Container: 'MP4'
                        }
                    }]
                }]
            }
        };
        
        const job = await mediaConvert.createJob(jobParams).promise();
        const jobId = job.Job.Id;
        
        // Wait for job completion (with timeout)
        const optimizedUrl = await this.waitForMediaConvertJob(jobId, 300000); // 5 min timeout
        
        // Download optimized video
        const optimizedContent = await this.downloadFromS3(optimizedUrl);
        
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('mediaconvert_processing', durationMs, true);
        
        logger.info(`✅ Video ${mediaIndex} optimized with MediaConvert`);
        
        return {
            success: true,
            content: optimizedContent,
            mimeType: 'video/mp4',
            qualityInfo: `mediaconvert_optimized_${Math.round(optimizedContent.length / (1024 * 1024))}MB`
        };
        
    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('mediaconvert_processing', durationMs, false, error.message);
        
        logger.error(`❌ MediaConvert processing failed: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

// ENHANCED R2 UPLOAD WITH VIDEO OPTIMIZATION
async uploadToR2WithOptimization(fileContent, objectKey, mimeType, metadata = {}) {
    const startTime = Date.now();
    try {
        logger.info(`☁️ Uploading optimized media to R2: ${objectKey}`);

        const uploadMetadata = {
            'church-system': 'yesuway-production',
            'upload-timestamp': new Date().toISOString(),
            'content-hash': crypto.createHash('sha256').update(fileContent).digest('hex'),
            'optimization-applied': 'true',
            ...metadata
        };

        const params = {
            Bucket: config.r2.bucketName,
            Key: objectKey,
            Body: fileContent,
            ContentType: mimeType,
            ContentDisposition: 'inline',
            CacheControl: 'public, max-age=31536000', // 1 year cache
            Metadata: uploadMetadata,
            ServerSideEncryption: 'AES256'
        };

        // Add video-specific optimizations
        if (mimeType.includes('video')) {
            params.ContentEncoding = 'identity';
            params.CacheControl = 'public, max-age=604800'; // 1 week cache for videos
        }

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
        await this.recordPerformanceMetric('r2_optimized_upload', durationMs, true);

        logger.info(`✅ Optimized upload successful: ${publicUrl}`);
        return publicUrl;
    } catch (error) {
        const durationMs = Date.now() - startTime;
        await this.recordPerformanceMetric('r2_optimized_upload', durationMs, false, error.message);
        logger.error(`❌ R2 optimized upload failed: ${error.message}`);
        return null;
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




// Enhanced handleIncomingMessage method with WIPE and ADMIN commands
// Replace your existing handleIncomingMessage method in app.js with this version

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
                return await this.generateHelpMessage(member);
            }

            // Check for ADD command (admin only)
            if (messageBody.toUpperCase().startsWith('ADD ')) {
                return await this.handleAddMemberCommand(fromPhone, messageBody);
            }

            // Check for REMOVE command (admin only)
            if (messageBody.toUpperCase().startsWith('REMOVE ')) {
                return await this.handleRemoveMemberCommand(fromPhone, messageBody);
            }

            // Check for WIPE command (admin only) - DANGEROUS OPERATION
            if (messageBody.toUpperCase().startsWith('WIPE ') || messageBody.toUpperCase() === 'WIPE') {
                return await this.handleWipeCommand(fromPhone, messageBody);
            }

            // Check for ADMIN command (admin only) - PRIVILEGE MANAGEMENT
            if (messageBody.toUpperCase().startsWith('ADMIN ')) {
                return await this.handleAdminCommand(fromPhone, messageBody);
            }

            // Check for DEMOTE command (admin only) - REMOVE ADMIN PRIVILEGES
            if (messageBody.toUpperCase().startsWith('DEMOTE ')) {
                return await this.handleDemoteCommand(fromPhone, messageBody);
            }

            // Check for CLEANUP command (admin only)
            if (messageBody.toUpperCase().startsWith('CLEANUP ') || messageBody.toUpperCase() === 'CLEANUP') {
                return await this.handleCleanupCommand(fromPhone, messageBody);
            }

            // QUALITY PROCESSING LOGIC
            if (mediaUrls && mediaUrls.length > 0) {
                logger.info('🎬 Analyzing media for quality upgrade opportunity...');
                
                // Quick quality check (don't delay broadcast)
                const hasQualityIndicators = this.hasQualityIndicators(messageBody, mediaUrls);
                
                if (hasQualityIndicators) {
                    logger.info('🔍 Quality indicators detected - using dual-track processing');
                    return await this.handleDualTrackMedia(fromPhone, messageBody, mediaUrls, member);
                }
            }

            // Regular message broadcasting
            logger.info('📡 Processing standard message broadcast...');
            return await this.broadcastMessage(fromPhone, messageBody, mediaUrls);
            
        } catch (error) {
            logger.error(`❌ Message processing error: ${error.message}`);
            logger.error(`❌ Stack trace: ${error.stack}`);
            return "Message processing temporarily unavailable - please try again";
        }
    }

    // Quick quality indicator check (no async operations)
    hasQualityIndicators(messageBody, mediaUrls) {
        const qualityKeywords = ['hd', 'quality', 'clear', 'important', 'sermon', 'special'];
        const hasKeywords = qualityKeywords.some(keyword => 
            messageBody.toLowerCase().includes(keyword)
        );
        
        const hasVideo = mediaUrls.some(media => 
            media.type && media.type.includes('video')
        );
        
        const hasMultipleMedia = mediaUrls.length > 1;
        
        return hasKeywords || hasVideo || hasMultipleMedia;
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
            if (process.env.CLOUDFLARE_STREAM_ENABLED === 'true') {
                const isStreamValid = await smsSystem.validateCloudflareStreamConfig();
                healthData.cloudflare_stream = {
                    status: isStreamValid ? "connected" : "configuration_error",
                    enabled: true,
                    account_id: process.env.CLOUDFLARE_ACCOUNT_ID ? "configured" : "missing"
                };
            } else {
                healthData.cloudflare_stream = { status: "disabled" };
            }
        } catch (error) {
            healthData.cloudflare_stream = { status: "error", error: error.message };
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

// QUALITY UPGRADE ROUTES - ADD BEFORE error handlers

app.get('/quality/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const session = await smsSystem.dbManager.getQualityUpgradeSession(token);
        
        if (!session) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html><head><title>Upload Expired</title>
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <style>body{font-family:Arial;padding:20px;text-align:center;background:#f5f5f5}
                .container{max-width:400px;margin:0 auto;background:white;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
                .error{color:#e74c3c}</style></head>
                <body><div class="container">
                <h2 class="error">⏰ Upload Link Expired</h2>
                <p>This quality upgrade link has expired or is invalid.</p>
                <p>Send a new message to get a fresh upload link.</p>
                </div></body></html>
            `);
        }
        
        // Serve upload interface
        const uploadHTML = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>🏛️ YesuWay Church - HD Upload</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh; padding: 20px; 
                    }
                    .container { 
                        max-width: 500px; margin: 20px auto; background: white;
                        border-radius: 15px; overflow: hidden;
                        box-shadow: 0 20px 40px rgba(0,0,0,0.15);
                    }
                    .header { 
                        background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
                        color: white; padding: 30px; text-align: center;
                    }
                    .content { padding: 30px; }
                    .upload-area {
                        border: 3px dashed #ddd; border-radius: 10px; padding: 40px;
                        text-align: center; margin: 20px 0; cursor: pointer;
                        transition: all 0.3s ease;
                    }
                    .upload-area:hover { border-color: #4facfe; background: #f8f9fa; }
                    .upload-area.dragover { border-color: #4facfe; background: #e3f2fd; }
                    input[type="file"] { display: none; }
                    .btn {
                        background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
                        color: white; border: none; padding: 15px 30px;
                        border-radius: 25px; font-size: 16px; font-weight: 600;
                        cursor: pointer; width: 100%; margin: 10px 0;
                        transition: transform 0.2s ease;
                    }
                    .btn:hover { transform: translateY(-2px); }
                    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
                    .progress { 
                        width: 100%; height: 8px; background: #eee;
                        border-radius: 4px; margin: 20px 0; overflow: hidden;
                    }
                    .progress-bar {
                        height: 100%; background: linear-gradient(90deg, #4facfe, #00f2fe);
                        width: 0%; transition: width 0.3s ease;
                    }
                    .status { 
                        padding: 15px; border-radius: 8px; margin: 15px 0;
                        text-align: center; font-weight: 500;
                    }
                    .status.success { background: #d4edda; color: #155724; }
                    .status.error { background: #f8d7da; color: #721c24; }
                    .status.info { background: #d1ecf1; color: #0c5460; }
                    .member-info {
                        background: #f8f9fa; padding: 20px; border-radius: 8px;
                        margin-bottom: 20px; border-left: 4px solid #4facfe;
                    }
                    .file-info {
                        background: #f8f9fa; padding: 15px; border-radius: 8px;
                        margin: 10px 0; text-align: left;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🏛️ YesuWay Church</h1>
                        <p>HD Quality Upload</p>
                    </div>
                    
                    <div class="content">
                        <div class="member-info">
                            <strong>📱 From:</strong> ${session.fromName}<br>
                            <strong>⏰ Expires:</strong> ${session.expiresAt.toLocaleString()}<br>
                            <strong>📊 Original:</strong> ${session.originalMediaUrls.length} file(s)
                        </div>
                        
                        <div class="upload-area" onclick="document.getElementById('fileInput').click()">
                            <h3>📁 Select HD Media Files</h3>
                            <p>Click here or drag files to upload</p>
                            <p style="color: #666; font-size: 14px; margin-top: 10px;">
                                Supports: Photos, Videos, Audio<br>
                                Maximum quality preserved
                            </p>
                        </div>
                        
                        <input type="file" id="fileInput" multiple accept="image/*,video/*,audio/*">
                        
                        <div id="fileList"></div>
                        <div id="progress" class="progress" style="display: none;">
                            <div id="progressBar" class="progress-bar"></div>
                        </div>
                        <div id="status"></div>
                        
                        <button id="uploadBtn" class="btn" style="display: none;">
                            📤 Upload HD Quality
                        </button>
                    </div>
                </div>
                
                <script>
                    const fileInput = document.getElementById('fileInput');
                    const uploadArea = document.querySelector('.upload-area');
                    const fileList = document.getElementById('fileList');
                    const uploadBtn = document.getElementById('uploadBtn');
                    const status = document.getElementById('status');
                    const progress = document.getElementById('progress');
                    const progressBar = document.getElementById('progressBar');
                    
                    let selectedFiles = [];
                    
                    // Drag and drop handlers
                    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                        uploadArea.addEventListener(eventName, preventDefaults, false);
                    });
                    
                    function preventDefaults(e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    
                    ['dragenter', 'dragover'].forEach(eventName => {
                        uploadArea.addEventListener(eventName, () => uploadArea.classList.add('dragover'), false);
                    });
                    
                    ['dragleave', 'drop'].forEach(eventName => {
                        uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('dragover'), false);
                    });
                    
                    uploadArea.addEventListener('drop', handleDrop, false);
                    
                    function handleDrop(e) {
                        const dt = e.dataTransfer;
                        const files = dt.files;
                        handleFiles(files);
                    }
                    
                    fileInput.addEventListener('change', (e) => {
                        handleFiles(e.target.files);
                    });
                    
                    function handleFiles(files) {
                        selectedFiles = Array.from(files);
                        displayFiles();
                        uploadBtn.style.display = selectedFiles.length > 0 ? 'block' : 'none';
                    }
                    
                    function displayFiles() {
                        fileList.innerHTML = '';
                        selectedFiles.forEach((file, index) => {
                            const fileDiv = document.createElement('div');
                            fileDiv.className = 'file-info';
                            fileDiv.innerHTML = \`
                                <strong>\${file.name}</strong><br>
                                Size: \${(file.size / 1024 / 1024).toFixed(2)} MB<br>
                                Type: \${file.type}
                            \`;
                            fileList.appendChild(fileDiv);
                        });
                    }
                    
                    uploadBtn.addEventListener('click', async () => {
                        if (selectedFiles.length === 0) return;
                        
                        uploadBtn.disabled = true;
                        progress.style.display = 'block';
                        status.innerHTML = '<div class="status info">📤 Uploading HD quality media...</div>';
                        
                        const formData = new FormData();
                        selectedFiles.forEach((file, index) => {
                            formData.append('media', file);
                        });
                        
                        try {
                            const response = await fetch('/quality/${token}/upload', {
                                method: 'POST',
                                body: formData
                            });
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                progressBar.style.width = '100%';
                                status.innerHTML = \`
                                    <div class="status success">
                                        ✅ HD Upload Successful!<br>
                                        \${result.processedCount} file(s) processed<br>
                                        Congregation will receive HD version automatically
                                    </div>
                                \`;
                                uploadBtn.style.display = 'none';
                                
                                // Auto-close after 3 seconds
                                setTimeout(() => {
                                    window.close();
                                }, 3000);
                            } else {
                                throw new Error(result.error || 'Upload failed');
                            }
                        } catch (error) {
                            status.innerHTML = \`
                                <div class="status error">
                                    ❌ Upload Failed<br>
                                    \${error.message}
                                </div>
                            \`;
                            uploadBtn.disabled = false;
                            progress.style.display = 'none';
                        }
                    });
                </script>
            </body>
            </html>
        `;
        
        res.send(uploadHTML);
        
    } catch (error) {
        logger.error(`❌ Quality upload page error: ${error.message}`);
        res.status(500).send('Internal server error');
    }
});

app.post('/quality/:token/upload', async (req, res) => {
    try {
        const token = req.params.token;
        const session = await smsSystem.dbManager.getQualityUpgradeSession(token);
        
        if (!session) {return res.status(404).json({ 
               success: false, 
               error: 'Upload session expired or invalid' 
           });
       }
       
       if (!req.files || req.files.length === 0) {
           return res.status(400).json({ 
               success: false, 
               error: 'No files uploaded' 
           });
       }
       
       logger.info(`📤 Processing HD upload for session ${token}: ${req.files.length} files`);
       
       // Process uploaded files with maximum quality preservation
       const processedMedia = [];
       const processingErrors = [];
       
       for (let i = 0; i < req.files.length; i++) {
           const file = req.files[i];
           
           try {
               logger.info(`🔄 Processing HD file ${i + 1}: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
               
               // Generate clean filename
               const { cleanFilename, displayName } = smsSystem.generateCleanFilename(file.mimetype, i + 1);
               
               // Upload directly to R2 with maximum quality settings
               const publicUrl = await smsSystem.uploadToR2WithOptimization(
                   file.buffer,
                   cleanFilename,
                   file.mimetype,
                   {
                       'original-filename': file.originalname,
                       'upload-method': 'hd-quality-upgrade',
                       'session-token': token,
                       'file-size': file.size.toString(),
                       'quality-mode': 'maximum',
                       'compression': 'none'
                   }
               );
               
               if (publicUrl) {
                   processedMedia.push({
                       url: publicUrl,
                       displayName,
                       type: file.mimetype,
                       size: file.size,
                       r2ObjectKey: cleanFilename
                   });
                   
                   // Store in database
                   if (smsSystem.dbManager.isConnected) {
                       await smsSystem.dbManager.createMediaFile({
                           messageId: session.originalMessageId,
                           originalUrl: 'hd-upload',
                           r2ObjectKey: cleanFilename,
                           publicUrl: publicUrl,
                           cleanFilename: cleanFilename.split('/').pop(),
                           displayName: displayName,
                           originalSize: file.size,
                           finalSize: file.size,
                           mimeType: file.mimetype,
                           fileHash: require('crypto').createHash('sha256').update(file.buffer).digest('hex'),
                           uploadStatus: 'completed',
                           qualityInfo: 'hd-original-quality',
                           streamOptimized: false,
                           processingMetadata: {
                               uploadMethod: 'hd-quality-upgrade',
                               originalFilename: file.originalname,
                               sessionToken: token,
                               qualityMode: 'maximum'
                           }
                       });
                   }
                   
                   logger.info(`✅ HD file ${i + 1} processed successfully: ${displayName}`);
               } else {
                   processingErrors.push(`Failed to upload ${file.originalname}`);
               }
               
           } catch (fileError) {
               logger.error(`❌ Error processing HD file ${i + 1}: ${fileError.message}`);
               processingErrors.push(`Error processing ${file.originalname}: ${fileError.message}`);
           }
       }
       
       if (processedMedia.length === 0) {
           return res.status(500).json({
               success: false,
               error: 'Failed to process any files',
               details: processingErrors
           });
       }
       
       // Update session with uploaded media
       await smsSystem.dbManager.updateQualityUpgradeSession(token, {
           upgradedMediaUrls: processedMedia,
           status: 'uploaded'
       });
       
       // Broadcast HD version to congregation
       const hdBroadcastResult = await smsSystem.broadcastHDUpgrade(session, processedMedia);
       
       // Update session status
       await smsSystem.dbManager.updateQualityUpgradeSession(token, {
           status: 'broadcast',
           upgradeCompleted: true
       });
       
       // Log analytics
       await smsSystem.dbManager.recordAnalytic('hd_upgrade_completed', processedMedia.length,
           `User: ${session.fromName}, Files: ${processedMedia.length}, Errors: ${processingErrors.length}`);
       
       logger.info(`✅ HD upgrade completed for ${session.fromName}: ${processedMedia.length} files broadcast`);
       
       res.json({
           success: true,
           processedCount: processedMedia.length,
           errorCount: processingErrors.length,
           broadcastResult: hdBroadcastResult,
           message: 'HD quality upload successful - congregation notified'
       });
       
   } catch (error) {
       logger.error(`❌ HD upload processing error: ${error.message}`);
       res.status(500).json({
           success: false,
           error: 'Upload processing failed',
           details: error.message
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