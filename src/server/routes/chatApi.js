const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const { protect } = require('../middleware/authMiddleware');

// Get all conversations for the logged-in user
router.get('/conversations', protect, async (req, res) => {
  try {
    const chats = await Chat.find({ user: req.user._id }).sort({ timestamp: -1 });
    const conversations = chats.reduce((acc, chat) => {
      if (!acc[chat.conversationId]) {
        acc[chat.conversationId] = {
          conversationId: chat.conversationId,
          lastMessage: chat.text,
          updatedAt: chat.timestamp,
        };
      }
      return acc;
    }, {});
    res.json(Object.values(conversations));
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// Get all chats for a specific conversation
router.get('/chats', protect, async (req, res) => {
  try {
    const { conversationId } = req.query;
    const chats = await Chat.find({
      user: req.user._id,
      conversationId: conversationId,
    }).sort({ timestamp: 'asc' });
    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// Save a new chat message
router.post('/chats', protect, async (req, res) => {
  try {
    const { conversationId, sender, text } = req.body;
    const newChat = new Chat({
      user: req.user._id,
      conversationId,
      sender,
      text,
    });
    await newChat.save();
    res.status(201).json(newChat);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// Delete a conversation
router.delete('/conversations/:convId', protect, async (req, res) => {
  try {
    await Chat.deleteMany({
      user: req.user._id,
      conversationId: req.params.convId,
    });
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;