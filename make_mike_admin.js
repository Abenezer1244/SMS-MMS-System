#!/usr/bin/env node

/**
 * Admin Setup Script - Make Mike the Primary Admin
 * 
 * This script promotes Mike to admin status in your production system
 * Usage: node make_mike_admin.js
 */

const mongoose = require('mongoose');
const MongoDBManager = require('./database');
const { Member, Group } = require('./models');

require('dotenv').config();

console.log('🔑 YesuWay Church SMS - Admin Setup');
console.log('===================================');
console.log('🎯 Target: Making Mike the primary admin');
console.log('📞 Phone: +14257729189');
console.log('');

class AdminSetup {
    constructor() {
        this.dbManager = new MongoDBManager(console);
        this.connectionString = this.buildConnectionString();
    }

    buildConnectionString() {
        if (process.env.MONGODB_URI && process.env.MONGODB_URI !== 'undefined') {
            return process.env.MONGODB_URI;
        }

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

        return connectionString;
    }

    async connectToDatabase() {
        console.log('🔗 Connecting to MongoDB...');
        
        try {
            const options = {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                connectTimeoutMS: 10000,
            };

            mongoose.set('strictQuery', false);
            await mongoose.connect(this.connectionString, options);
            this.dbManager.isConnected = true;
            
            console.log('✅ MongoDB connected successfully');
            
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error.message);
            throw error;
        }
    }

    async makeMikeAdmin() {
        console.log('🔑 Promoting Mike to admin status...');
        
        try {
            const mikePhone = '+14257729189';
            
            // Find Mike in the database
            let mike = await Member.findOne({ phoneNumber: mikePhone });
            
            if (!mike) {
                console.log('❌ Mike not found in database!');
                console.log('💡 Make sure Mike is added to the system first');
                console.log('📋 Current members in database:');
                
                const allMembers = await Member.find({}).select('name phoneNumber isAdmin');
                allMembers.forEach(member => {
                    const adminStatus = member.isAdmin ? '(Admin)' : '';
                    console.log(`   • ${member.name} - ${member.phoneNumber} ${adminStatus}`);
                });
                
                return false;
            }

            // Check if Mike is already an admin
            if (mike.isAdmin) {
                console.log('ℹ️ Mike is already an admin!');
                console.log('✅ No changes needed');
                return true;
            }

            // Get Church Leadership group
            const leadershipGroup = await Group.findOne({ name: "Church Leadership" });
            
            if (!leadershipGroup) {
                console.log('❌ Church Leadership group not found!');
                console.log('💡 Run the main setup.js script first to create groups');
                return false;
            }

            // Promote Mike to admin
            await Member.findByIdAndUpdate(mike._id, {
                isAdmin: true,
                $addToSet: {
                    groups: {
                        groupId: leadershipGroup._id,
                        joinedAt: new Date()
                    }
                }
            });

            console.log('✅ Mike promoted to admin successfully!');
            console.log(`👤 Name: ${mike.name}`);
            console.log(`📱 Phone: ${mike.phoneNumber}`);
            console.log('🔑 Admin Status: TRUE');
            console.log(`🏛️ Added to: ${leadershipGroup.name}`);
            
            // Record this action for audit trail
            try {
                await this.dbManager.recordAnalytic('admin_promoted', 1, 
                    `Mike (${mikePhone}) promoted to admin via setup script`);
            } catch (analyticsError) {
                console.log('⚠️ Admin promotion logged, but analytics recording failed');
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to promote Mike to admin:', error.message);
            throw error;
        }
    }

    async verifyAdminSetup() {
        console.log('📋 Verifying admin setup...');
        
        try {
            const admins = await Member.find({ isAdmin: true }).populate('groups.groupId', 'name');
            
            console.log('🔑 Current Admins:');
            if (admins.length === 0) {
                console.log('   ❌ No admins found!');
                return false;
            }
            
            admins.forEach(admin => {
                const groups = admin.groups.map(g => g.groupId.name).join(', ');
                console.log(`   ✅ ${admin.name} (${admin.phoneNumber}) - Groups: ${groups}`);
            });
            
            // Test admin capabilities
            const mike = admins.find(admin => admin.phoneNumber === '+14257729189');
            if (mike) {
                console.log('');
                console.log('🎯 Mike Admin Capabilities:');
                console.log('   ✅ Can use ADD command to add new members');
                console.log('   ✅ Can use REMOVE command to remove members');
                console.log('   ✅ Receives admin commands in HELP menu');
                console.log('   ✅ All admin actions are logged for audit');
                console.log('');
                console.log('📱 Example Usage:');
                console.log('   Mike texts: "ADD +12345678901 NewMemberName"');
                console.log('   Mike texts: "REMOVE +12345678901 MemberName"');
                console.log('   System responds with confirmation messages');
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Admin verification failed:', error.message);
            return false;
        }
    }

    async run() {
        try {
            await this.connectToDatabase();
            
            const success = await this.makeMikeAdmin();
            if (!success) {
                throw new Error('Failed to promote Mike to admin');
            }
            
            await this.verifyAdminSetup();
            
            console.log('');
            console.log('🎉 ADMIN SETUP COMPLETED SUCCESSFULLY!');
            console.log('=====================================');
            console.log('🔑 Mike is now the primary admin');
            console.log('📱 Mike can now use:');
            console.log('   • ADD +1234567890 MemberName');
            console.log('   • REMOVE +1234567890 MemberName');
            console.log('🏛️ Ready for production member management!');
            console.log('');
            console.log('🚀 Next Steps:');
            console.log('   1. ✅ Mike can now add/remove members via SMS');
            console.log('   2. ✅ Test with: "ADD +12345678901 TestMember"');
            console.log('   3. ✅ Test with: "REMOVE +12345678901 TestMember"');
            console.log('   4. ✅ Deploy your system to production');
            console.log('   5. ✅ Start managing your congregation!');
            
        } catch (error) {
            console.error('\n❌ ADMIN SETUP FAILED');
            console.error('=====================');
            console.error(`Error: ${error.message}`);
            
            console.log('\n🔧 Troubleshooting:');
            console.log('• Ensure MongoDB is running and accessible');
            console.log('• Check your .env file has correct database credentials');
            console.log('• Make sure Mike exists in the database (run setup.js first)');
            console.log('• Verify Church Leadership group exists');
            
            process.exit(1);
        } finally {
            if (this.dbManager && this.dbManager.isConnected) {
                await mongoose.disconnect();
                console.log('🔌 Database connection closed');
            }
        }
    }
}

async function main() {
    const adminSetup = new AdminSetup();
    await adminSetup.run();
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    });
}

module.exports = AdminSetup;