import { useState, useEffect, useRef } from 'react';
import './App.css';

// --- Types ---
interface Message {
  id: number;
  text: string;
  sender: 'user' | 'ai';
}

interface Language {
  code: string;
  name: string;
}

interface ConversationMeta {
  conversationId: string;
  lastMessage: string;
  updatedAt: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
}

// --- Supported languages ---
const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-IN', name: 'English (India)' },
  { code: 'hi-IN', name: 'हिन्दी (Hindi)' },
  { code: 'gu-IN', name: 'ગુજરાતી (Gujarati)' },
  { code: 'ta-IN', name: 'தமிழ் (Tamil)' },
  { code: 'ur-IN', name: 'اردو (Urdu)' },
  { code: 'bn-IN', name: 'বাংলা (Bengali)' },
  { code: 'te-IN', name: 'తెలుగు (Telugu)' },
  { code: 'mr-IN', name: 'मराठी (Marathi)' },
  { code: 'es-ES', name: 'Español (España)' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'zh-CN', name: '中文 (Mandarin)' },
  { code: 'ar-SA', name: 'العربية (Arabic)' },
  { code: 'ml-IN', name: 'മലയാളം (Malayalam)' },
  { code: 'ne-NE', name: 'नेपाली (Nepali)' },
];

// --- Speech Recognition Setup ---
const SpeechRecognitionAPI =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

let recognition: SpeechRecognition | null = null;
if (SpeechRecognitionAPI) {
  recognition = new SpeechRecognitionAPI();
  if (recognition) {
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
  }
}

// --- Helper: split words with position ---
const splitWordsWithIndex = (text: string) => {
  const words = text.split(" ");
  let position = 0;
  return words.map(word => {
    const start = position;
    position += word.length + 1;
    return { word, start, end: position };
  });
};

