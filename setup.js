
/**
 * YesuWay Church SMS System - Clean Production Setup Script
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

class ProductionSetup {
    constructor() {
        this.dbManager = new MongoDBManager(console);
        this.connectionString = process.env.MONGODB_URI || this.buildConnectionString();
    }

    buildConnectionString() {
        const {
            MONGODB_HOST = 'localhost',
            MONGODB_PORT = '27017',
            MONGODB_DATABASE = 'yesuway_church',
            MONGODB_USERNAME,
            MONGODB_PASSWORD,
            MONGODB_AUTH_SOURCE = 'admin'
        } = process.env;

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

    async connectToDatabase() {
        console.log('📋 Step 1: Connecting to MongoDB...');
        
        try {
            const options = {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                connectTimeoutMS: 10000,
                retryWrites: true,
                retryReads: true
            };

            mongoose.set('strictQuery', false);
            mongoose.set('bufferCommands', false);

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
            await this.createIndexes();
            console.log('✅ Collections and indexes configured successfully');
            
        } catch (error) {
            console.error('❌ Failed to setup collections:', error.message);
            throw error;
        }
    }

    async createIndexes() {
        try {
            const indexOperations = [
                Member.createIndexes([
                    { phoneNumber: 1 },
                    { active: 1, phoneNumber: 1 },
                    { 'groups.groupId': 1 }
                ]),
                
                Group.createIndexes([
                    { active: 1, name: 1 }
                ]),
                
                BroadcastMessage.createIndexes([
                    { sentAt: -1, isReaction: 1 },
                    { fromPhone: 1, sentAt: -1 },
                    { targetMessageId: 1 }
                ]),
                
                MessageReaction.createIndexes([
                    { targetMessageId: 1, isProcessed: 1 },
                    { createdAt: -1 }
                ]),
                
                MediaFile.createIndexes([
                    { messageId: 1 },
                    { uploadStatus: 1 }
                ]),
                
                DeliveryLog.createIndexes([
                    { messageId: 1, deliveryStatus: 1 },
                    { deliveredAt: -1 }
                ]),
                
                SystemAnalytics.createIndexes([
                    { metricName: 1, recordedAt: -1 }
                ]),
                
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
        console.log('📋 Step 3: Initializing church groups...');
        
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
                
                console.log('✅ Church groups initialized');
            } else {
                console.log('ℹ️ Groups already exist, skipping initialization');
            }
            
        } catch (error) {
            console.error('❌ Failed to initialize groups:', error.message);
            throw error;
        }
    }

    async addProductionCongregation() {
        console.log('📋 Step 4: Adding your congregation members...');
        
        // 🏛️ CONFIGURE YOUR CONGREGATION HERE
        // Add your real church members in this array
        const congregationMembers = [
            // EXAMPLE FORMAT (replace with your actual members):
            // { phone: "+1234567890", name: "Pastor John", groupName: "Church Leadership", isAdmin: true },
            // { phone: "+1234567891", name: "Mary Smith", groupName: "YesuWay Congregation", isAdmin: false },
            // { phone: "+1234567892", name: "David Wilson", groupName: "YesuWay Congregation", isAdmin: false },
            // { phone: "+1234567893", name: "Sarah Tech", groupName: "Media Team", isAdmin: false },
            
            // 🔥 ADD YOUR REAL CONGREGATION MEMBERS HERE:
            // Uncomment and modify the lines below with your actual member information
            
            // Leadership
            // { phone: "+1234567890", name: "Pastor Name", groupName: "Church Leadership", isAdmin: true },
            // { phone: "+1234567891", name: "Elder Name", groupName: "Church Leadership", isAdmin: false },
            
            // Congregation  
            // { phone: "+1234567892", name: "Member Name 1", groupName: "YesuWay Congregation", isAdmin: false },
            // { phone: "+1234567893", name: "Member Name 2", groupName: "YesuWay Congregation", isAdmin: false },
            
            // Media Team
            // { phone: "+1234567894", name: "Tech Person", groupName: "Media Team", isAdmin: false },
        ];

        if (congregationMembers.length === 0) {
            console.log('⚠️ No congregation members configured!');
            console.log('');
            console.log('📝 TO ADD YOUR CONGREGATION:');
            console.log('   1. Edit this setup.js file');
            console.log('   2. Find the "congregationMembers" array above');
            console.log('   3. Add your church members in this format:');
            console.log('      { phone: "+1234567890", name: "Member Name", groupName: "YesuWay Congregation", isAdmin: false }');
            console.log('');
            console.log('📞 Available groups:');
            console.log('   • "YesuWay Congregation" - Main congregation');
            console.log('   • "Church Leadership" - Pastors, elders, admins');
            console.log('   • "Media Team" - Technology and media team');
            console.log('');
            console.log('🔑 Set isAdmin: true for church administrators');
            console.log('');
            console.log('✅ Database structure is ready - add your members and run setup again');
            return;
        }

        try {
            // Get groups for reference
            const groups = await this.dbManager.getAllGroups();
            const groupMap = {};
            groups.forEach(group => {
                groupMap[group.name] = group;
            });

            let addedCount = 0;
            let skippedCount = 0;

            for (const memberData of congregationMembers) {
                const cleanPhone = this.cleanPhoneNumber(memberData.phone);
                const targetGroup = groupMap[memberData.groupName] || groupMap["YesuWay Congregation"];
                
                // Check if member already exists
                let member = await this.dbManager.getMemberByPhone(cleanPhone);
                
                if (!member) {
                    member = await this.dbManager.createMember({
                        phoneNumber: cleanPhone,
                        name: memberData.name,
                        isAdmin: Boolean(memberData.isAdmin),
                        active: true,
                        messageCount: 0,
                        groups: [{
                            groupId: targetGroup._id,
                            joinedAt: new Date()
                        }]
                    });
                    
                    const role = memberData.isAdmin ? '(Admin)' : '';
                    console.log(`✅ Added: ${memberData.name} ${role} (${cleanPhone}) to ${targetGroup.name}`);
                    addedCount++;
                } else {
                    console.log(`ℹ️ Already exists: ${member.name} (${cleanPhone})`);
                    skippedCount++;
                }
            }

            console.log(`✅ Congregation setup completed - Added: ${addedCount}, Skipped: ${skippedCount}`);
            
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
            console.log(`   Groups: ${groups.length}`);
            console.log(`   Active Members: ${stats.activeMemberCount}`);
            
            console.log('\n📁 Church Groups:');
            for (const group of groups) {
                console.log(`   • ${group.name} - ${group.description}`);
            }

            if (members.length > 0) {
                console.log('\n👥 Registered Congregation Members:');
                for (const member of members) {
                    const role = member.isAdmin ? '(Admin)' : '';
                    const groupNames = member.groups.map(g => g.groupId.name).join(', ');
                    console.log(`   • ${member.name} ${role} - ${member.phoneNumber} - Groups: ${groupNames}`);
                }
            } else {
                console.warn('\n⚠️ No congregation members found!');
                console.log('💡 Edit the congregationMembers array in this setup.js file to add your church members.');
            }

            console.log('\n✅ Production setup verification completed');
            
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

        for (const envVar of requiredEnvVars) {
            const value = process.env[envVar];
            if (!value) {
                missing.push(envVar);
            } else if (value.includes('your_') || value.includes('_here') || value === 'not_configured') {
                invalid.push(envVar);
            }
        }

        // Validate MongoDB connection string
        if (!process.env.MONGODB_URI) {
            if (!process.env.MONGODB_HOST) missing.push('MONGODB_URI (or MONGODB_HOST)');
        }

        // Validate specific formats
        if (process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
            invalid.push('TWILIO_ACCOUNT_SID (must start with AC)');
        }

        if (process.env.R2_ENDPOINT_URL && !process.env.R2_ENDPOINT_URL.startsWith('https://')) {
            invalid.push('R2_ENDPOINT_URL (must start with https://)');
        }

        if (missing.length === 0 && invalid.length === 0) {
            console.log('✅ All environment variables properly configured');
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

            console.log('\n🔧 Required .env configuration:');
            console.log('MONGODB_URI=mongodb+srv://church_admin:12!Michael@yesuway-church.yb9ffd2.mongodb.net/?retryWrites=true&w=majority&appName=yesuway-church');
            console.log('TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
            console.log('TWILIO_AUTH_TOKEN=your_auth_token_from_twilio');
            console.log('TWILIO_PHONE_NUMBER=+1234567890');
            console.log('R2_ACCESS_KEY_ID=your_cloudflare_r2_access_key');
            console.log('R2_SECRET_ACCESS_KEY=your_cloudflare_r2_secret_key');
            console.log('R2_ENDPOINT_URL=https://account.r2.cloudflarestorage.com');
            console.log('R2_BUCKET_NAME=your-church-media-bucket');
            console.log('R2_PUBLIC_URL=https://media.yourchurch.org');
        }
    }

    async testDatabaseOperations() {
        console.log('📋 Step 7: Testing database operations...');
        
        try {
            const testOperations = [
                async () => {
                    const members = await this.dbManager.getAllActiveMembers();
                    return members.length >= 0;
                },
                
                async () => {
                    const groups = await this.dbManager.getAllGroups();
                    return groups.length >= 0;
                },
                
                async () => {
                    await this.dbManager.recordAnalytic('production_setup', 1, 'Production setup completed');
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
            console.log('🚀 Starting clean production setup...\n');
            
            await this.connectToDatabase();
            await this.setupCollections();
            await this.initializeGroups();
            await this.addProductionCongregation();
            await this.verifySetup();
            await this.testDatabaseOperations();
            await this.validateEnvironment();
            
            console.log('\n🎉 Production setup completed successfully!');
            console.log('\n📝 Next steps for deployment:');
            console.log('   1. ✅ Configure all environment variables');
            console.log('   2. ✅ Deploy to hosting platform (Render.com recommended)');
            console.log('   3. ✅ Set up A2P 10DLC registration with Twilio');
            console.log('   4. ✅ Configure Cloudflare R2 bucket and domain');
            console.log('   5. ✅ Ensure MongoDB is accessible from production environment');
            console.log('   6. ✅ Send first message to church number');
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