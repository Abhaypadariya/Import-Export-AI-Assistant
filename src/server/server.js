const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
// --- NEW: Import required packages ---
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Loads variables from .env file

const app = express();
app.use(cors());
app.use(express.json());

// --- MODIFIED: Connect using the secure .env variable ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// --- NEW: User Schema and Model ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
});

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Method to compare entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);

// --- MODIFIED: Chat Schema now links to a User ---
const chatSchema = new mongoose.Schema({
  user: { // This field links the chat to a specific user
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  conversationId: String,
  sender: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});

const Chat = mongoose.model("Chat", chatSchema);

// --- NEW: JWT Helper Functions and Middleware ---

// Function to generate a JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Middleware to protect routes
const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            // Attach user to the request object
            req.user = await User.findById(decoded.id).select('-password');
            next();
        } catch (error) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }
    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }
};

// --- NEW: Authentication Routes ---

// @route   POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
    const { username, password } = req.body;
    try {
        const userExists = await User.findOne({ username });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }
        const user = await User.create({ username, password });
        res.status(201).json({
            _id: user._id,
            username: user.username,
            token: generateToken(user._id)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// @route   POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (user && (await user.matchPassword(password))) {
            res.json({
                _id: user._id,
                username: user.username,
                token: generateToken(user._id)
            });
        } else {
            res.status(401).json({ message: 'Invalid username or password' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --- MODIFIED: All Chat Routes are now protected and user-specific ---

// Save chat (expects conversationId in body)
app.post("/api/chats", protect, async (req, res) => { // Added 'protect' middleware
  try {
    const chatData = {
        ...req.body,
        user: req.user._id // Associate chat with the logged-in user
    };
    const chat = new Chat(chatData);
    await chat.save();
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get chats for a conversation
app.get("/api/chats", protect, async (req, res) => { // Added 'protect' middleware
  try {
    const { conversationId } = req.query;
    if (!conversationId) return res.status(400).json({ error: "conversationId required" });
    // Find chats that match conversationId AND the logged-in user
    const chats = await Chat.find({ conversationId, user: req.user._id }).sort({ timestamp: 1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List conversations (most recent first) for the logged-in user
app.get("/api/conversations", protect, async (req, res) => { // Added 'protect' middleware
  try {
    const conversations = await Chat.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(req.user._id) } }, // Only get chats for this user
      { $sort: { conversationId: 1, timestamp: 1 } },
      { $group: {
          _id: "$conversationId",
          lastMessage: { $last: "$text" },
          updatedAt: { $last: "$timestamp" }
        }
      },
      { $sort: { updatedAt: -1 } }
    ]);
    const result = conversations.map(c => ({
      conversationId: c._id,
      lastMessage: c.lastMessage,
      updatedAt: c.updatedAt
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a whole conversation belonging to the logged-in user
app.delete("/api/conversations/:conversationId", protect, async (req, res) => { // Added 'protect' middleware
  try {
    const { conversationId } = req.params;
    // Ensure we only delete conversations belonging to this user
    await Chat.deleteMany({ conversationId, user: req.user._id });
    res.json({ message: "Conversation deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


const PORT = process.env.PORT || 5000;
// NEW CODE
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Backend running on port ${PORT}`));