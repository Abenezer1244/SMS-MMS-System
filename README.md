# YesuWay Church SMS Broadcasting System - Node.js

> **A unified SMS communication platform that transforms multiple church groups into one seamless conversation for the entire congregation - Now in Node.js!**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.18+-blue.svg)](https://expressjs.com)
[![Twilio](https://img.shields.io/badge/Twilio-SMS%2FMMS-red.svg)](https://twilio.com)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2%20Storage-orange.svg)](https://cloudflare.com)
[![License](https://img.shields.io/badge/License-Church%20Use-brightgreen.svg)](#license)

---

## 🏛️ Overview

The YesuWay Church SMS Broadcasting System (Node.js Edition) is a production-ready communication platform that allows any congregation member to send a message to one number, which then broadcasts that message to the entire church community across multiple groups. This creates a unified conversation where everyone stays connected, regardless of which original group they belonged to.

### ✨ Key Benefits

- **🔗 Unified Communication**: Transforms 3+ separate SMS groups into one church-wide conversation
- **📱 Universal Access**: Works with any phone (iPhone, Android, flip phones)
- **📸 Rich Media Support**: Share photos, audio, and videos with the entire congregation
- **👑 Admin Controls**: Church leaders can manage members and view statistics via database
- **🤖 Auto-Management**: Secure registration-only system with database member management
- **☁️ 24/7 Operation**: Cloud-hosted for reliable, always-on service
- **🛡️ Error-Free**: Advanced media processing eliminates delivery failures
- **🔇 Smart Reaction Tracking**: Industry-grade silent reaction processing with summaries

---

## 🚀 Quick Start

### For Congregation Members

#### **1. Send Any Message**
Text anything to **+14252875212** and it broadcasts to everyone!
```
"Prayer meeting tonight at 7pm!"
→ Broadcasts to entire congregation
```

#### **2. Share Media**
Send photos, voice messages, or videos - everyone receives them through permanent public URLs.

#### **3. Get Help**
Text `HELP` to see all available commands and system status.

### For Church Administrators

#### **Member Management (Database)**
```sql
-- Add new member to database
INSERT INTO members (phone_number, name, is_admin, active) 
VALUES ('+12065551234', 'John Smith', 0, 1);

-- Add member to group
INSERT INTO group_members (group_id, member_id) 
SELECT 1, id FROM members WHERE phone_number = '+12065551234';
```

#### **View Statistics**
Visit `/health` endpoint or check database directly for comprehensive analytics.

---

## 🏗️ System Architecture

### High-Level Architecture
```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────────┐    ┌──────────────┐
│   Church Member │───▶│ Twilio SMS   │───▶│  YesuWay System     │───▶│ Cloudflare   │
│   +1234567890   │    │ +14252875212 │    │  (Node.js/Express)  │    │ R2 Storage   │
└─────────────────┘    └──────────────┘    └─────────────────────┘    └──────────────┘
                                                       │
                       ┌────────────────────────────────┼────────────────────────────────┐
                       ▼                                ▼                                ▼
            ┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
            │ Congregation    │              │ Congregation    │              │ Congregation    │
            │ Group 1         │              │ Group 2         │              │ Group 3 (MMS)   │
            │ (SMS Members)   │              │ (SMS Members)   │              │ (SMS+MMS)       │
            └─────────────────┘              └─────────────────┘              └─────────────────┘
```

### Smart Reaction Flow
```
📱 Reaction Detected → 🔇 Silent Storage → 🕐 Timer Check → 📊 Summary Generation → 📤 Broadcast Summary
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Runtime** | Node.js 18+ | JavaScript runtime environment |
| **Web Framework** | Express.js 4.18+ | HTTP server and routing |
| **Database** | SQLite3 | Local database with WAL mode |
| **SMS/MMS** | Twilio API | Message sending and receiving |
| **Media Storage** | Cloudflare R2 | Object storage and CDN |
| **Scheduling** | node-schedule | Automated reaction summaries |
| **Logging** | Winston | Production logging |
| **Security** | Helmet + Rate Limiting | Request security |

---

## 🛠️ Installation & Deployment

### Prerequisites

- Node.js 18+ and npm 8+
- Twilio Account with A2P 10DLC registration
- Cloudflare Account with R2 Object Storage
- Cloud hosting account (Render.com recommended)
- GitHub account for code deployment

### Local Development Setup

1. **Clone and Install**
```bash
git clone https://github.com/yourusername/yesuway-church-sms-nodejs.git
cd yesuway-church-sms-nodejs
npm install
```

2. **Environment Configuration**
```bash
cp .env.example .env
# Edit .env with your actual credentials
```

3. **Database Setup**
```bash
npm run setup
```

4. **Development Server**
```bash
npm run dev
```

### Production Deployment (Render.com)

#### **1. Fork and Configure**
- Fork this repository to your GitHub account
- Sign up at [render.com](https://render.com) and connect GitHub

#### **2. Deploy Web Service**
- New → Web Service
- Connect your forked repository
- Configure:
  - **Runtime**: Node
  - **Build Command**: `npm install`
  - **Start Command**: `npm start`

#### **3. Set Environment Variables**
```env
DEVELOPMENT_MODE=false
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_from_twilio
TWILIO_PHONE_NUMBER=+14252875212
R2_ACCESS_KEY_ID=your_cloudflare_r2_access_key
R2_SECRET_ACCESS_KEY=your_cloudflare_r2_secret_key
R2_ENDPOINT_URL=https://abc123.r2.cloudflarestorage.com
R2_BUCKET_NAME=yesuway-church-media
R2_PUBLIC_URL=https://media.yesuwaychurch.org
```

#### **4. Configure Twilio Webhook**
- Go to Twilio Console → Phone Numbers
- Set webhook URL: `https://your-app.onrender.com/webhook/sms`
- Method: POST
- Status Callback URL: `https://your-app.onrender.com/webhook/status`

---

## 📱 User Guide

### For Congregation Members

#### **Basic Messaging**
```sms
"Emergency prayer request for Sister Mary"
→ Instant broadcast to entire congregation
```

#### **Media Sharing**
- **Photos**: Service moments, events, announcements
- **Audio**: Voice prayers, sermon clips, music
- **Videos**: Testimonies, event highlights, teachings

All media is automatically processed for permanent storage and reliable delivery.

#### **Available Commands**
```sms
HELP     → System information and commands
```

### For Church Administrators

#### **Member Management (Database Access Required)**

**Add New Members:**
```sql
-- Add member
INSERT INTO members (phone_number, name, is_admin, active) 
VALUES ('+12065551234', 'John Smith', 0, 1);

-- Get member ID
SELECT id FROM members WHERE phone_number = '+12065551234';

-- Add to group (replace member_id with actual ID)
INSERT INTO group_members (group_id, member_id) VALUES (1, member_id);
```

**View Members:**
```sql
SELECT m.name, m.phone_number, m.is_admin, g.name as group_name
FROM members m
JOIN group_members gm ON m.id = gm.member_id
JOIN groups g ON gm.group_id = g.id
WHERE m.active = 1
ORDER BY m.name;
```

#### **System Monitoring**
- **Health Endpoint**: `GET /health` - System status and statistics
- **Home Page**: `GET /` - Live congregation statistics
- **Test Endpoint**: `POST /test` - Reaction pattern testing

---

## ⚙️ Configuration

### Current Group Setup

| Group ID | Name | Type | Description |
|----------|------|------|-------------|
| 1 | YesuWay Congregation | SMS | Primary congregation group |
| 2 | Church Leadership | SMS | Leadership and admin group |
| 3 | Media Team | MMS | Media-enabled group |

### Customizing Your Congregation

Edit the `setup.js` file to add your congregation members:

```javascript
// In setup.js, modify the customMembers array:
const customMembers = [
    ["+12065551001", "John Smith", 1],      // Group 1
    ["+12065551002", "Mary Johnson", 1],    // Group 1
    ["+12065551003", "Pastor David", 2],    // Group 2 (Leadership)
    ["+12065551004", "Tech Sarah", 3],      // Group 3 (Media)
];
```

---

## 🚀 Advanced Features

### Smart Reaction Tracking

The system detects and processes reactions silently:

#### **Supported Reaction Patterns**
- iPhone: `Loved "message text"`, `Laughed at "message text"`
- Android: `Reacted 😍 to "message text"`
- Emoji: `❤️`, `😂`, `👍`, etc.

#### **Summary Schedule**
- **Daily Summary**: 8:00 PM every day
- **Pause Summary**: After 30 minutes of conversation silence

#### **Benefits**
- **Zero Spam**: No individual reaction broadcasts
- **Full Tracking**: Complete engagement analytics
- **Smart Matching**: Links reactions to correct messages
- **Industry Standard**: Supports all major phone reaction formats

### Advanced Media Processing

```javascript
// Media Processing Pipeline
async processMediaFiles(messageId, mediaUrls) {
    // 1. Download from Twilio (authenticated)
    // 2. Upload to Cloudflare R2 (permanent storage)
    // 3. Generate public URLs (globally accessible)
    // 4. Track in database (complete audit trail)
    // 5. Return clean display names
}
```

#### **Supported Media Types**
- **📸 Images**: JPG, PNG, GIF (unlimited size)
- **🎵 Audio**: MP3, WAV, AMR, voice recordings
- **🎥 Video**: MP4, MOV, 3GPP (unlimited size)
- **📎 Documents**: PDF, TXT (basic support)

### Delivery Tracking and Analytics

Every message is comprehensively tracked:

#### **Performance Metrics**
- Message delivery success rates
- Media processing efficiency
- Reaction engagement statistics
- System performance monitoring

#### **Database Analytics Tables**
- `broadcast_messages` - Complete message history
- `delivery_log` - Individual delivery tracking
- `message_reactions` - Smart reaction storage
- `performance_metrics` - System performance data

---

## 📊 Analytics & Monitoring

### Built-in Analytics Dashboard

#### **Health Endpoint Response**
```json
{
  "status": "healthy",
  "database": {
    "active_members": 25,
    "recent_messages_24h": 15,
    "recent_reactions_24h": 45,
    "processed_media": 152
  },
  "smart_reaction_system": {
    "status": "active",
    "silent_tracking": "enabled",
    "daily_summary_time": "8:00 PM"
  }
}
```

#### **Real-Time Metrics**
- Message volume trends
- Media processing success rates
- Delivery performance by group
- Member engagement statistics

### Database Queries for Analytics

#### **Message Statistics**
```sql
-- Messages per day
SELECT DATE(sent_at) as date, COUNT(*) as messages
FROM broadcast_messages 
WHERE is_reaction = 0
GROUP BY DATE(sent_at)
ORDER BY date DESC;

-- Top reactors
SELECT reactor_name, COUNT(*) as reactions
FROM message_reactions
GROUP BY reactor_name
ORDER BY reactions DESC;
```

---

## 🔐 Security & Privacy

### Security Features

#### **Application Security**
- **🛡️ Helmet.js**: Security headers and XSS protection
- **🚫 Rate Limiting**: Configurable request limiting
- **🔐 Input Validation**: Phone number sanitization
- **📱 CORS**: Cross-origin request security
- **🗂️ SQL Injection Protection**: Parameterized queries

#### **Data Protection**
- **🔒 Environment Variables**: No hardcoded credentials
- **👑 Database-Only Admin**: Secure member management
- **📞 Registration Required**: No auto-registration
- **🔒 WAL Mode SQLite**: ACID compliance and performance

### Privacy Considerations

#### **Data Handling**
- **📞 Phone Number Privacy**: Secure storage with validation
- **💬 Message Logging**: Complete audit trail for accountability
- **🔇 Silent Reactions**: No privacy-invading broadcasts
- **👥 Member Consent**: Registration-based system
- **🗃️ Data Retention**: Configurable retention policies

---

## 💰 Cost Analysis

### Twilio Costs (Production Usage)

| Component | Cost | Monthly Estimate | Notes |
|-----------|------|------------------|-------|
| Phone Number | $1.00/month | $1.00 | One-time setup |
| SMS Messages | $0.0075 each | $15-60 | Based on congregation size |
| MMS Messages | $0.02 each | $10-40 | Photos/videos/audio |

### Cloudflare R2 Costs

| Component | Cost | Monthly Estimate | Notes |
|-----------|------|------------------|-------|
| Storage | $0.015/GB | $0-2 | First 10GB free |
| Operations | $0.0036/1000 | $0-1 | First 1M free |

### Hosting Costs

- **Render.com**: FREE tier (perfect for churches)
- **Alternative**: Railway ($5/month)
- **Enterprise**: Render Pro ($25/month for high availability)

### Example Cost Scenarios

#### **Small Church (25 members, 10 messages/week)**
- **Messages**: 10 × 4 weeks × 25 people = 1,000 SMS
- **Twilio**: 1,000 × $0.0075 = $7.50
- **Hosting**: Free (Render.com)
- **Total**: ~$8.50/month

#### **Medium Church (50 members, 20 messages/week)**
- **Messages**: 20 × 4 weeks × 50 people = 4,000 SMS
- **Twilio**: 4,000 × $0.0075 = $30.00
- **Total**: ~$31/month

---

## 🧪 Testing & Quality Assurance

### Development Testing

#### **Local Testing**
```bash
# Start development server
npm run dev

# Test health endpoint
curl http://localhost:5000/health

# Test reaction detection
curl -X POST http://localhost:5000/test \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+1234567890&Body=Loved \"test message\""
```

#### **Database Testing**
```bash
# Run setup script
npm run setup

# Verify database
sqlite3 production_church.db "SELECT COUNT(*) FROM members;"
```

### Production Testing

#### **SMS Functionality**
1. Send test message from registered number
2. Verify broadcast to all members
3. Check media processing with photo/video
4. Test reaction detection and storage

#### **Health Monitoring**
```bash
# Check system health
curl https://your-app.onrender.com/health

# View system overview
curl https://your-app.onrender.com/
```

---

## 🚨 Troubleshooting

### Common Issues and Solutions

#### **Database Issues**
```bash
# Check database integrity
sqlite3 production_church.db "PRAGMA integrity_check;"

# Reset database (CAUTION: Deletes all data)
rm production_church.db
npm run setup
```

#### **Environment Variables**
```bash
# Check environment
node -e "console.log(process.env.TWILIO_ACCOUNT_SID)"

# Verify .env file
cat .env | grep TWILIO
```

#### **Webhook Issues**
1. **Response Time**: Ensure webhook responds in <15 seconds
2. **URL Configuration**: Verify webhook URL in Twilio Console
3. **SSL/TLS**: Ensure HTTPS endpoint is accessible
4. **Logs**: Check application logs for errors

### Debug Mode

#### **Enable Detailed Logging**
```javascript
// Temporarily modify logging level in app.js
const logger = winston.createLogger({
    level: 'debug', // Change from 'info' to 'debug'
    // ... rest of config
});
```

#### **Database Debugging**
```sql
-- Check recent messages
SELECT * FROM broadcast_messages ORDER BY sent_at DESC LIMIT 10;

-- Check reaction processing
SELECT * FROM message_reactions WHERE is_processed = 0;

-- Check delivery status
SELECT delivery_status,