// --- Main App ---
export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(SUPPORTED_LANGUAGES[0].code);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [markdownConverter, setMarkdownConverter] = useState<any>(null);

  const [speakingMessageId, setSpeakingMessageId] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [highlightedWordIndex, setHighlightedWordIndex] = useState<number | null>(null);
  const [currentWords, setCurrentWords] = useState<{ word: string, start: number, end: number }[]>([]);

  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);

  // --- Load voices ---
  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
  }, []);

  // --- Load markdown converter ---
  useEffect(() => {
    if ((window as any).showdown) {
      setMarkdownConverter(new (window as any).showdown.Converter({
        tables: true,
        simplifiedAutoLink: true,
        strikethrough: true,
        tasklists: true
      }));
    }
  }, []);

  // --- Scroll to bottom when messages change ---
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // --- Load conversations from DB ---
  const loadConversationsFromDB = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/conversations");
      const data: ConversationMeta[] = await res.json();
      setConversations(data || []);
      if (!conversationId) {
        if (data && data.length > 0) {
          setConversationId(data[0].conversationId);
          await loadChatsFromDB(data[0].conversationId);
        }
      }
    } catch (err) {
      console.error("Error loading conversations:", err);
    }
  };

  // --- Load chats for a conversation ---
  const loadChatsFromDB = async (convId: string) => {
    try {
      if (!convId) return;
      const res = await fetch(`http://localhost:5000/api/chats?conversationId=${encodeURIComponent(convId)}`);
      const data = await res.json();
      const mapped: Message[] = data.map((chat: any, i: number) => ({
        id: Date.parse(chat.timestamp) + i,
        text: chat.text,
        sender: chat.sender
      }));
      setMessages(mapped);
    } catch (err) {
      console.error("Error loading chats:", err);
    }
  };

  // --- Save chat to DB ---
  const saveChatToDB = async (msg: Message, convId?: string) => {
    try {
      const cid = convId || conversationId || String(Date.now());
      await fetch("http://localhost:5000/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: cid,
          sender: msg.sender,
          text: msg.text,
          timestamp: new Date()
        })
      });
      await loadConversationsFromDB();
    } catch (error) {
      console.error("❌ Error saving chat:", error);
    }
  };

  // --- Delete conversation ---
  const deleteConversation = async (convId: string) => {
    try {
      await fetch(`http://localhost:5000/api/conversations/${encodeURIComponent(convId)}`, { method: "DELETE" });
      await loadConversationsFromDB();
      setConversationId(null);
      const updated = await (await fetch("http://localhost:5000/api/conversations")).json();
      if (updated && updated.length > 0) {
        setConversationId(updated[0].conversationId);
        await loadChatsFromDB(updated[0].conversationId);
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error("Error deleting conversation:", err);
    }
  };

  useEffect(() => {
    loadConversationsFromDB();
  }, []);

  // --- Create a new conversation with welcome message ---
  const createNewConversation = async () => {
    const newId = String(Date.now());
    setConversationId(newId);

    const welcomeMessage = "👋 Hello! I am the Import/Export AI Assistant. Please select your language and ask me anything about global trade.";
    const welcomeMsg: Message = { id: Date.now(), text: welcomeMessage, sender: 'ai' };
    setMessages([welcomeMsg]);

    await saveChatToDB(welcomeMsg, newId);
    await loadConversationsFromDB();
  };

  // --- Speak function ---
  const speak = (text: string, langCode: string, messageId: number) => {
    if (!text || typeof window.speechSynthesis === 'undefined' || voices.length === 0) return;

    if (speakingMessageId === messageId) {
      if (isPaused) {
        window.speechSynthesis.resume();
        setIsPaused(false);
      } else {
        window.speechSynthesis.pause();
        setIsPaused(true);
      }
      return;
    }

    window.speechSynthesis.cancel();

    const cleanText = text.replace(/(\*|_|`|#|\[.*\]\(.*\))/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const words = splitWordsWithIndex(cleanText);
    setCurrentWords(words);

    let selectedVoice = voices.find(voice => voice.lang === langCode);
    if (!selectedVoice) {
      selectedVoice = voices.find(voice => voice.lang.startsWith(langCode.split('-')[0]));
    }
    utterance.voice = selectedVoice || null;
    utterance.lang = langCode;

    utterance.onstart = () => {
      setSpeakingMessageId(messageId);
      setIsPaused(false);
      setHighlightedWordIndex(null);
    };

    utterance.onend = () => {
      setSpeakingMessageId(null);
      setIsPaused(false);
      setHighlightedWordIndex(null);
      setCurrentWords([]);
    };

    utterance.onerror = () => {
      setSpeakingMessageId(null);
      setIsPaused(false);
      setHighlightedWordIndex(null);
      setCurrentWords([]);
    };

    utterance.onboundary = (event: any) => {
      const idx = words.findIndex(w => event.charIndex >= w.start && event.charIndex < w.end);
      if (idx !== -1) setHighlightedWordIndex(idx);
    };

    window.speechSynthesis.speak(utterance);
  };

  // --- Call Gemini API ---
  const callGeminiAPI = async (prompt: string, history: any[] = []) => {
    setIsLoading(true);
    const fullHistory = [...history];
    fullHistory.push({ role: 'user', parts: [{ text: prompt }] });
    const payload = { contents: fullHistory };
    const apiKey = "AIzaSyCVrQzMfM239Hm-gGOklbeWEc_W-pRtuOQ"; // keep safe

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const result = await response.json();
      const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";
      const newAiMessage: Message = { id: Date.now(), text: aiText, sender: 'ai' };
      setMessages(prev => [...prev, newAiMessage]);
      await saveChatToDB(newAiMessage, conversationId || undefined);
    } catch (error) {
      console.error("Error:", error);
      setMessages(prev => [...prev, { id: Date.now(), text: "⚠️ Error connecting to AI.", sender: 'ai' }]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Send user message ---
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    let cid = conversationId;
    if (!cid) {
      cid = String(Date.now());
      setConversationId(cid);
    }

    const newUserMessage: Message = { id: Date.now(), text, sender: 'user' };
    
    // Get the current message history BEFORE adding the new message.
    const currentMessages = [...messages];

    // Now, update the UI with the new user message.
    setMessages(prev => [...prev, newUserMessage]);
    await saveChatToDB(newUserMessage, cid);

    setUserInput('');
    const languageName = SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage)?.name || 'English';
    const systemPrompt = `You are an expert AI assistant specializing in international trade, import, and export. Your name is 'Global Trade AI'. You provide clear, concise, and accurate information on topics like Incoterms, customs procedures, logistics, trade finance, and tariffs. Always be helpful and professional. Format your answers with markdown. CRITICAL: Your entire response MUST be in the following language: ${languageName}.`;
    
    // Build the history from the `currentMessages` array.
    const historyForApi = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Understood." }] },
      ...currentMessages.slice(-6).map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
      }))
    ];

    callGeminiAPI(text, historyForApi);
  };

  // --- Mic toggle ---
  const handleToggleListening = () => {
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }
    recognition.lang = selectedLanguage;
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalTranscript = "";
    recognition.onstart = () => { setIsListening(true); setUserInput(""); };
    recognition.onresult = (event: any) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript + " ";
        else interimTranscript += transcript;
      }
      setUserInput((finalTranscript + interimTranscript).trim());
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  // --- Select conversation ---
  const handleSelectConversation = async (convId: string) => {
    setConversationId(convId);
    await loadChatsFromDB(convId);
  };

  return (
    <div className={`background-container ${theme}`}>
      <div className="chat-container">
        <div className="layout">
          <div className="conversations-panel">
            <div className="conversations-header">
              <strong>Conversations</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={createNewConversation} title="New conversation">+ New</button>
              </div>
            </div>

            <div className="conversations-list">
              {conversations.length === 0 && (
                <div className="no-convos">No conversations yet — start one!</div>
              )}
              {conversations
                .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                .map(conv => (
                  <div
                    key={conv.conversationId || Math.random()}
                    className={`conversation-item ${conversationId === conv.conversationId ? 'active' : ''}`}
                    onClick={() => conv.conversationId && handleSelectConversation(conv.conversationId)}
                  >
                    <div className="conv-id">
                      #{typeof conv.conversationId === "string" ? conv.conversationId.slice(-6) : "------"}
                    </div>
                    <div className="conv-text">
                      {typeof conv.lastMessage === "string" ? conv.lastMessage.slice(0, 80) : "New conversation"}
                    </div>
                    <div className="conv-time">
                      {conv.updatedAt ? new Date(conv.updatedAt).toLocaleString() : ""}
                    </div>
                    <button
                      className="conv-delete"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (conv.conversationId) await deleteConversation(conv.conversationId);
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}
            </div>
          </div>

          <div className="chat-main">
            <div className="chat-header">
              <h1>🌍 Import/Export AI Assistant</h1>
              <div>
                <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)} className="language-selector">
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
                <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="theme-toggle">
                  {theme === 'light' ? '🌙' : '☀️'}
                </button>
              </div>
            </div>

            <div className="message-area" ref={chatContainerRef}>
              <div className="message-list">
                {messages.map((msg) => (
                  <div key={msg.id} className={`message-wrapper message-${msg.sender}`}>
                    {editingMessageId === msg.id ? (
                      <div>
                        <input value={editingText} onChange={(e) => setEditingText(e.target.value)} />
                        <button onClick={() => { setEditingMessageId(null); handleSendMessage(editingText); }}>✅</button>
                        <button onClick={() => setEditingMessageId(null)}>❌</button>
                      </div>
                    ) : (
                      <>
                        <div className="message-bubble">
                          {msg.sender === 'ai' && speakingMessageId === msg.id
                            ? currentWords.map((w, i) => (
                              <span key={i} className={i === highlightedWordIndex ? "spoken-word" : ""}>
                                {w.word}{" "}
                              </span>
                            ))
                            : <span dangerouslySetInnerHTML={{ __html: markdownConverter ? markdownConverter.makeHtml(msg.text) : msg.text }} />}
                        </div>
                        {msg.sender === 'user' && <button onClick={() => { setEditingMessageId(msg.id); setEditingText(msg.text); }}>✏️</button>}
                        {msg.sender === 'ai' && (
                          <button onClick={() => speak(msg.text, selectedLanguage, msg.id)}>
                            {speakingMessageId === msg.id ? (isPaused ? "⏸️" : "▶️") : "🔊"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {isLoading && <div className="loading">...</div>}
              </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(userInput); }} className="input-form">
              <button type="button" onClick={handleToggleListening} className={`mic-button ${isListening ? 'listening' : ''}`}>
                {isListening ? "🛑" : "🎤"}
              </button>
              <input 
                value={userInput} 
                onChange={(e) => setUserInput(e.target.value)} 
                placeholder="Type or speak..." 
                className="text-input"
                disabled={isLoading}
              />
              <button 
                type="submit" 
                className="send-button" 
                disabled={!userInput.trim() || isLoading}
              >
                ➤
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}