#!/usr/bin/env node

/**
 * YesuWay Church SMS System - Database Setup Script
 * 
 * This script initializes the database and sets up the production congregation.
 * Run this script once before deploying to production.
 * 
 * Usage: node setup.js
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

console.log('🏛️ YesuWay Church SMS System - Database Setup');
console.log('==================================================');

class DatabaseSetup {
    constructor() {
        this.dbPath = 'production_church.db';
    }

    runAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    allAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    getAsync(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async setupDatabase() {
        console.log('📋 Step 1: Creating database and tables...');
        
        const db = new sqlite3.Database(this.dbPath);
        
        try {
            // Enable WAL mode and optimizations
            await this.runAsync(db, 'PRAGMA journal_mode=WAL');
            await this.runAsync(db, 'PRAGMA synchronous=NORMAL');
            await this.runAsync(db, 'PRAGMA cache_size=10000');
            await this.runAsync(db, 'PRAGMA temp_store=memory');
            await this.runAsync(db, 'PRAGMA foreign_keys=ON');

            // Create all tables
            await this.createTables(db);
            await this.createIndexes(db);
            await this.initializeGroups(db);

            console.log('✅ Database structure created successfully');
        } finally {
            db.close();
        }
    }

    async createTables(db) {
        const tables = [
            // Groups table
            `CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Members table
            `CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                active BOOLEAN DEFAULT TRUE,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                message_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Group membership table
            `CREATE TABLE IF NOT EXISTS group_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
                UNIQUE(group_id, member_id)
            )`,

            // Messages table
            `CREATE TABLE IF NOT EXISTS broadcast_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_phone TEXT NOT NULL,
                from_name TEXT NOT NULL,
                original_message TEXT NOT NULL,
                processed_message TEXT NOT NULL,
                message_type TEXT DEFAULT 'text',
                has_media BOOLEAN DEFAULT FALSE,
                media_count INTEGER DEFAULT 0,
                large_media_count INTEGER DEFAULT 0,
                processing_status TEXT DEFAULT 'completed',
                delivery_status TEXT DEFAULT 'pending',
                is_reaction BOOLEAN DEFAULT FALSE,
                target_message_id INTEGER,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (target_message_id) REFERENCES broadcast_messages (id)
            )`,

            // Smart reaction tracking table
            `CREATE TABLE IF NOT EXISTS message_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_message_id INTEGER NOT NULL,
                reactor_phone TEXT NOT NULL,
                reactor_name TEXT NOT NULL,
                reaction_emoji TEXT NOT NULL,
                reaction_text TEXT NOT NULL,
                is_processed BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (target_message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE
            )`,

            // Reaction summary tracking
            `CREATE TABLE IF NOT EXISTS reaction_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                summary_type TEXT NOT NULL,
                summary_content TEXT NOT NULL,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                messages_included INTEGER DEFAULT 0
            )`,

            // Media files table
            `CREATE TABLE IF NOT EXISTS media_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                original_url TEXT NOT NULL,
                twilio_media_sid TEXT,
                r2_object_key TEXT,
                public_url TEXT,
                clean_filename TEXT,
                display_name TEXT,
                original_size INTEGER,
                final_size INTEGER,
                mime_type TEXT,
                file_hash TEXT,
                compression_detected BOOLEAN DEFAULT FALSE,
                upload_status TEXT DEFAULT 'pending',
                upload_error TEXT,
                access_count INTEGER DEFAULT 0,
                last_accessed DATETIME,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE
            )`,

            // Delivery tracking table
            `CREATE TABLE IF NOT EXISTS delivery_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                to_phone TEXT NOT NULL,
                delivery_method TEXT NOT NULL,
                delivery_status TEXT DEFAULT 'pending',
                twilio_message_sid TEXT,
                error_code TEXT,
                error_message TEXT,
                delivery_time_ms INTEGER,
                retry_count INTEGER DEFAULT 0,
                delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES broadcast_messages (id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
            )`,

            // Analytics table
            `CREATE TABLE IF NOT EXISTS system_analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metric_name TEXT NOT NULL,
                metric_value REAL NOT NULL,
                metric_metadata TEXT,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Performance monitoring table
            `CREATE TABLE IF NOT EXISTS performance_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_type TEXT NOT NULL,
                operation_duration_ms INTEGER NOT NULL,
                success BOOLEAN DEFAULT TRUE,
                error_details TEXT,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const tableSQL of tables) {
            await this.runAsync(db, tableSQL);
        }
    }

    async createIndexes(db) {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone_number)',
            'CREATE INDEX IF NOT EXISTS idx_members_active ON members(active)',
            'CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON broadcast_messages(sent_at)',
            'CREATE INDEX IF NOT EXISTS idx_messages_is_reaction ON broadcast_messages(is_reaction)',
            'CREATE INDEX IF NOT EXISTS idx_messages_target ON broadcast_messages(target_message_id)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_target ON message_reactions(target_message_id)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_processed ON message_reactions(is_processed)',
            'CREATE INDEX IF NOT EXISTS idx_reactions_created ON message_reactions(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_media_message_id ON media_files(message_id)',
            'CREATE INDEX IF NOT EXISTS idx_media_status ON media_files(upload_status)',
            'CREATE INDEX IF NOT EXISTS idx_delivery_message_id ON delivery_log(message_id)',
            'CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_log(delivery_status)',
            'CREATE INDEX IF NOT EXISTS idx_analytics_metric ON system_analytics(metric_name, recorded_at)',
            'CREATE INDEX IF NOT EXISTS idx_performance_type ON performance_metrics(operation_type, recorded_at)'
        ];

        for (const indexSQL of indexes) {
            await this.runAsync(db, indexSQL);
        }
    }

    async initializeGroups(db) {
        const count = await this.getAsync(db, "SELECT COUNT(*) as count FROM groups");
        
        if (count.count === 0) {
            const productionGroups = [
                ["YesuWay Congregation", "Main congregation group"],
                ["Church Leadership", "Leadership and admin group"],
                ["Media Team", "Media and technology team"]
            ];

            for (const [name, description] of productionGroups) {
                await this.runAsync(db, "INSERT INTO groups (name, description) VALUES (?, ?)", [name, description]);
            }
            console.log('✅ Production groups initialized');
        } else {
            console.log('ℹ️ Groups already exist, skipping initialization');
        }
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

    async setupProductionCongregation() {
        console.log('📋 Step 2: Setting up production congregation...');
        
        const db = new sqlite3.Database(this.dbPath);
        
        try {
            // Add primary admin
            await this.runAsync(db, `
                INSERT OR REPLACE INTO members (phone_number, name, is_admin, active, message_count) 
                VALUES (?, ?, ?, 1, 0)
            `, ["+14257729189", "Church Admin", true]);

            const adminResult = await this.getAsync(db, "SELECT id FROM members WHERE phone_number = ?", ["+14257729189"]);
            if (!adminResult) {
                throw new Error("Failed to create admin user");
            }
            const adminId = adminResult.id;

            // Add to admin group
            await this.runAsync(db, `
                INSERT OR IGNORE INTO group_members (group_id, member_id) 
                VALUES (2, ?)
            `, [adminId]);

            // Add production members
            const productionMembers = [
                ["+12068001141", "Mike", 1],
                ["+14257729189", "Sam", 1],
                ["+12065910943", "Sami", 3],
                ["+12064349652", "Yab", 1]
            ];

            for (const [phone, name, groupId] of productionMembers) {
                const cleanPhone = this.cleanPhoneNumber(phone);
                
                await this.runAsync(db, `
                    INSERT OR REPLACE INTO members (phone_number, name, is_admin, active, message_count) 
                    VALUES (?, ?, ?, 1, 0)
                `, [cleanPhone, name, false]);

                const memberResult = await this.getAsync(db, "SELECT id FROM members WHERE phone_number = ?", [cleanPhone]);
                if (!memberResult) {
                    console.warn(`⚠️ Failed to create member: ${name}`);
                    continue;
                }
                const memberId = memberResult.id;

                await this.runAsync(db, `
                    INSERT OR IGNORE INTO group_members (group_id, member_id) 
                    VALUES (?, ?)
                `, [groupId, memberId]);

                console.log(`✅ Added member: ${name} (${cleanPhone}) to group ${groupId}`);
            }

            console.log('✅ Production congregation setup completed');
        } finally {
            db.close();
        }
    }

    async addCustomMembers() {
        console.log('📋 Step 3: Custom member addition...');
        
        // Configure your congregation members here
        const customMembers = [
            // Add your congregation members in this format:
            // ["+15551234567", "John Smith", 1],      // Group 1 = Main congregation
            // ["+15551234568", "Jane Pastor", 2],     // Group 2 = Leadership
            // ["+15551234569", "Tech Person", 3],     // Group 3 = Media team
        ];

        if (customMembers.length === 0) {
            console.log('ℹ️ No custom members configured. Edit setup.js to add your congregation.');
            console.log('💡 Add members to the customMembers array above this message.');
            return;
        }

        const db = new sqlite3.Database(this.dbPath);
        
        try {
            for (const [phone, name, groupId] of customMembers) {
                const cleanPhone = this.cleanPhoneNumber(phone);
                
                await this.runAsync(db, `
                    INSERT OR REPLACE INTO members (phone_number, name, is_admin, active, message_count) 
                    VALUES (?, ?, ?, 1, 0)
                `, [cleanPhone, name, false]);

                const memberResult = await this.getAsync(db, "SELECT id FROM members WHERE phone_number = ?", [cleanPhone]);
                if (!memberResult) {
                    console.warn(`⚠️ Failed to create custom member: ${name}`);
                    continue;
                }
                const memberId = memberResult.id;

                await this.runAsync(db, `
                    INSERT OR IGNORE INTO group_members (group_id, member_id) 
                    VALUES (?, ?)
                `, [groupId, memberId]);

                console.log(`✅ Added custom member: ${name} (${cleanPhone}) to group ${groupId}`);
            }

            console.log(`✅ Added ${customMembers.length} custom members`);
        } finally {
            db.close();
        }
    }

    async verifySetup() {
        console.log('📋 Step 4: Verifying setup...');
        
        const db = new sqlite3.Database(this.dbPath);
        
        try {
            const groupCount = await this.getAsync(db, "SELECT COUNT(*) as count FROM groups");
            const memberCount = await this.getAsync(db, "SELECT COUNT(*) as count FROM members WHERE active = 1");
            const adminCount = await this.getAsync(db, "SELECT COUNT(*) as count FROM members WHERE is_admin = 1 AND active = 1");
            
            console.log('📊 Setup Verification:');
            console.log(`   Groups: ${groupCount.count}`);
            console.log(`   Active Members: ${memberCount.count}`);
            console.log(`   Administrators: ${adminCount.count}`);

            // List all members
            const members = await this.allAsync(db, `
                SELECT m.name, m.phone_number, m.is_admin, g.name as group_name
                FROM members m
                JOIN group_members gm ON m.id = gm.member_id
                JOIN groups g ON gm.group_id = g.id
                WHERE m.active = 1
                ORDER BY m.name
            `);

            console.log('\n👥 Registered Members:');
            for (const member of members) {
                const role = member.is_admin ? '(Admin)' : '';
                console.log(`   • ${member.name} ${role} - ${member.phone_number} - ${member.group_name}`);
            }

            if (memberCount.count === 0) {
                console.warn('⚠️ No members found! The system requires at least one member to function.');
                console.log('💡 Edit the customMembers array in setup.js to add your congregation.');
            }

            console.log('\n✅ Database setup verification completed');
        } finally {
            db.close();
        }
    }

    async checkEnvironment() {
        console.log('📋 Step 5: Environment validation...');
        
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

        // Validate specific formats
        if (process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
            invalid.push('TWILIO_ACCOUNT_SID (must start with AC)');
        }

        if (process.env.R2_ENDPOINT_URL && !process.env.R2_ENDPOINT_URL.startsWith('https://')) {
            invalid.push('R2_ENDPOINT_URL (must start with https://)');
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
            console.log('   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
            console.log('   TWILIO_AUTH_TOKEN=your_auth_token_from_twilio');
            console.log('   TWILIO_PHONE_NUMBER=+1234567890');
            console.log('   R2_ACCESS_KEY_ID=your_cloudflare_r2_access_key');
            console.log('   R2_SECRET_ACCESS_KEY=your_cloudflare_r2_secret_key');
            console.log('   R2_ENDPOINT_URL=https://account.r2.cloudflarestorage.com');
            console.log('   R2_BUCKET_NAME=your-church-media-bucket');
            console.log('   R2_PUBLIC_URL=https://media.yourchurch.org');
            
            console.log('\n🚨 PRODUCTION DEPLOYMENT WILL FAIL WITHOUT PROPER CONFIGURATION');
        }
    }

    async validateDatabaseIntegrity() {
        console.log('📋 Step 6: Database integrity check...');
        
        const db = new sqlite3.Database(this.dbPath);
        
        try {
            // Check database integrity
            const integrityResult = await this.getAsync(db, "PRAGMA integrity_check");
            if (integrityResult.integrity_check !== 'ok') {
                throw new Error(`Database integrity check failed: ${integrityResult.integrity_check}`);
            }

            // Verify foreign key constraints
            const fkResult = await this.getAsync(db, "PRAGMA foreign_key_check");
            if (fkResult) {
                throw new Error('Foreign key constraint violations detected');
            }

            // Check that essential tables exist
            const tables = await this.allAsync(db, "SELECT name FROM sqlite_master WHERE type='table'");
            const tableNames = tables.map(t => t.name);
            
            const requiredTables = [
                'groups', 'members', 'group_members', 'broadcast_messages',
                'message_reactions', 'media_files', 'delivery_log'
            ];

            const missingTables = requiredTables.filter(table => !tableNames.includes(table));
            if (missingTables.length > 0) {
                throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
            }

            console.log('✅ Database integrity verified');
            console.log(`📊 Database contains ${tableNames.length} tables`);
            
        } finally {
            db.close();
        }
    }

    async run() {
        try {
            console.log('🚀 Starting production database setup...\n');
            
            await this.setupDatabase();
            await this.setupProductionCongregation();
            await this.addCustomMembers();
            await this.verifySetup();
            await this.validateDatabaseIntegrity();
            await this.checkEnvironment();
            
            console.log('\n🎉 Production setup completed successfully!');
            console.log('\n📝 Next steps for production deployment:');
            console.log('   1. ✅ Configure environment variables (.env file)');
            console.log('   2. ✅ Deploy to hosting platform (Render.com recommended)');
            console.log('   3. ✅ Configure Twilio webhook URL');
            console.log('   4. ✅ Set up A2P 10DLC registration with Twilio');
            console.log('   5. ✅ Configure Cloudflare R2 bucket and domain');
            console.log('   6. ✅ Send first message to church number');
            console.log('\n💚 Your production church SMS system is ready to serve!');
            console.log('🏛️ Professional church communication platform');
            console.log('🔇 Smart reaction tracking with silent processing');
            console.log('🧹 Clean media display with professional presentation');
            console.log('🛡️ Secure registration-only member access');
            
        } catch (error) {
            console.error('\n❌ Production setup failed:', error.message);
            console.error('Stack trace:', error.stack);
            console.log('\n🔧 Troubleshooting:');
            console.log('   • Ensure database file permissions are correct');
            console.log('   • Check that SQLite3 is properly installed');
            console.log('   • Verify no other processes are using the database');
            console.log('   • Run setup with elevated permissions if needed');
            process.exit(1);
        }
    }
}

// Production environment check
if (!fs.existsSync('.env')) {
    console.log('⚠️ No .env file found.');
    console.log('💡 Create .env file with your production credentials before deployment.');
    console.log('📋 Required environment variables will be validated during setup.\n');
}

// Run production setup
const setup = new DatabaseSetup();
setup.run();