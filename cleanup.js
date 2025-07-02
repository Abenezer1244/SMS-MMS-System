#!/usr/bin/env node

/**
 * YesuWay Church SMS System - Production Database Cleanup Script
 * 
 * This script removes all existing test/demo members and prepares the database
 * for fresh production member addition.
 * 
 * Usage: node cleanup.js
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

console.log('🧹 YesuWay Church SMS System - Production Database Cleanup');
console.log('=========================================================');

class ProductionCleanup {
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

    async connectToDatabase() {
        console.log('📋 Connecting to MongoDB...');
        
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
            console.log('✅ MongoDB connection established');
            
        } catch (error) {
            console.error('❌ Failed to connect to MongoDB:', error.message);
            throw error;
        }
    }

    async backupCurrentData() {
        console.log('📋 Creating backup of current data...');
        
        try {
            const members = await Member.find({}).populate('groups.groupId');
            const groups = await Group.find({});
            const messages = await BroadcastMessage.find({}).limit(100); // Last 100 messages
            
            const backup = {
                timestamp: new Date().toISOString(),
                members: members,
                groups: groups,
                recentMessages: messages
            };

            // Save backup to file
            const fs = require('fs');
            const backupFilename = `backup_${new Date().toISOString().replace(/[:.]/g, '')}.json`;
            
            await fs.promises.writeFile(backupFilename, JSON.stringify(backup, null, 2));
            
            console.log(`✅ Backup saved to: ${backupFilename}`);
            console.log(`📊 Backup contains: ${members.length} members, ${groups.length} groups, ${messages.length} messages`);
            
            return backupFilename;
            
        } catch (error) {
            console.error('❌ Failed to create backup:', error.message);
            throw error;
        }
    }

    async cleanupTestMembers() {
        console.log('📋 Removing test/demo members...');
        
        try {
            // List of test/demo phone numbers to remove
            const testPhoneNumbers = [
                '+12068001141', // Mike/michael
                '+14257729189', // Sam/mike  
                '+12065910943', // Sami
                '+12064349652'  // Yab
            ];

            const testNames = [
                'Mike', 'Sam', 'Sami', 'Yab', 'michael', 'mike'
            ];

            console.log('🔍 Identifying test members...');
            
            // Find members by phone numbers
            const membersByPhone = await Member.find({
                phoneNumber: { $in: testPhoneNumbers }
            });

            // Find members by test names  
            const membersByName = await Member.find({
                name: { $in: testNames }
            });

            // Combine and deduplicate
            const allTestMembers = [...membersByPhone, ...membersByName];
            const uniqueTestMembers = allTestMembers.filter((member, index, self) => 
                index === self.findIndex(m => m._id.toString() === member._id.toString())
            );

            if (uniqueTestMembers.length === 0) {
                console.log('ℹ️ No test members found to remove');
                return;
            }

            console.log(`🎯 Found ${uniqueTestMembers.length} test members to remove:`);
            for (const member of uniqueTestMembers) {
                console.log(`   • ${member.name} (${member.phoneNumber})`);
            }

            // Get admin confirmation
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const confirmed = await new Promise((resolve) => {
                rl.question('\n❓ Are you sure you want to remove these test members? (yes/no): ', (answer) => {
                    rl.close();
                    resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
                });
            });

            if (!confirmed) {
                console.log('❌ Cleanup cancelled by user');
                return;
            }

            // Remove test members
            for (const member of uniqueTestMembers) {
                // Remove related data first
                await MessageReaction.deleteMany({ reactorPhone: member.phoneNumber });
                await BroadcastMessage.deleteMany({ fromPhone: member.phoneNumber });
                await DeliveryLog.deleteMany({ toPhone: member.phoneNumber });
                
                // Remove the member
                await Member.findByIdAndDelete(member._id);
                
                console.log(`✅ Removed: ${member.name} (${member.phoneNumber})`);
            }

            console.log(`✅ Successfully removed ${uniqueTestMembers.length} test members and their data`);
            
        } catch (error) {
            console.error('❌ Failed to cleanup test members:', error.message);
            throw error;
        }
    }

    async cleanupTestData() {
        console.log('📋 Cleaning up test data and metrics...');
        
        try {
            // Remove test analytics
            await SystemAnalytics.deleteMany({
                metricName: { $regex: /test|demo|setup_test/i }
            });

            // Remove test performance metrics
            await PerformanceMetrics.deleteMany({
                operationType: { $regex: /test|demo|setup_test/i }
            });

            // Remove old reaction summaries
            await ReactionSummary.deleteMany({});

            // Remove orphaned media files
            const orphanedMedia = await MediaFile.find({
                messageId: { $exists: false }
            });

            if (orphanedMedia.length > 0) {
                await MediaFile.deleteMany({
                    messageId: { $exists: false }
                });
                console.log(`✅ Removed ${orphanedMedia.length} orphaned media files`);
            }

            console.log('✅ Test data cleanup completed');
            
        } catch (error) {
            console.error('❌ Failed to cleanup test data:', error.message);
            throw error;
        }
    }

    async verifyCleanup() {
        console.log('📋 Verifying cleanup results...');
        
        try {
            const stats = await this.dbManager.getHealthStats();
            const groups = await this.dbManager.getAllGroups();
            const members = await this.dbManager.getAllActiveMembers();
            
            console.log('📊 Post-cleanup verification:');
            console.log(`   Groups: ${groups.length}`);
            console.log(`   Active Members: ${stats.activeMemberCount}`);
            console.log(`   Recent Messages: ${stats.recentMessages24h}`);
            console.log(`   Recent Reactions: ${stats.recentReactions24h}`);
            
            if (members.length > 0) {
                console.log('\n👥 Remaining Members:');
                for (const member of members) {
                    const role = member.isAdmin ? '(Admin)' : '';
                    console.log(`   • ${member.name} ${role} - ${member.phoneNumber}`);
                }
            } else {
                console.log('\n✅ Database cleaned - ready for fresh member addition');
            }

            console.log('\n✅ Cleanup verification completed');
            
        } catch (error) {
            console.error('❌ Failed to verify cleanup:', error.message);
            throw error;
        }
    }

    async run() {
        try {
            console.log('🚀 Starting production database cleanup...\n');
            
            await this.connectToDatabase();
            
            const backupFile = await this.backupCurrentData();
            console.log(`💾 Backup created: ${backupFile}`);
            
            await this.cleanupTestMembers();
            await this.cleanupTestData();
            await this.verifyCleanup();
            
            console.log('\n🎉 Production database cleanup completed successfully!');
            console.log('\n📝 Next steps:');
            console.log('   1. ✅ Database is now clean and ready for production');
            console.log('   2. ✅ Edit setup.js to add your real congregation members');
            console.log('   3. ✅ Run: node setup.js to add your members');
            console.log('   4. ✅ Deploy to production environment');
            console.log('\n💚 Your database is now ready for real congregation members!');
            
        } catch (error) {
            console.error('\n❌ Cleanup failed:', error.message);
            console.error('Stack trace:', error.stack);
            process.exit(1);
        } finally {
            if (this.dbManager.isConnected) {
                await this.dbManager.disconnect();
            }
        }
    }
}

// Run cleanup
const cleanup = new ProductionCleanup();
cleanup.run();