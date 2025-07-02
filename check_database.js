#!/usr/bin/env node

/**
 * Database State Checker - Check current members and duplicates
 * Usage: node check_database.js
 */

const mongoose = require('mongoose');
const MongoDBManager = require('./database');
const { Member } = require('./models');

require('dotenv').config();

class DatabaseChecker {
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

    async connect() {
        try {
            mongoose.set('strictQuery', false);
            await mongoose.connect(this.connectionString);
            this.dbManager.isConnected = true;
            console.log('✅ Connected to MongoDB');
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error.message);
            throw error;
        }
    }

    async checkMembers() {
        console.log('\n📋 CURRENT DATABASE STATE:');
        console.log('==========================');

        try {
            // Get all members (including inactive)
            const allMembers = await Member.find({}).populate('groups.groupId', 'name');
            
            console.log(`📊 Total members in database: ${allMembers.length}`);
            
            if (allMembers.length === 0) {
                console.log('🔍 No members found in database');
                return;
            }

            // Check for duplicates
            const phoneNumbers = allMembers.map(m => m.phoneNumber);
            const duplicatePhones = phoneNumbers.filter((phone, index) => phoneNumbers.indexOf(phone) !== index);
            
            if (duplicatePhones.length > 0) {
                console.log('\n⚠️ DUPLICATE PHONE NUMBERS FOUND:');
                console.log('================================');
                for (const phone of [...new Set(duplicatePhones)]) {
                    const duplicateMembers = allMembers.filter(m => m.phoneNumber === phone);
                    console.log(`📱 ${phone} appears ${duplicateMembers.length} times:`);
                    duplicateMembers.forEach((member, index) => {
                        const status = member.active ? 'Active' : 'Inactive';
                        const groups = member.groups.map(g => g.groupId.name).join(', ');
                        console.log(`   ${index + 1}. ${member.name} (${status}) - Groups: ${groups} - ID: ${member._id}`);
                    });
                }
            } else {
                console.log('\n✅ No duplicate phone numbers found');
            }

            // Show active members
            const activeMembers = allMembers.filter(m => m.active);
            console.log(`\n👥 ACTIVE MEMBERS (${activeMembers.length}):`);
            console.log('========================');
            
            activeMembers.forEach(member => {
                const role = member.isAdmin ? '(Admin)' : '';
                const groups = member.groups.map(g => g.groupId.name).join(', ');
                console.log(`• ${member.name} ${role} - ${member.phoneNumber} - Groups: ${groups}`);
            });

            // Show inactive members if any
            const inactiveMembers = allMembers.filter(m => !m.active);
            if (inactiveMembers.length > 0) {
                console.log(`\n👥 INACTIVE MEMBERS (${inactiveMembers.length}):`);
                console.log('==========================');
                
                inactiveMembers.forEach(member => {
                    const role = member.isAdmin ? '(Admin)' : '';
                    const groups = member.groups.map(g => g.groupId.name).join(', ');
                    console.log(`• ${member.name} ${role} - ${member.phoneNumber} - Groups: ${groups}`);
                });
            }

            // Check indexes
            console.log('\n📊 DATABASE INDEXES:');
            console.log('====================');
            
            const indexes = await Member.collection.getIndexes();
            Object.keys(indexes).forEach(indexName => {
                const indexInfo = indexes[indexName];
                console.log(`• ${indexName}: ${JSON.stringify(indexInfo)}`);
            });

        } catch (error) {
            console.error('❌ Error checking members:', error.message);
            throw error;
        }
    }

    async cleanupDuplicates() {
        console.log('\n🧹 CHECKING FOR CLEANUP OPTIONS:');
        console.log('=================================');

        try {
            // Find duplicates
            const pipeline = [
                {
                    $group: {
                        _id: "$phoneNumber",
                        count: { $sum: 1 },
                        docs: { $push: "$$ROOT" }
                    }
                },
                {
                    $match: {
                        count: { $gt: 1 }
                    }
                }
            ];

            const duplicates = await Member.aggregate(pipeline);
            
            if (duplicates.length === 0) {
                console.log('✅ No duplicates to clean up');
                return;
            }

            console.log(`⚠️ Found ${duplicates.length} phone numbers with duplicates:`);
            
            for (const duplicate of duplicates) {
                console.log(`\n📱 ${duplicate._id} (${duplicate.count} copies):`);
                
                duplicate.docs.forEach((doc, index) => {
                    const status = doc.active ? 'Active' : 'Inactive';
                    console.log(`   ${index + 1}. ${doc.name} (${status}) - Created: ${doc.createdAt} - ID: ${doc._id}`);
                });
                
                // Suggest which one to keep (keep the oldest active one, or just the oldest)
                const activeDocs = duplicate.docs.filter(doc => doc.active);
                const keepDoc = activeDocs.length > 0 
                    ? activeDocs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0]
                    : duplicate.docs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
                
                console.log(`   💡 Suggested to keep: ${keepDoc.name} (ID: ${keepDoc._id})`);
            }

            console.log('\n⚠️ Manual cleanup required!');
            console.log('You can remove duplicates by running these MongoDB commands:');
            console.log('db.members.deleteOne({"_id": ObjectId("ID_TO_DELETE")})');
            
        } catch (error) {
            console.error('❌ Error checking for duplicates:', error.message);
        }
    }

    async run() {
        try {
            await this.connect();
            await this.checkMembers();
            await this.cleanupDuplicates();
            
            console.log('\n✅ Database check completed');
            
        } catch (error) {
            console.error('\n❌ Database check failed:', error.message);
            process.exit(1);
        } finally {
            if (this.dbManager.isConnected) {
                await mongoose.disconnect();
                console.log('🔌 Database connection closed');
            }
        }
    }
}

const checker = new DatabaseChecker();
checker.run();