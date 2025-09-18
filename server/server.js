const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 Connect to MongoDB Atlas
mongoose.connect(
  "mongodb+srv://Abhay:Abhay123@exim.qfbojwp.mongodb.net/chatdb?retryWrites=true&w=majority&appName=EXIM"
)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Schema & model now includes conversationId
const chatSchema = new mongoose.Schema({
  conversationId: String,   // e.g. "169xxx" or uuid
  sender: String,           // "user" | "ai"
  text: String,
  timestamp: { type: Date, default: Date.now }
});

const Chat = mongoose.model("Chat", chatSchema);

// Save chat (expects conversationId in body)
app.post("/api/chats", async (req, res) => {
  try {
    const chat = new Chat(req.body);
    await chat.save();
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get chats for a conversation
// GET /api/chats?conversationId=<id>
app.get("/api/chats", async (req, res) => {
  try {
    const { conversationId } = req.query;
    if (!conversationId) return res.status(400).json({ error: "conversationId required" });
    const chats = await Chat.find({ conversationId }).sort({ timestamp: 1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List conversations (most recent first)
// aggregated by conversationId, returns { conversationId, lastMessage, updatedAt }
app.get("/api/conversations", async (req, res) => {
  try {
    // group by conversationId and pick latest
    const conversations = await Chat.aggregate([
      { $sort: { conversationId: 1, timestamp: 1 } },
      { $group: {
          _id: "$conversationId",
          lastMessage: { $last: "$text" },
          updatedAt: { $last: "$timestamp" }
        }
      },
      { $sort: { updatedAt: -1 } }
    ]);
    // map to friendly format
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

// Delete a whole conversation
app.delete("/api/conversations/:conversationId", async (req, res) => {
  try {
    const { conversationId } = req.params;
    await Chat.deleteMany({ conversationId });
    res.json({ message: "Conversation deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running at http://localhost:${PORT}`));