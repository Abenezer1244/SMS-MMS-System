#!/usr/bin/env node

/**
 * YesuWay Church SMS System - MongoDB Setup Script
 * 
 * This script initializes the MongoDB database and sets up the production congregation.
 * Run this script once before deploying to production.
 * 
 * Usage: node setup.js
 */

const mongoose = require('mongoose');
const MongoDBManager = require('./database');
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

// Load environment variables
require('dotenv').config();

console.log('🏛️ YesuWay Church SMS System - MongoDB Setup');
console.log('================================================');

class MongoDBSetup {
    constructor() {
        this.dbManager = new MongoDBManager(console);
        this.connectionString = this.buildConnectionString();
    }

    buildConnectionString() {
        const {
            MONGODB_URI,
            MONGODB_HOST = 'localhost',
            MONGODB_PORT = '27017',
            MONGODB_DATABASE = 'yesuway_church',
            MONGODB_USERNAME,
            MONGODB_PASSWORD,
            MONGODB_AUTH_SOURCE = 'admin'
        } = process.env;

        // If MONGODB_URI is provided, use it directly
        if (MONGODB_URI) {
            return MONGODB_URI;
        }

        // Build connection string from components
        let connectionString = 'mongodb://';
        
        if (MONGODB_USERNAME && MONGODB_PASSWORD) {
            connectionString += `${encodeURIComponent(MONGODB_USERNAME)}:${encodeURIComponent(MONGODB_PASSWORD)}@`;
        }
        
        connectionString += `${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}`;
        
        if (MONGODB_USERNAME && MONGODB_PASSWORD) {
            connectionString += `?authSource=${MONGODB_AUTH_SOURCE}`;
        }

        return connectionString;
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
            console.warn(`⚠️ Invalid phone number format: ${phone}`);
            return phone;
        }
    }

    // IMMEDIATE FIX for setup.js
// Replace lines around 99-113 in your setup.js file

