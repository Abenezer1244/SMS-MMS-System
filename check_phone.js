#!/usr/bin/env node

/**
 * Quick Phone Number Checker - Find specific phone number in database
 * Usage: node check_phone.js
 */

const mongoose = require('mongoose');
const { Member } = require('./models');
require('dotenv').config();

async function checkPhone() {
    try {
        // Build connection string
        const connectionString = process.env.MONGODB_URI || 
            `mongodb://${process.env.MONGODB_HOST || 'localhost'}:${process.env.MONGODB_PORT || '27017'}/${process.env.MONGODB_DATABASE || 'yesuway_church'}`;

        console.log('🔗 Connecting to MongoDB...');
        mongoose.set('strictQuery', false);
        await mongoose.connect(connectionString);
        console.log('✅ Connected!\n');

        const targetNumber = '2068001141';
        console.log(`🔍 Searching for phone number: ${targetNumber}`);
        console.log('Checking all possible formats...\n');

        // Check all possible variations
        const variations = [
            targetNumber,                    // 2068001141
            `+1${targetNumber}`,            // +12068001141
            `+${targetNumber}`,             // +2068001141
            `1${targetNumber}`,             // 12068001141
        ];

        let foundMembers = [];

        for (const variation of variations) {
            console.log(`🔎 Checking: ${variation}`);
            const members = await Member.find({ phoneNumber: variation });
            
            if (members.length > 0) {
                console.log(`✅ FOUND ${members.length} member(s) with ${variation}:`);
                members.forEach(member => {
                    const status = member.active ? 'Active' : 'Inactive';
                    const admin = member.isAdmin ? ' [ADMIN]' : '';
                    console.log(`   👤 ${member.name}${admin} (${status})`);
                    console.log(`   🆔 ID: ${member._id}`);
                    console.log(`   📅 Created: ${member.createdAt}`);
                    foundMembers.push({ variation, member });
                });
                console.log('');
            } else {
                console.log(`❌ No members found with ${variation}\n`);
            }
        }

        if (foundMembers.length === 0) {
            console.log('❌ No members found with any variation of this phone number');
            
            // Show all members to help debug
            console.log('\n📋 ALL MEMBERS IN DATABASE:');
            const allMembers = await Member.find({}).limit(10);
            allMembers.forEach(member => {
                const status = member.active ? 'Active' : 'Inactive';
                const admin = member.isAdmin ? ' [ADMIN]' : '';
                console.log(`👤 ${member.name}${admin} (${status}) - ${member.phoneNumber}`);
            });
        } else {
            console.log(`✅ Total found: ${foundMembers.length} member(s)`);
            
            if (foundMembers.length > 1) {
                console.log('⚠️ MULTIPLE ENTRIES FOUND - This explains the duplicate error!');
                console.log('💡 You need to remove duplicates to fix the ADD command.');
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from database');
    }
}

checkPhone();