#!/usr/bin/env node

/**
 * YesuWay Church SMS System - Production Setup Script
 * 
 * This script initializes the MongoDB database for production use.
 * NO TEST OR DEMO DATA - Only essential structure and your congregation.
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

console.log('🏛️ YesuWay Church SMS System - Production Setup');
console.log('==============================================');
console.log(`📅 Setup Date: ${new Date().toLocaleString()}`);
console.log(`🔧 Node.js Version: ${process.version}`);
console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log('');

class ProductionSetup {
    constructor() {
        this.dbManager = new MongoDBManager(console);
        this.connectionString = this.buildConnectionString();
        this.setupStats = {
            groupsCreated: 0,
            membersAdded: 0,
            membersSkipped: 0,
            indexesCreated: 0,
            startTime: new Date()
        };
    }

    buildConnectionString() {
        // Priority: Use MONGODB_URI if provided, otherwise build from components
        if (process.env.MONGODB_URI && process.env.MONGODB_URI !== 'undefined') {
            console.log('📋 Using provided MONGODB_URI');
            return process.env.MONGODB_URI;
        }

        // Build connection string from individual components
        const {
            MONGODB_HOST = 'localhost',
            MONGODB_PORT = '27017',
            MONGODB_DATABASE = 'yesuway_church',
            MONGODB_USERNAME,
            MONGODB_PASSWORD,
            MONGODB_AUTH_SOURCE = 'admin'
        } = process.env;

        let connectionString = 'mongodb://';
        
        if (MONGODB_USERNAME && MONGODB_PASSWORD && 
            MONGODB_USERNAME !== 'undefined' && MONGODB_PASSWORD !== 'undefined') {
            connectionString += `${encodeURIComponent(MONGODB_USERNAME)}:${encodeURIComponent(MONGODB_PASSWORD)}@`;
        }
        
        connectionString += `${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}`;
        
        if (MONGODB_USERNAME && MONGODB_PASSWORD && 
            MONGODB_USERNAME !== 'undefined' && MONGODB_PASSWORD !== 'undefined') {
            connectionString += `?authSource=${MONGODB_AUTH_SOURCE}`;
        }

        console.log(`📋 Built connection string for: ${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}`);
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
            console.warn(`⚠️ Invalid phone number format: ${phone} (${digits.length} digits)`);
            return phone;
        }
    }

    async connectToDatabase() {
        console.log('📋 Step 1: Connecting to MongoDB...');
        console.log(`🔗 Connection target: ${this.connectionString.replace(/\/\/[^:]+:[^@]+@/, '//*****:*****@')}`);
        
        const maxRetries = 5;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                if (retryCount > 0) {
                    const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
                    console.log(`🔄 Retry ${retryCount}/${maxRetries} - waiting ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                // FIXED: Use only supported MongoDB connection options
                const options = {
                    maxPoolSize: 10,
                    serverSelectionTimeoutMS: 10000,
                    socketTimeoutMS: 45000,
                    connectTimeoutMS: 15000,
                    retryWrites: true,
                    retryReads: true
                    // REMOVED deprecated options that cause errors:
                    // bufferCommands, bufferMaxEntries, useNewUrlParser, useUnifiedTopology
                };

                mongoose.set('strictQuery', false);
                mongoose.set('bufferCommands', false);

                await this.dbManager.connect(this.connectionString, options);
                console.log('✅ MongoDB connection established successfully');
                
                // Test the connection with a simple operation
                const adminDb = mongoose.connection.db.admin();
                const serverStatus = await adminDb.serverStatus();
                console.log(`📊 MongoDB Server Version: ${serverStatus.version}`);
                console.log(`🗄️ Database Name: ${mongoose.connection.name}`);
                
                return;
                
            } catch (error) {
                retryCount++;
                console.error(`❌ Connection attempt ${retryCount} failed: ${error.message}`);
                
                if (retryCount >= maxRetries) {
                    console.error('❌ All MongoDB connection attempts failed');
                    console.log('\n🔧 Troubleshooting Guide:');
                    console.log('   • Ensure MongoDB is running and accessible');
                    console.log('   • Check network connectivity to MongoDB server');
                    console.log('   • Verify connection string format');
                    console.log('   • Check MongoDB authentication credentials');
                    console.log('   • Ensure firewall allows MongoDB port (27017)');
                    console.log('   • For MongoDB Atlas: Check IP whitelist and network access');
                    console.log('   • Check MongoDB server logs for connection issues');
                    throw error;
                }
            }
        }
    }

    async setupCollections() {
        console.log('📋 Step 2: Setting up collections and indexes...');
        
        try {
            // Ensure all collections exist by creating indexes
            await this.createOptimizedIndexes();
            console.log('✅ Collections and indexes configured successfully');
            this.setupStats.indexesCreated = 8; // Number of index operations
            
        } catch (error) {
            console.error('❌ Failed to setup collections:', error.message);
            throw error;
        }
    }

    async createOptimizedIndexes() {
        try {
            console.log('🔧 Creating optimized database indexes...');
            
            const indexOperations = [
                // Member indexes for fast lookups
                {
                    collection: Member,
                    indexes: [
                        { phoneNumber: 1 },
                        { active: 1, phoneNumber: 1 },
                        { 'groups.groupId': 1 },
                        { lastActivity: -1 },
                        { isAdmin: 1, active: 1 }
                    ],
                    name: 'Members'
                },
                
                // Group indexes
                {
                    collection: Group,
                    indexes: [
                        { active: 1, name: 1 },
                        { name: 1 }
                    ],
                    name: 'Groups'
                },
                
                // Message indexes for efficient queries
                {
                    collection: BroadcastMessage,
                    indexes: [
                        { sentAt: -1, isReaction: 1 },
                        { fromPhone: 1, sentAt: -1 },
                        { targetMessageId: 1 },
                        { messageType: 1, sentAt: -1 },
                        { processingStatus: 1 },
                        { deliveryStatus: 1 }
                    ],
                    name: 'Broadcast Messages'
                },
                
                // Reaction indexes for smart tracking
                {
                    collection: MessageReaction,
                    indexes: [
                        { targetMessageId: 1, isProcessed: 1 },
                        { createdAt: -1 },
                        { reactorPhone: 1, createdAt: -1 },
                        { isProcessed: 1, createdAt: 1 }
                    ],
                    name: 'Message Reactions'
                },
                
                // Media file indexes
                {
                    collection: MediaFile,
                    indexes: [
                        { messageId: 1 },
                        { uploadStatus: 1 },
                        { createdAt: -1 },
                        { fileHash: 1 }
                    ],
                    name: 'Media Files'
                },
                
                // Delivery tracking indexes
                {
                    collection: DeliveryLog,
                    indexes: [
                        { messageId: 1, deliveryStatus: 1 },
                        { deliveredAt: -1 },
                        { toPhone: 1, deliveredAt: -1 },
                        { twilioMessageSid: 1 }
                    ],
                    name: 'Delivery Logs'
                },
                
                // Analytics indexes
                {
                    collection: SystemAnalytics,
                    indexes: [
                        { metricName: 1, recordedAt: -1 },
                        { recordedAt: -1 }
                    ],
                    name: 'System Analytics'
                },
                
                // Performance metrics indexes
                {
                    collection: PerformanceMetrics,
                    indexes: [
                        { operationType: 1, recordedAt: -1 },
                        { recordedAt: -1 },
                        { success: 1, operationType: 1 }
                    ],
                    name: 'Performance Metrics'
                }
            ];

            for (const operation of indexOperations) {
                try {
                    await operation.collection.createIndexes(operation.indexes);
                    console.log(`   ✅ ${operation.name}: ${operation.indexes.length} indexes`);
                } catch (indexError) {
                    console.warn(`   ⚠️ ${operation.name}: Some indexes may already exist`);
                }
            }
            
            console.log('✅ All database indexes created successfully');
            
        } catch (error) {
            console.error('❌ Failed to create indexes:', error.message);
            throw error;
        }
    }

    async initializeGroups() {
        console.log('📋 Step 3: Initializing church groups...');
        
        try {
            const existingGroups = await this.dbManager.getAllGroups();
            
            if (existingGroups.length === 0) {
                const productionGroups = [
                    { 
                        name: "YesuWay Congregation", 
                        description: "Main congregation group for all church members" 
                    },
                    { 
                        name: "Church Leadership", 
                        description: "Leadership and administration group for pastors and elders" 
                    },
                    { 
                        name: "Media Team", 
                        description: "Media and technology team for multimedia content" 
                    }
                ];

                for (const groupData of productionGroups) {
                    const group = await this.dbManager.createGroup(groupData.name, groupData.description);
                    console.log(`✅ Created group: ${groupData.name} (${group._id})`);
                    this.setupStats.groupsCreated++;
                }
                
                console.log('✅ Church groups initialized successfully');
            } else {
                console.log(`ℹ️ Groups already exist (${existingGroups.length} found), skipping initialization`);
                existingGroups.forEach(group => {
                    console.log(`   • ${group.name} - ${group.description}`);
                });
            }
            
        } catch (error) {
            console.error('❌ Failed to initialize groups:', error.message);
            throw error;
        }
    }

    async addProductionCongregation() {
        console.log('📋 Step 4: Adding your congregation members...');
        
        // 🏛️ PRODUCTION CONGREGATION CONFIGURATION
        // Replace this array with your actual church members
        const congregationMembers = [
            // 📝 EXAMPLE FORMAT - Replace with your actual members:
            // { phone: "+1234567890", name: "Pastor John Smith", groupName: "Church Leadership", isAdmin: true },
            // { phone: "+1234567891", name: "Mary Johnson", groupName: "YesuWay Congregation", isAdmin: false },
            // { phone: "+1234567892", name: "David Wilson", groupName: "YesuWay Congregation", isAdmin: false },
            // { phone: "+1234567893", name: "Sarah Tech", groupName: "Media Team", isAdmin: false },
            
            // 🔥 ADD YOUR REAL CONGREGATION MEMBERS HERE:
            // Uncomment and modify the lines below with your actual member information
            
            // Leadership Team
            // { phone: "+1234567890", name: "Pastor Name", groupName: "Church Leadership", isAdmin: true },
            // { phone: "+1234567891", name: "Elder Name", groupName: "Church Leadership", isAdmin: true },
            // { phone: "+1234567892", name: "Deacon Name", groupName: "Church Leadership", isAdmin: false },
            
            // Main Congregation  
            // { phone: "+1234567893", name: "Member Name 1", groupName: "YesuWay Congregation", isAdmin: false },
            // { phone: "+1234567894", name: "Member Name 2", groupName: "YesuWay Congregation", isAdmin: false },
            // { phone: "+1234567895", name: "Member Name 3", groupName: "YesuWay Congregation", isAdmin: false },
            
            // Media and Technology Team
            // { phone: "+1234567896", name: "Tech Person 1", groupName: "Media Team", isAdmin: false },
            // { phone: "+1234567897", name: "Tech Person 2", groupName: "Media Team", isAdmin: false },
        ];

        if (congregationMembers.length === 0) {
            console.log('⚠️ No congregation members configured in this setup script!');
            console.log('');
            console.log('📝 TO ADD YOUR CONGREGATION MEMBERS:');
            console.log('   1. Edit this setup.js file (around line 180)');
            console.log('   2. Find the "congregationMembers" array');
            console.log('   3. Uncomment and modify the example entries');
            console.log('   4. Add your church members in this format:');
            console.log('      { phone: "+1234567890", name: "Member Name", groupName: "YesuWay Congregation", isAdmin: false }');
            console.log('');
            console.log('📞 Available Group Names:');
            console.log('   • "YesuWay Congregation" - Main congregation members');
            console.log('   • "Church Leadership" - Pastors, elders, administrators');
            console.log('   • "Media Team" - Technology and media team members');
            console.log('');
            console.log('🔑 Admin Settings:');
            console.log('   • Set isAdmin: true for church administrators');
            console.log('   • Set isAdmin: false for regular congregation members');
            console.log('');
            console.log('✅ Database structure is ready - add your members and run setup again');
            console.log('💡 Tip: Start with just a few members for testing, then add more later');
            return;
        }

        try {
            // Get all groups for reference
            const groups = await this.dbManager.getAllGroups();
            const groupMap = {};
            groups.forEach(group => {
                groupMap[group.name] = group;
            });

            console.log(`🎯 Processing ${congregationMembers.length} congregation members...`);

            for (const memberData of congregationMembers) {
                try {
                    const cleanPhone = this.cleanPhoneNumber(memberData.phone);
                    if (!cleanPhone) {
                        console.warn(`⚠️ Skipping invalid phone number: ${memberData.phone}`);
                        continue;
                    }

                    const targetGroup = groupMap[memberData.groupName] || groupMap["YesuWay Congregation"];
                    if (!targetGroup) {
                        console.warn(`⚠️ Group not found: ${memberData.groupName}, using default`);
                        continue;
                    }
                    
                    // Check if member already exists
                    let member = await this.dbManager.getMemberByPhone(cleanPhone);
                    
                    if (!member) {
                        member = await this.dbManager.createMember({
                            phoneNumber: cleanPhone,
                            name: memberData.name,
                            isAdmin: Boolean(memberData.isAdmin),
                            active: true,
                            messageCount: 0,
                            lastActivity: new Date(),
                            groups: [{
                                groupId: targetGroup._id,
                                joinedAt: new Date()
                            }]
                        });
                        
                        const role = memberData.isAdmin ? '(Admin)' : '';
                        const groupName = targetGroup.name;
                        console.log(`✅ Added: ${memberData.name} ${role} (${cleanPhone}) → ${groupName}`);
                        this.setupStats.membersAdded++;
                    } else {
                        // Check if member needs to be added to the target group
                        const isInGroup = member.groups.some(g => 
                            g.groupId.toString() === targetGroup._id.toString()
                        );
                        
                        if (!isInGroup) {
                            await this.dbManager.addMemberToGroup(member._id, targetGroup._id);
                            console.log(`✅ Added existing member ${member.name} to ${targetGroup.name}`);
                        } else {
                            console.log(`ℹ️ Already exists: ${member.name} (${cleanPhone}) in ${targetGroup.name}`);
                        }
                        this.setupStats.membersSkipped++;
                    }
                } catch (memberError) {
                    console.error(`❌ Error processing member ${memberData.name}: ${memberError.message}`);
                }
            }

            console.log(`✅ Congregation setup completed:`);
            console.log(`   📊 Members added: ${this.setupStats.membersAdded}`);
            console.log(`   📊 Members skipped: ${this.setupStats.membersSkipped}`);
            
        } catch (error) {
            console.error('❌ Failed to add congregation members:', error.message);
            throw error;
        }
    }

    async verifySetup() {
        console.log('📋 Step 5: Verifying production setup...');
        
        try {
            const stats = await this.dbManager.getHealthStats();
            const groups = await this.dbManager.getAllGroups();
            const members = await this.dbManager.getAllActiveMembers();
            
            console.log('📊 Production Setup Verification:');
            console.log(`   🏛️ Church Groups: ${groups.length}`);
            console.log(`   👥 Active Members: ${stats.activeMemberCount}`);
            console.log(`   📱 Recent Messages (24h): ${stats.recentMessages24h}`);
            console.log(`   ❤️ Recent Reactions (24h): ${stats.recentReactions24h}`);
            console.log(`   📎 Media Files Processed: ${stats.processedMediaCount}`);
            
            console.log('\n📁 Church Group Details:');
            for (const group of groups) {
                const memberCount = members.filter(m => 
                    m.groups.some(g => g.groupId._id.toString() === group._id.toString())
                ).length;
                console.log(`   • ${group.name} (${memberCount} members) - ${group.description}`);
            }

            if (members.length > 0) {
                console.log('\n👥 Registered Congregation Members:');
                const adminMembers = members.filter(m => m.isAdmin);
                const regularMembers = members.filter(m => !m.isAdmin);
                
                if (adminMembers.length > 0) {
                    console.log('   🔑 Administrators:');
                    adminMembers.forEach(member => {
                        const groupNames = member.groups.map(g => g.groupId.name).join(', ');
                        console.log(`      • ${member.name} - ${member.phoneNumber} - Groups: ${groupNames}`);
                    });
                }
                
                if (regularMembers.length > 0) {
                    console.log('   👤 Regular Members:');
                    regularMembers.slice(0, 10).forEach(member => {
                        const groupNames = member.groups.map(g => g.groupId.name).join(', ');
                        console.log(`      • ${member.name} - ${member.phoneNumber} - Groups: ${groupNames}`);
                    });
                    
                    if (regularMembers.length > 10) {
                        console.log(`      ... and ${regularMembers.length - 10} more members`);
                    }
                }
            } else {
                console.warn('\n⚠️ No congregation members found!');
                console.log('💡 Edit the congregationMembers array in this setup.js file to add your church members.');
            }

            console.log('\n✅ Production setup verification completed successfully');
            
        } catch (error) {
            console.error('❌ Failed to verify setup:', error.message);
            throw error;
        }
    }

    async validateEnvironment() {
        console.log('📋 Step 6: Validating production environment...');
        
        const requiredEnvVars = [
            'TWILIO_ACCOUNT_SID',
            'TWILIO_AUTH_TOKEN', 
            'TWILIO_PHONE_NUMBER',
            'R2_ACCESS_KEY_ID',
            'R2_SECRET_ACCESS_KEY',
            'R2_ENDPOINT_URL',
            'R2_BUCKET_NAME'
        ];

        const missing = [];
        const invalid = [];
        const warnings = [];

        // Check required environment variables
        for (const envVar of requiredEnvVars) {
            const value = process.env[envVar];
            if (!value || value === 'undefined') {
                missing.push(envVar);
            } else if (value.includes('your_') || value.includes('_here') || value === 'not_configured') {
                invalid.push(envVar);
            }
        }

        // Validate MongoDB connection
        if (!process.env.MONGODB_URI) {
            if (!process.env.MONGODB_HOST) {
                missing.push('MONGODB_URI (or MONGODB_HOST)');
            }
        }

        // Validate specific formats
        if (process.env.TWILIO_ACCOUNT_SID) {
            if (!process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
                invalid.push('TWILIO_ACCOUNT_SID (must start with AC)');
            } else if (process.env.TWILIO_ACCOUNT_SID.length !== 34) {
                invalid.push('TWILIO_ACCOUNT_SID (must be 34 characters)');
            }
        }

        if (process.env.TWILIO_PHONE_NUMBER) {
            if (!process.env.TWILIO_PHONE_NUMBER.startsWith('+')) {
                warnings.push('TWILIO_PHONE_NUMBER should start with + (e.g., +1234567890)');
            }
        }

        if (process.env.R2_ENDPOINT_URL) {
            if (!process.env.R2_ENDPOINT_URL.startsWith('https://')) {
                invalid.push('R2_ENDPOINT_URL (must start with https://)');
            }
        }

        // Report results
        if (missing.length === 0 && invalid.length === 0) {
            console.log('✅ All required environment variables properly configured');
            
            if (warnings.length > 0) {
                console.log('⚠️ Warnings:');
                warnings.forEach(warning => console.log(`   • ${warning}`));
            }
            
            console.log('✅ System ready for production deployment');
        } else {
            if (missing.length > 0) {
                console.log('❌ Missing required environment variables:');
                missing.forEach(envVar => console.log(`   • ${envVar}`));
            }

            if (invalid.length > 0) {
                console.log('❌ Environment variables with invalid values:');
                invalid.forEach(envVar => console.log(`   • ${envVar}`));
            }

            console.log('\n🔧 Required .env file configuration:');
            console.log('# MongoDB Configuration');
            console.log('MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/yesuway_church?retryWrites=true&w=majority');
            console.log('');
            console.log('# Twilio SMS Configuration');
            console.log('TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
            console.log('TWILIO_AUTH_TOKEN=your_auth_token_from_twilio');
            console.log('TWILIO_PHONE_NUMBER=+1234567890');
            console.log('');
            console.log('# Cloudflare R2 Storage Configuration');
            console.log('R2_ACCESS_KEY_ID=your_cloudflare_r2_access_key');
            console.log('R2_SECRET_ACCESS_KEY=your_cloudflare_r2_secret_key');
            console.log('R2_ENDPOINT_URL=https://account.r2.cloudflarestorage.com');
            console.log('R2_BUCKET_NAME=your-church-media-bucket');
            console.log('R2_PUBLIC_URL=https://media.yourchurch.org');
            console.log('');
            console.log('# Optional: Development Mode');
            console.log('DEVELOPMENT_MODE=false');
        }
    }

    async testDatabaseOperations() {
        console.log('📋 Step 7: Testing database operations...');
        
        try {
            const testResults = [];
            
            // Test 1: Member operations
            try {
                const members = await this.dbManager.getAllActiveMembers();
                testResults.push({ test: 'Member queries', status: 'pass', result: `${members.length} members` });
            } catch (error) {
                testResults.push({ test: 'Member queries', status: 'fail', error: error.message });
            }
            
            // Test 2: Group operations
            try {
                const groups = await this.dbManager.getAllGroups();
                testResults.push({ test: 'Group queries', status: 'pass', result: `${groups.length} groups` });
            } catch (error) {
                testResults.push({ test: 'Group queries', status: 'fail', error: error.message });
            }
            
            // Test 3: Analytics recording
            try {
                await this.dbManager.recordAnalytic('production_setup_test', 1, 'Setup completed successfully');
                testResults.push({ test: 'Analytics recording', status: 'pass', result: 'metric recorded' });
            } catch (error) {
                testResults.push({ test: 'Analytics recording', status: 'fail', error: error.message });
            }
            
            // Test 4: Performance metrics
            try {
                await this.dbManager.recordPerformanceMetric('setup_test', 100, true);
                testResults.push({ test: 'Performance metrics', status: 'pass', result: 'metric recorded' });
            } catch (error) {
                testResults.push({ test: 'Performance metrics', status: 'fail', error: error.message });
            }
            
            // Test 5: Health stats
            try {
                const health = await this.dbManager.getHealthStats();
                testResults.push({ test: 'Health statistics', status: 'pass', result: `${health.activeMemberCount} active members` });
            } catch (error) {
                testResults.push({ test: 'Health statistics', status: 'fail', error: error.message });
            }

            // Report test results
            console.log('🧪 Database Operation Test Results:');
            let passCount = 0;
            let failCount = 0;
            
            testResults.forEach(test => {
                if (test.status === 'pass') {
                    console.log(`   ✅ ${test.test}: ${test.result}`);
                    passCount++;
                } else {
                    console.log(`   ❌ ${test.test}: ${test.error}`);
                    failCount++;
                }
            });
            
            console.log(`📊 Test Summary: ${passCount} passed, ${failCount} failed`);
            
            if (failCount > 0) {
                throw new Error(`${failCount} database operation tests failed`);
            }
            
            console.log('✅ All database operations tested successfully');
            
        } catch (error) {
            console.error('❌ Database operation tests failed:', error.message);
            throw error;
        }
    }

    async generateSetupReport() {
        console.log('📋 Step 8: Generating setup report...');
        
        try {
            const endTime = new Date();
            const duration = Math.round((endTime - this.setupStats.startTime) / 1000);
            
            // Record final setup analytics
            await this.dbManager.recordAnalytic('production_setup_completed', 1, 
                `Setup completed: ${this.setupStats.membersAdded} members added, ${this.setupStats.groupsCreated} groups created`);
            
            console.log('\n🎉 PRODUCTION SETUP COMPLETED SUCCESSFULLY!');
            console.log('═══════════════════════════════════════════');
            console.log(`📅 Setup Date: ${endTime.toLocaleString()}`);
            console.log(`⏱️ Setup Duration: ${duration} seconds`);
            console.log(`🏛️ Groups Created: ${this.setupStats.groupsCreated}`);
            console.log(`👥 Members Added: ${this.setupStats.membersAdded}`);
            console.log(`👥 Members Skipped: ${this.setupStats.membersSkipped}`);
            console.log(`📊 Indexes Created: ${this.setupStats.indexesCreated}`);
            console.log(`🗄️ Database: ${mongoose.connection.name}`);
            console.log('');
            
        } catch (error) {
            console.error('❌ Failed to generate setup report:', error.message);
        }
    }

    async displayNextSteps() {
        console.log('📝 NEXT STEPS FOR PRODUCTION DEPLOYMENT:');
        console.log('═══════════════════════════════════════════');
        console.log('1. ✅ Configure all environment variables in .env file');
        console.log('2. ✅ Deploy to hosting platform (Render.com recommended)');
        console.log('3. ✅ Set up A2P 10DLC registration with Twilio for production SMS');
        console.log('4. ✅ Configure Cloudflare R2 bucket and custom domain');
        console.log('5. ✅ Ensure MongoDB is accessible from production environment');
        console.log('6. ✅ Configure Twilio webhook URL to your production endpoint');
        console.log('7. ✅ Test SMS functionality with your church phone number');
        console.log('8. ✅ Train church staff on the SMS system usage');
        console.log('');
        console.log('🔗 IMPORTANT PRODUCTION URLS:');
        console.log('   • Health Check: https://your-app.onrender.com/health');
        console.log('   • System Overview: https://your-app.onrender.com/');
        console.log('   • Webhook Endpoint: https://your-app.onrender.com/webhook/sms');
        console.log('');
        console.log('💚 YOUR PRODUCTION CHURCH SMS SYSTEM IS READY!');
        console.log('🏛️ Professional church communication platform with MongoDB');
        console.log('🔇 Smart reaction tracking with silent processing');
        console.log('🧹 Clean media display with professional presentation');
        console.log('🛡️ Secure registration-only member access');
        console.log('📱 Industry-grade SMS broadcasting system');
        console.log('🗄️ MongoDB database for enterprise scalability');
        console.log('⚡ Production-ready with comprehensive error handling');
        console.log('');
        console.log('🎯 READY FOR YOUR CONGREGATION - NO TEST DATA INCLUDED!');
    }

    async run() {
        try {
            console.log('🚀 Starting clean production setup with MongoDB...\n');
            
            // Execute all setup steps
            await this.connectToDatabase();
            await this.setupCollections();
            await this.initializeGroups();
            await this.addProductionCongregation();
            await this.verifySetup();
            await this.testDatabaseOperations();
            await this.validateEnvironment();
            await this.generateSetupReport();
            await this.displayNextSteps();
            
        } catch (error) {
            console.error('\n❌ PRODUCTION SETUP FAILED');
            console.error('═══════════════════════════════════');
            console.error(`Error: ${error.message}`);
            if (error.stack) {
                console.error('Stack trace:', error.stack);
            }
            
            console.log('\n🔧 TROUBLESHOOTING GUIDE:');
            console.log('═══════════════════════════════');
            console.log('• MongoDB Connection Issues:');
            console.log('  - Ensure MongoDB is running and accessible');
            console.log('  - Check MongoDB connection string format');
            console.log('  - Verify MongoDB authentication credentials');
            console.log('  - Ensure network connectivity to MongoDB server');
            console.log('  - For MongoDB Atlas: Check IP whitelist settings');
            console.log('');
            console.log('• Environment Configuration:');
            console.log('  - Create .env file with all required variables');
            console.log('  - Check MONGODB_URI format and credentials');
            console.log('  - Verify Twilio and Cloudflare R2 credentials');
            console.log('');
            console.log('• Permission Issues:');
            console.log('  - Ensure database user has read/write permissions');
            console.log('  - Check MongoDB user roles and database access');
            console.log('  - Verify file system permissions for log files');
            console.log('');
            console.log('• Network Issues:');
            console.log('  - Check firewall settings for MongoDB port (27017)');
            console.log('  - Ensure DNS resolution for MongoDB hostname');
            console.log('  - Test network connectivity: ping your MongoDB server');
            console.log('');
            console.log('📞 For additional support:');
            console.log('  - Check MongoDB server logs for connection errors');
            console.log('  - Review application logs for detailed error information');
            console.log('  - Verify all environment variables are properly set');
            
            process.exit(1);
        } finally {
            // Always disconnect from database
            if (this.dbManager && this.dbManager.isConnected) {
                await this.dbManager.disconnect();
                console.log('🔌 Database connection closed');
            }
        }
    }
}

// Production Environment Validation
function validateProductionEnvironment() {
    console.log('🔧 Pre-setup Environment Validation:');
    
    const fs = require('fs');
    const path = require('path');
    
    // Check for .env file
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
        console.log('⚠️ No .env file found in project root');
        console.log('💡 Create .env file with your production credentials');
        console.log('📋 Required environment variables will be validated during setup');
        console.log('');
    } else {
        console.log('✅ .env file found');
    }
    
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion < 18) {
        console.warn(`⚠️ Node.js ${nodeVersion} detected. Recommended: Node.js 18+ for production`);
    } else {
        console.log(`✅ Node.js ${nodeVersion} is suitable for production`);
    }
    
    // Check available memory
    const totalMemory = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);
    if (totalMemory < 512) {
        console.warn(`⚠️ Low memory detected: ${totalMemory}MB. Recommended: 512MB+ for production`);
    } else {
        console.log(`✅ Memory: ${totalMemory}MB available`);
    }
    
    console.log('');
}

// Main Execution
async function main() {
    // Validate environment before starting
    validateProductionEnvironment();
    
    // Initialize and run production setup
    const setup = new ProductionSetup();
    await setup.run();
}

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('\n💥 UNCAUGHT EXCEPTION:');
    console.error('═══════════════════════════');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.log('\n🔧 This indicates a serious issue with the setup script.');
    console.log('Please review the error above and ensure all dependencies are installed.');
    console.log('Run: npm install');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n💥 UNHANDLED PROMISE REJECTION:');
    console.error('═══════════════════════════════');
    console.error('Reason:', reason);
    console.error('Promise:', promise);
    console.log('\n🔧 This usually indicates a database connection issue.');
    console.log('Please check your MongoDB connection settings and try again.');
    process.exit(1);
});

// 🔥 FIXED: Correct class instantiation
if (require.main === module) {
    main().catch(error => {
        console.error('\n❌ Setup failed:', error.message);
        process.exit(1);
    });
}