async connectToDatabase() {
    console.log('📋 Step 1: Connecting to MongoDB...');
    
    try {
        // FIXED: Removed ALL deprecated options
        const options = {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            retryWrites: true,
            retryReads: true
            
            // REMOVED these deprecated options that cause the error:
            // bufferCommands: false,     ❌ CAUSES ERROR
            // bufferMaxEntries: 0        ❌ CAUSES ERROR
        };

        // Set mongoose settings
        mongoose.set('strictQuery', false);
        mongoose.set('bufferCommands', false); // Set at mongoose level instead

        await this.dbManager.connect(this.connectionString, options);
        console.log('✅ MongoDB connection established successfully');
        
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('   • Ensure MongoDB is running');
        console.log('   • Check connection string format');
        console.log('   • Verify username/password if using authentication');
        console.log('   • Ensure network connectivity to MongoDB server');
        throw error;
    }
}

    async setupCollections() {
        console.log('📋 Step 2: Setting up collections and indexes...');
        
        try {
            // MongoDB will automatically create collections when documents are inserted
            // But we can ensure indexes are created properly
            await this.createIndexes();
            console.log('✅ Collections and indexes configured successfully');
            
        } catch (error) {
            console.error('❌ Failed to setup collections:', error.message);
            throw error;
        }
    }

    async createIndexes() {
        try {
            // Create indexes for optimal performance
            const indexOperations = [
                // Member indexes
                Member.createIndexes([
                    { phoneNumber: 1 },
                    { active: 1, phoneNumber: 1 },
                    { 'groups.groupId': 1 }
                ]),
                
                // Group indexes
                Group.createIndexes([
                    { active: 1, name: 1 }
                ]),
                
                // BroadcastMessage indexes
                BroadcastMessage.createIndexes([
                    { sentAt: -1, isReaction: 1 },
                    { fromPhone: 1, sentAt: -1 },
                    { targetMessageId: 1 }
                ]),
                
                // MessageReaction indexes
                MessageReaction.createIndexes([
                    { targetMessageId: 1, isProcessed: 1 },
                    { createdAt: -1 }
                ]),
                
                // MediaFile indexes
                MediaFile.createIndexes([
                    { messageId: 1 },
                    { uploadStatus: 1 }
                ]),
                
                // DeliveryLog indexes
                DeliveryLog.createIndexes([
                    { messageId: 1, deliveryStatus: 1 },
                    { deliveredAt: -1 }
                ]),
                
                // Analytics indexes
                SystemAnalytics.createIndexes([
                    { metricName: 1, recordedAt: -1 }
                ]),
                
                // Performance indexes
                PerformanceMetrics.createIndexes([
                    { operationType: 1, recordedAt: -1 }
                ])
            ];

            await Promise.all(indexOperations);
            console.log('✅ Database indexes created successfully');
            
        } catch (error) {
            console.error('❌ Failed to create indexes:', error.message);
            throw error;
        }
    }

    async initializeGroups() {
        console.log('📋 Step 3: Initializing groups...');
        
        try {
            const existingGroups = await this.dbManager.getAllGroups();
            
            if (existingGroups.length === 0) {
                const productionGroups = [
                    { name: "YesuWay Congregation", description: "Main congregation group" },
                    { name: "Church Leadership", description: "Leadership and admin group" },
                    { name: "Media Team", description: "Media and technology team" }
                ];

                for (const groupData of productionGroups) {
                    await this.dbManager.createGroup(groupData.name, groupData.description);
                    console.log(`✅ Created group: ${groupData.name}`);
                }
                
                console.log('✅ Production groups initialized');
            } else {
                console.log('ℹ️ Groups already exist, skipping initialization');
            }
            
        } catch (error) {
            console.error('❌ Failed to initialize groups:', error.message);
            throw error;
        }
    }

    async setupProductionCongregation() {
        console.log('📋 Step 4: Setting up production congregation...');
        
        try {
            // Get groups for reference
            const congregationGroup = await this.dbManager.getGroupByName("YesuWay Congregation");
            const leadershipGroup = await this.dbManager.getGroupByName("Church Leadership");
            const mediaGroup = await this.dbManager.getGroupByName("Media Team");

            if (!congregationGroup || !leadershipGroup || !mediaGroup) {
                throw new Error("Required groups not found. Please run group initialization first.");
            }

            // Add primary admin
            const adminPhone = this.cleanPhoneNumber("+14257729189");
            let admin = await this.dbManager.getMemberByPhone(adminPhone);
            
            if (!admin) {
                admin = await this.dbManager.createMember({
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
                console.log(`✅ Created admin: Church Admin (${adminPhone})`);
            } else {
                console.log(`ℹ️ Admin already exists: ${admin.name}`);
            }

            // Add production members
            const productionMembers = [
                { phone: "+12068001141", name: "Mike", groupName: "YesuWay Congregation" },
                { phone: "+14257729189", name: "Sam", groupName: "YesuWay Congregation" },
                { phone: "+12065910943", name: "Sami", groupName: "Media Team" },
                { phone: "+12064349652", name: "Yab", groupName: "YesuWay Congregation" }
            ];

            for (const memberData of productionMembers) {
                const cleanPhone = this.cleanPhoneNumber(memberData.phone);
                let member = await this.dbManager.getMemberByPhone(cleanPhone);
                
                // Get target group
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
                    member = await this.dbManager.createMember({
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
                    console.log(`✅ Added member: ${memberData.name} (${cleanPhone}) to ${targetGroup.name}`);
                } else {
                    // Check if member is already in the target group
                    const isInGroup = member.groups.some(g => g.groupId.toString() === targetGroup._id.toString());
                    if (!isInGroup) {
                        await this.dbManager.addMemberToGroup(member._id, targetGroup._id);
                        console.log(`✅ Added existing member ${member.name} to ${targetGroup.name}`);
                    } else {
                        console.log(`ℹ️ Member ${member.name} already in ${targetGroup.name}`);
                    }
                }
            }

            console.log('✅ Production congregation setup completed');
            
        } catch (error) {
            console.error('❌ Failed to setup production congregation:', error.message);
            throw error;
        }
    }

    async addCustomMembers() {
        console.log('📋 Step 5: Custom member addition...');
        
        // Configure your congregation members here
        const customMembers = [
            // Add your congregation members in this format:
             { phone: "+14257729189", name: "mike", groupName: "YesuWay Congregation" },
             { phone: "+12068001141", name: "michael", groupName: "Church Leadership" },
            // { phone: "+15551234569", name: "Tech Person", groupName: "Media Team" },
        ];

        if (customMembers.length === 0) {
            console.log('ℹ️ No custom members configured. Edit setup.js to add your congregation.');
            console.log('💡 Add members to the customMembers array above this message.');
            return;
        }

        try {
            // Get groups for reference
            const groups = await this.dbManager.getAllGroups();
            const groupMap = {};
            groups.forEach(group => {
                groupMap[group.name] = group;
            });

            for (const memberData of customMembers) {
                const cleanPhone = this.cleanPhoneNumber(memberData.phone);
                const targetGroup = groupMap[memberData.groupName] || groupMap["YesuWay Congregation"];
                
                let member = await this.dbManager.getMemberByPhone(cleanPhone);
                
                if (!member) {
                    member = await this.dbManager.createMember({
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
                    console.log(`✅ Added custom member: ${memberData.name} (${cleanPhone}) to ${targetGroup.name}`);
                } else {
                    console.log(`ℹ️ Custom member already exists: ${member.name}`);
                }
            }

            console.log(`✅ Processed ${customMembers.length} custom members`);
            
        } catch (error) {
            console.error('❌ Failed to add custom members:', error.message);
            throw error;
        }
    }

    async verifySetup() {
        console.log('📋 Step 6: Verifying setup...');
        
        try {
            const stats = await this.dbManager.getHealthStats();
            const groups = await this.dbManager.getAllGroups();
            
            console.log('📊 Setup Verification:');
            console.log(`   Groups: ${groups.length}`);
            console.log(`   Active Members: ${stats.activeMemberCount}`);
            
            // List groups
            console.log('\n📁 Available Groups:');
            for (const group of groups) {
                console.log(`   • ${group.name} - ${group.description}`);
            }

            // List all members with their groups
            const members = await this.dbManager.getAllActiveMembers();
            console.log('\n👥 Registered Members:');
            
            for (const member of members) {
                const role = member.isAdmin ? '(Admin)' : '';
                const groupNames = member.groups.map(g => g.groupId.name).join(', ');
                console.log(`   • ${member.name} ${role} - ${member.phoneNumber} - Groups: ${groupNames}`);
            }

            if (stats.activeMemberCount === 0) {
                console.warn('⚠️ No members found! The system requires at least one member to function.');
                console.log('💡 Edit the customMembers array in setup.js to add your congregation.');
            }

            console.log('\n✅ Database setup verification completed');
            
        } catch (error) {
            console.error('❌ Failed to verify setup:', error.message);
            throw error;
        }
    }

    async checkEnvironment() {
        console.log('📋 Step 7: Environment validation...');
        
        const requiredEnvVars = [
            'TWILIO_ACCOUNT_SID',
            'TWILIO_AUTH_TOKEN', 
            'TWILIO_PHONE_NUMBER',
            'R2_ACCESS_KEY_ID',
            'R2_SECRET_ACCESS_KEY',
            'R2_ENDPOINT_URL',
            'R2_BUCKET_NAME'
        ];

        const mongoEnvVars = [
            'MONGODB_URI', // OR the combination below
            'MONGODB_HOST',
            'MONGODB_PORT',
            'MONGODB_DATABASE'
        ];

        const missing = [];
        const invalid = [];

        // Check Twilio and R2 vars
        for (const envVar of requiredEnvVars) {
            const value = process.env[envVar];
            if (!value) {
                missing.push(envVar);
            } else if (value.includes('your_') || value.includes('_here') || value === 'not_configured') {
                invalid.push(envVar);
            }
        }

        // Check MongoDB configuration
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            // Check individual components
            if (!process.env.MONGODB_HOST) missing.push('MONGODB_HOST (or MONGODB_URI)');
            if (!process.env.MONGODB_DATABASE) missing.push('MONGODB_DATABASE (or MONGODB_URI)');
        }

        // Validate specific formats
        if (process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
            invalid.push('TWILIO_ACCOUNT_SID (must start with AC)');
        }

        if (process.env.R2_ENDPOINT_URL && !process.env.R2_ENDPOINT_URL.startsWith('https://')) {
            invalid.push('R2_ENDPOINT_URL (must start with https://)');
        }

        if (missing.length > 0) {
            console.log('❌ Missing required environment variables:');
            for (const envVar of missing) {
                console.log(`   • ${envVar}`);
            }
        }

        if (invalid.length > 0) {
            console.log('❌ Environment variables with invalid/placeholder values:');
            for (const envVar of invalid) {
                console.log(`   • ${envVar}: ${process.env[envVar]}`);
            }
        }

        if (missing.length === 0 && invalid.length === 0) {
            console.log('✅ All environment variables are properly configured');
            console.log('✅ System ready for production deployment');
        } else {
            console.log('\n❌ ENVIRONMENT CONFIGURATION REQUIRED');
            console.log('');
            console.log('💡 Required actions:');
            console.log('   1. Create .env file with proper credentials');
            console.log('   2. Set all required environment variables');
            console.log('   3. Ensure values are not placeholders');
            console.log('   4. Restart the application after configuration');
            console.log('');
            console.log('📝 Example .env file:');
            console.log('   # MongoDB Configuration');
            console.log('   MONGODB_URI=mongodb://localhost:27017/yesuway_church');
            console.log('   # OR individual components:');
            console.log('   MONGODB_HOST=localhost');
            console.log('   MONGODB_PORT=27017');
            console.log('   MONGODB_DATABASE=yesuway_church');
            console.log('   MONGODB_USERNAME=church_user');
            console.log('   MONGODB_PASSWORD=secure_password');
            console.log('');
            console.log('   # Twilio Configuration');
            console.log('   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
            console.log('   TWILIO_AUTH_TOKEN=your_auth_token_from_twilio');
            console.log('   TWILIO_PHONE_NUMBER=+1234567890');
            console.log('');
            console.log('   # Cloudflare R2 Configuration');
            console.log('   R2_ACCESS_KEY_ID=your_cloudflare_r2_access_key');
            console.log('   R2_SECRET_ACCESS_KEY=your_cloudflare_r2_secret_key');
            console.log('   R2_ENDPOINT_URL=https://account.r2.cloudflarestorage.com');
            console.log('   R2_BUCKET_NAME=your-church-media-bucket');
            console.log('   R2_PUBLIC_URL=https://media.yourchurch.org');
            
            console.log('\n🚨 PRODUCTION DEPLOYMENT WILL FAIL WITHOUT PROPER CONFIGURATION');
        }
    }

    async testDatabaseOperations() {
        console.log('📋 Step 8: Testing database operations...');
        
        try {
            // Test basic operations
            const testOperations = [
                // Test member operations
                async () => {
                    const members = await this.dbManager.getAllActiveMembers();
                    return members.length >= 0;
                },
                
                // Test group operations
                async () => {
                    const groups = await this.dbManager.getAllGroups();
                    return groups.length >= 0;
                },
                
                // Test analytics recording
                async () => {
                    await this.dbManager.recordAnalytic('setup_test', 1, 'Setup verification test');
                    return true;
                },
                
                // Test performance metrics
                async () => {
                    await this.dbManager.recordPerformanceMetric('setup_test', 100, true);
                    return true;
                }
            ];

            for (let i = 0; i < testOperations.length; i++) {
                const operation = testOperations[i];
                const result = await operation();
                if (!result) {
                    throw new Error(`Test operation ${i + 1} failed`);
                }
            }

            console.log('✅ All database operations tested successfully');
            
        } catch (error) {
            console.error('❌ Database operation test failed:', error.message);
            throw error;
        }
    }

    async run() {
        try {
            console.log('🚀 Starting production MongoDB setup...\n');
            
            await this.connectToDatabase();
            await this.setupCollections();
            await this.initializeGroups();
            await this.setupProductionCongregation();
            await this.addCustomMembers();
            await this.verifySetup();
            await this.testDatabaseOperations();
            await this.checkEnvironment();
            
            console.log('\n🎉 Production MongoDB setup completed successfully!');
            console.log('\n📝 Next steps for production deployment:');
            console.log('   1. ✅ Configure environment variables (.env file)');
            console.log('   2. ✅ Deploy to hosting platform (Render.com recommended)');
            console.log('   3. ✅ Configure Twilio webhook URL');
            console.log('   4. ✅ Set up A2P 10DLC registration with Twilio');
            console.log('   5. ✅ Configure Cloudflare R2 bucket and domain');
            console.log('   6. ✅ Ensure MongoDB is accessible from production environment');
            console.log('   7. ✅ Send first message to church number');
            console.log('\n💚 Your production church SMS system with MongoDB is ready to serve!');
            console.log('🏛️ Professional church communication platform');
            console.log('🔇 Smart reaction tracking with silent processing');
            console.log('🧹 Clean media display with professional presentation');
            console.log('🛡️ Secure registration-only member access');
            console.log('🗄️ MongoDB database for scalable performance');
            
        } catch (error) {
            console.error('\n❌ Production setup failed:', error.message);
            console.error('Stack trace:', error.stack);
            console.log('\n🔧 Troubleshooting:');
            console.log('   • Ensure MongoDB is running and accessible');
            console.log('   • Check MongoDB connection string format');
            console.log('   • Verify MongoDB authentication credentials');
            console.log('   • Ensure network connectivity to MongoDB server');
            console.log('   • Check MongoDB server logs for connection issues');
            process.exit(1);
        } finally {
            if (this.dbManager.isConnected) {
                await this.dbManager.disconnect();
            }
        }
    }
}

// Production environment check
const fs = require('fs');
if (!fs.existsSync('.env')) {
    console.log('⚠️ No .env file found.');
    console.log('💡 Create .env file with your production credentials before deployment.');
    console.log('📋 Required environment variables will be validated during setup.\n');
}

// Run production setup
const setup = new MongoDBSetup();
setup.run();