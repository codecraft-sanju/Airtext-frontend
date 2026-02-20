require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// --- 🌍 CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;

// --- 👑 ADMIN CREDENTIALS ---
const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASS = "admin";

const app = express();
const server = http.createServer(app);

// --- 🛡️ SECURITY MIDDLEWARE ---
app.use(helmet()); 

const corsOptions = {
    origin: FRONTEND_URL, 
    methods: ["GET", "POST", "DELETE"], 
    credentials: true 
};

app.use(cors(corsOptions)); 
app.use(express.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100 
});
app.use('/auth', limiter);

// --- 🔌 SOCKET.IO SETUP (Mobile Optimized) ---
const io = new Server(server, {
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"] 
    },
    pingTimeout: 60000, 
    pingInterval: 25000, 
    transports: ['websocket', 'polling'] 
});

// --- 🗄️ DATABASE ---
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Connected");
        await Message.updateMany({ status: 'Processing' }, { $set: { status: 'Pending' } });
        console.log("🔄 Reset any stuck processing messages to Pending");
    })
    .catch(err => console.error("❌ MongoDB Error:", err));

// 1. USER SCHEMA
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    apiKey: { type: String, unique: true },
    deviceId: { type: String, unique: true },
    lastSeen: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// 2. MESSAGE SCHEMA (🆕 NEW ADDITION)
const MessageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, required: true },
    content: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Processing', 'Sent', 'Failed'], default: 'Pending' },
    errorMessage: { type: String }, 
    webhookUrl: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', MessageSchema);

const deviceSocketMap = new Map(); 
const deviceUserMap = new Map();
const deviceCooldowns = new Map();

// --- 🏠 BASIC ROUTE ---
app.get('/', (req, res) => {
    res.send(`<h1>SMS Gateway Server Running 🚀</h1>`);
});

// --- 🔐 AUTH ROUTES ---
app.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if(!name || !email || !password) return res.status(400).json({message: "All fields required"});
        
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "User already exists" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const apiKey = uuidv4(); 
        const deviceId = `device_${uuidv4().split('-')[0]}`;

        const newUser = new User({ name, email, password: hashedPassword, apiKey, deviceId });
        await newUser.save();

        res.status(201).json({ success: true, message: "User Registered!", apiKey, deviceId });
    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // --- 👑 ADMIN LOGIN CHECK ---
        if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
            return res.json({
                success: true,
                role: 'admin', 
                token: 'admin-super-secret-token',
                user: { name: 'Admin', email: ADMIN_EMAIL }
            });
        }

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid Credentials" });

        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ 
            success: true, 
            role: 'user',
            token, 
            user: { name: user.name, apiKey: user.apiKey, deviceId: user.deviceId } 
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 👑 ADMIN ROUTES ---

// 1. Get All Users (With Online Status)
app.get('/admin/users', async (req, res) => {
    try {
        const users = await User.find({}).sort({ lastSeen: -1 }); 
        
        const userList = users.map(user => {
            const isOnline = deviceSocketMap.has(user.deviceId);
            return {
                _id: user._id,
                name: user.name,
                email: user.email,
                deviceId: user.deviceId,
                apiKey: user.apiKey,
                lastSeen: user.lastSeen,
                isOnline: isOnline 
            };
        });

        res.json({ success: true, users: userList });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Delete User
app.delete('/admin/user/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedUser = await User.findByIdAndDelete(id);
        
        if (deletedUser) {
            const socketId = deviceSocketMap.get(deletedUser.deviceId);
            if (socketId) {
                io.to(socketId).disconnectSockets(); 
                deviceSocketMap.delete(deletedUser.deviceId);
                deviceUserMap.delete(deletedUser.deviceId);
                deviceCooldowns.delete(deletedUser.deviceId);
            }
            res.json({ success: true, message: "User Deleted Successfully" });
        } else {
            res.status(404).json({ success: false, message: "User not found" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 📜 GET MESSAGE HISTORY (🆕 NEW ROUTE) ---
app.get('/user/messages', async (req, res) => {
    try {
        const { apiKey } = req.query; 
        if (!apiKey) return res.status(400).json({ success: false, message: "API Key required" });

        const user = await User.findOne({ apiKey });
        if (!user) return res.status(401).json({ success: false, message: "Invalid API Key" });

        const messages = await Message.find({ userId: user._id })
            .sort({ createdAt: -1 }) 
            .limit(50);

        res.json({ success: true, messages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 🔌 SOCKET CONNECTION LOGIC ---
io.on('connection', async (socket) => {
    const { deviceId } = socket.handshake.auth;
    
    if (!deviceId) return socket.disconnect();

    const user = await User.findOne({ deviceId });
    if (!user) {
        console.log(`🚫 Unknown Device: ${deviceId}`);
        return socket.disconnect();
    }

    console.log(`✅ Online: ${user.name} (${deviceId})`);
    deviceSocketMap.set(deviceId, socket.id);
    deviceUserMap.set(deviceId, user._id);
    
    user.lastSeen = new Date();
    await user.save();

    socket.on('disconnect', () => {
        console.log(`❌ Offline: ${user.name}`);
        deviceSocketMap.delete(deviceId);
        deviceUserMap.delete(deviceId);
    });
});

// --- 🚀 SEND SMS API (UPDATED WITH LOGS) ---
app.post('/send-sms', async (req, res) => {
    try {
        const { apiKey, phone, msg, webhookUrl } = req.body;

        if(!apiKey || !phone || !msg) 
            return res.status(400).json({ success: false, message: "Missing parameters" });
        
        const user = await User.findOne({ apiKey });
        if (!user) return res.status(401).json({ success: false, message: "Invalid API Key" });

        const newMessage = new Message({
            userId: user._id,
            phone,
            content: msg,
            status: 'Pending',
            webhookUrl: webhookUrl || null
        });
        await newMessage.save();

        res.status(202).json({ success: true, message: "Message Queued", messageId: newMessage._id });

    } catch (err) {
        console.error("SMS API Error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

async function processQueue() {
    for (const [deviceId, socketId] of deviceSocketMap.entries()) {
        const cooldown = deviceCooldowns.get(deviceId) || 0;
        if (Date.now() < cooldown) continue; 

        const userId = deviceUserMap.get(deviceId);
        if (!userId) continue;

        const msg = await Message.findOneAndUpdate(
            { userId: userId, status: 'Pending' },
            { status: 'Processing' },
            { sort: { createdAt: 1 }, new: true }
        );

        if (!msg) continue; 

        deviceCooldowns.set(deviceId, Date.now() + 20000);

        let responseHandled = false;

        const handleCompletion = async (status, errorMessage) => {
            if (responseHandled) return;
            responseHandled = true;

            msg.status = status;
            if (errorMessage) msg.errorMessage = errorMessage;
            await msg.save();

            if (msg.webhookUrl) {
                try {
                    await fetch(msg.webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messageId: msg._id,
                            phone: msg.phone,
                            status: msg.status,
                            errorMessage: msg.errorMessage
                        })
                    });
                } catch (webhookError) {
                    console.error("Webhook Error:", webhookError.message);
                }
            }
        };

        const timeout = setTimeout(() => {
            handleCompletion('Failed', 'Device Timeout (No response from app)');
        }, 15000);

        const targetSocket = io.sockets.sockets.get(socketId);
        
        if (targetSocket) {
            targetSocket.emit('send_sms_command', { phone: msg.phone, msg: msg.content, id: msg._id }, (response) => {
                clearTimeout(timeout);
                if (response && response.success) {
                    handleCompletion('Sent', null);
                } else {
                    handleCompletion('Failed', response ? response.error : "App reported failure");
                }
            });
        } else {
            clearTimeout(timeout);
            handleCompletion('Failed', 'Device Disconnected before sending');
        }
    }
}

setInterval(processQueue, 2000);

server.listen(PORT, () => console.log(`🚀 Production Server running on Port ${PORT}`));