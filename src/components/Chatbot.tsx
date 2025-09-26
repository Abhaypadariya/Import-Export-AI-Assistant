import { useState, useEffect, useRef } from "react";
import "../App.css";

// --- Helper function to get auth headers ---
const getAuthHeaders = (): HeadersInit => {
  const userInfoString = localStorage.getItem("userInfo");
  if (!userInfoString) {
    return {}; 
  }
  const userInfo = JSON.parse(userInfoString);
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${userInfo.token}`,
  };
};

// --- Types ---
interface Message {
  id: number;
  text: string;
  sender: "user" | "ai";
  edited?: boolean;
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
  { code: "en-US", name: "English (US)" },
  { code: "en-IN", name: "English (India)" },
  { code: "hi-IN", name: "हिन्दी (Hindi)" },
  { code: "gu-IN", name: "ગુજરાતી (Gujarati)" },
  { code: "ta-IN", name: "தமிழ் (Tamil)" },
  { code: "ur-IN", name: "اردو (Urdu)" },
  { code: "bn-IN", name: "বাংলা (Bengali)" },
  { code: "te-IN", name: "తెలుగు (Telugu)" },
  { code: "mr-IN", name: "मราฐี (Marathi)" },
  { code: "es-ES", name: "Español (España)" },
  { code: "fr-FR", name: "Français" },
  { code: "zh-CN", name: "中文 (Mandarin)" },
  { code: "ar-SA", name: "العربية (Arabic)" },
  { code: "ml-IN", name: "മലയാളം (Malayalam)" },
  { code: "ne-NE", name: "नेपाली (Nepali)" },
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
  return words.map((word) => {
    const start = position;
    position += word.length + 1;
    return { word, start, end: position };
  });
};

// --- Main Chatbot Component ---
export default function Chatbot() {
  // This line determines which backend URL to use for API calls
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    SUPPORTED_LANGUAGES[0].code
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [markdownConverter, setMarkdownConverter] = useState<any>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [highlightedWordIndex, setHighlightedWordIndex] = useState<number | null>(
    null
  );
  const [currentWords, setCurrentWords] = useState<
    { word: string; start: number; end: number }[]
  >([]);
  const currentWordsRef = useRef<{ word: string; start: number; end: number }[]>(
    []
  );
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);

  const handleLogout = () => {
    localStorage.removeItem("userInfo");
    window.location.href = "/login";
  };

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
  }, []);

  useEffect(() => {
    if ((window as any).showdown) {
      setMarkdownConverter(
        new (window as any).showdown.Converter({
          tables: true,
          simplifiedAutoLink: true,
          strikethrough: true,
          tasklists: true,
        })
      );
    }
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const loadConversationsFromDB = async () => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/conversations`, { headers });
      if (!res.ok) {
        if (res.status === 401) window.location.href = "/login";
        return;
      }
      const data: ConversationMeta[] = await res.json();
      setConversations(data || []);
      if (!conversationId && data.length > 0) {
        setConversationId(data[0].conversationId);
        await loadChatsFromDB(data[0].conversationId);
      }
    } catch (err) {
      console.error("Error loading conversations:", err);
    }
  };

  const loadChatsFromDB = async (convId: string) => {
    try {
      if (!convId) return;
      const headers = getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/chats?conversationId=${encodeURIComponent(convId)}`,
        { headers }
      );
       if (!res.ok) {
        if (res.status === 401) window.location.href = "/login";
        return;
      }
      const data = await res.json();
      const mapped: Message[] = data.map((chat: any, i: number) => ({
        id: Date.parse(chat.timestamp) + i,
        text: chat.text,
        sender: chat.sender,
      }));
      setMessages(mapped);
    } catch (err) {
      console.error("Error loading chats:", err);
    }
  };

  const saveChatToDB = async (msg: Message, convId?: string) => {
    try {
      const cid = convId || conversationId || String(Date.now());
      const headers = getAuthHeaders();

      await fetch(`${API_BASE}/api/chats`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          conversationId: cid,
          sender: msg.sender,
          text: msg.text,
          timestamp: new Date(),
        }),
      });
      await loadConversationsFromDB();
    } catch (error) {
      console.error("❌ Error saving chat:", error);
    }
  };

  const deleteConversation = async (convId: string) => {
    try {
      const headers = getAuthHeaders();
      await fetch(
        `${API_BASE}/api/conversations/${encodeURIComponent(convId)}`,
        { method: "DELETE", headers }
      );
      await loadConversationsFromDB();
      setConversationId(null);
      const updatedRes = await fetch(`${API_BASE}/api/conversations`, { headers });
      const updated = await updatedRes.json();
      if (updated.length > 0) {
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
    const userInfo = localStorage.getItem("userInfo");
    if (userInfo) {
      loadConversationsFromDB();
    }
  }, []);

  const createNewConversation = async () => {
    const newId = String(Date.now());
    setConversationId(newId);

    const welcomeMessage =
      "👋 Hello! I am the Import/Export AI Assistant. Please select your language and ask me anything about global trade.";
    const welcomeMsg: Message = {
      id: Date.now(),
      text: welcomeMessage,
      sender: "ai",
    };
    setMessages([welcomeMsg]);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
    await saveChatToDB(welcomeMsg, newId);
    await loadConversationsFromDB();
  };

  const speak = (text: string, langCode: string, messageId: number) => {
    if (
      !text ||
      typeof window.speechSynthesis === "undefined" ||
      voices.length === 0
    )
      return;

    if (speakingMessageId === messageId) {
      if (isPaused) window.speechSynthesis.resume();
      else window.speechSynthesis.pause();
      setIsPaused(!isPaused);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = text.replace(/(\*|_|`|#|\[.*\]\(.*\))/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);

    const words = splitWordsWithIndex(cleanText);
    currentWordsRef.current = words;
    setCurrentWords(words);

    let selectedVoice =
      voices.find((v) => v.lang === langCode) ||
      voices.find((v) => v.lang.startsWith(langCode.split("-")[0]));
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
      currentWordsRef.current = [];
    };
    utterance.onerror = () => {
      setSpeakingMessageId(null);
      setIsPaused(false);
      setHighlightedWordIndex(null);
      setCurrentWords([]);
      currentWordsRef.current = [];
    };
    utterance.onboundary = (event: any) => {
      const idx = currentWordsRef.current.findIndex(
        (w) => event.charIndex >= w.start && event.charIndex < w.end
      );
      if (idx !== -1) setHighlightedWordIndex(idx);
    };

    window.speechSynthesis.speak(utterance);
  };

  const callGeminiAPI = async (prompt: string, history: any[] = []) => {
    setIsLoading(true);
    const fullHistory = [
      ...history,
      { role: "user", parts: [{ text: prompt }] },
    ];
    const payload = { contents: fullHistory };
    const apiKey = "AIzaSyCpnX3snLNg8_iesNkSVn4wGQeZIgIPPYA"; // Replace with your key

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const result = await response.json();
      const aiText =
        result.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Sorry, I couldn't generate a response.";
      const newAiMessage: Message = {
        id: Date.now(),
        text: aiText,
        sender: "ai",
      };
      setMessages((prev) => [...prev, newAiMessage]);
      await saveChatToDB(newAiMessage, conversationId || undefined);
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), text: "⚠️ Error connecting to AI.", sender: "ai" },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const cid = conversationId || String(Date.now());
    setConversationId(cid);

    if (editingMessageId !== null) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === editingMessageId ? { ...msg, text, edited: true } : msg
        )
      );

      try {
        const headers = getAuthHeaders();
        await fetch(`${API_BASE}/api/chats`, {
          method: "PUT",
          headers: headers,
          body: JSON.stringify({
            conversationId: cid,
            messageId: editingMessageId,
            text,
          }),
        });
      } catch (err) {
        console.error("❌ Error updating user message:", err);
      }
      
      const aiMsg = messages.find(
        (msg) => msg.sender === "ai" && msg.id > editingMessageId
      );
      if (aiMsg) {
        try {
          const headers = getAuthHeaders();
          await fetch(`${API_BASE}/api/chats/${aiMsg.id}`, {
            method: "DELETE",
            headers: headers,
          });
        } catch (err) {
          console.error("❌ Error deleting old AI response:", err);
        }
        setMessages((prev) => prev.filter((msg) => msg.id !== aiMsg.id));
      }

      const languageName =
        SUPPORTED_LANGUAGES.find((l) => l.code === selectedLanguage)?.name ||
        "English";
      // const systemPrompt = `You are 'Global Trade AI', an expert assistant specialized ONLY in import and export. IMPORTANT: If the user asks anything outside import/export or international trade, politely respond: "Sorry, I can only help with import and export related questions." CRITICAL: Your entire response MUST be in the following language: ${languageName}.`;
const systemPrompt = `
You are 'Global Trade AI', an expert assistant specialized ONLY in international trade, import, and export.

⚠️ RULES:
1. Accept questions even if the user makes grammar mistakes, spelling errors, or writes in an informal way.
2. Correct the interpretation of the question internally and always provide a clear, accurate, and professional answer.
3. Answer ONLY topics related to:
   - Import/export processes
   - Customs, duties, tariffs
   - International logistics and shipping
   - Incoterms
   - Trade agreements
   - Export/import documentation (invoice, packing list, bill of lading, etc.)
   - Trade finance, LC, bank guarantees
4. If the user asks anything unrelated to import/export or international trade, politely respond:
   "Sorry, I can only help with import and export related questions."
5. Always provide answers that are:
   - Concise and to the point
   - Easy to understand
   - Free of unnecessary detail
   - Written in the user’s selected language: ${languageName}
6. If a step-by-step explanation is helpful, format it in numbered or bullet points for clarity.
7. Use simple and professional language, even if the question is poorly phrased.

Remember: Your job is to clarify and give **cut-to-cut, correct answers** about import and export.
`;

      const historyForApi = [
        { role: "user", parts: [{ text: systemPrompt }] },
        ...messages
          .filter((msg) => msg.id !== editingMessageId && msg.sender !== "ai")
          .slice(-6)
          .map((msg) => ({
            role: msg.sender === "user" ? "user" : "model",
            parts: [{ text: msg.text }],
          })),
      ];

      setEditingMessageId(null);
      setEditingText("");
      callGeminiAPI(text, historyForApi);
      return;
    }

    const newUserMessage: Message = { id: Date.now(), text, sender: "user" };
    setMessages((prev) => [...prev, newUserMessage]);
    await saveChatToDB(newUserMessage, cid);

    setUserInput("");

    const languageName =
      SUPPORTED_LANGUAGES.find((l) => l.code === selectedLanguage)?.name ||
      "English";
    const systemPrompt = `You are 'Global Trade AI', an expert assistant specialized ONLY in import and export. IMPORTANT: If the user asks anything outside import/export or international trade, politely respond: "Sorry, I can only help with import and export related questions." CRITICAL: Your entire response MUST be in the following language: ${languageName}.`;

    const historyForApi = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Understood." }] },
      ...messages.slice(-6).map((msg) => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      })),
    ];

    callGeminiAPI(text, historyForApi);
  };

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

    recognition.onstart = () => {
      setIsListening(true);
      setUserInput("");
    };
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

  const handleSelectConversation = async (convId: string) => {
    setConversationId(convId);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
    await loadChatsFromDB(convId);
  };

  return (
    <div className={`background-container ${theme}`}>
      <div className="chat-container">
        <div
          className={`layout ${
            isSidebarOpen ? "sidebar-open" : "sidebar-closed"
          }`}
        >
          <div className="conversations-panel">
            <div className="conversations-header">
              <strong>Conversations</strong>
              <button
                onClick={createNewConversation}
                className="new-convo-btn"
                title="Start a new conversation"
              >
                + New
              </button>
            </div>
            <div className="conversations-list">
              {conversations.length === 0 && (
                <div className="no-convos">No conversations yet — start one!</div>
              )}
              {conversations
                .sort(
                  (a, b) =>
                    new Date(b.updatedAt).getTime() -
                    new Date(a.updatedAt).getTime()
                )
                .map((conv) => (
                  <div
                    key={conv.conversationId || Math.random()}
                    className={`conversation-item ${
                      conversationId === conv.conversationId ? "active" : ""
                    }`}
                    onClick={() =>
                      conv.conversationId &&
                      handleSelectConversation(conv.conversationId)
                    }
                  >
                    <div className="conv-id">
                      #{conv.conversationId?.slice(-6)}
                    </div>
                    <div className="conv-text">
                      {conv.lastMessage?.slice(0, 80) || "New conversation"}
                    </div>
                    <div className="conv-time">
                      {conv.updatedAt
                        ? new Date(conv.updatedAt).toLocaleString()
                        : ""}
                    </div>
                    <button
                      className="conv-delete"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (conv.conversationId)
                          await deleteConversation(conv.conversationId);
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}
            </div>
             <div className="logout-section">
                <button onClick={handleLogout} className="logout-btn">
                  Logout
                </button>
              </div>
          </div>
          <div className="chat-main">
            <div className="chat-header">
              <button
                className="menu-toggle"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              >
                ☰
              </button>
              <h1>🌍 Import/Export AI Assistant</h1>
              <div>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="language-selector"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                  className="theme-toggle"
                >
                  {theme === "light" ? "🌙" : "☀️"}
                </button>
              </div>
            </div>
            <div className="message-area" ref={chatContainerRef}>
              <div className="message-list">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-wrapper message-${msg.sender}`}
                  >
                    {editingMessageId === msg.id ? (
                      <div className="edit-message">
                        <input
                          className="edit-input"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                        />
                        <button
                          className="edit-btn"
                          onClick={() => {
                            setEditingMessageId(null);
                            handleSendMessage(editingText);
                          }}
                        >
                          ✅
                        </button>
                        <button
                          className="edit-btn cancel-btn"
                          onClick={() => setEditingMessageId(null)}
                        >
                          ❌
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="message-bubble">
                          {msg.sender === "ai" &&
                          speakingMessageId === msg.id ? (
                            currentWords.map((w, i) => (
                              <span
                                key={i}
                                className={
                                  i === highlightedWordIndex
                                    ? "spoken-word"
                                    : ""
                                }
                              >
                                {w.word}{" "}
                              </span>
                            ))
                          ) : (
                            <span
                              dangerouslySetInnerHTML={{
                                __html: markdownConverter
                                  ? markdownConverter.makeHtml(msg.text)
                                  : msg.text,
                              }}
                            />
                          )}
                          {msg.edited && (
                            <span className="edited-tag">(edited)</span>
                          )}
                        </div>
                        {msg.sender === "user" && (
                          <button
                            className="edit-btn"
                            onClick={() => {
                              setEditingMessageId(msg.id);
                              setEditingText(msg.text);
                            }}
                          >
                            ✏️
                          </button>
                        )}
                        {msg.sender === "ai" && (
                          <button
                            onClick={() =>
                              speak(msg.text, selectedLanguage, msg.id)
                            }
                          >
                            {speakingMessageId === msg.id
                              ? isPaused
                                ? "▶️"
                                : "⏸️"
                              : "🔊"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {isLoading && <div className="loading">...</div>}
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage(userInput);
              }}
              className="input-form"
            >
              <button
                type="button"
                onClick={handleToggleListening}
                className={`mic-button ${
                  isListening ? "listening" : ""
                }`}
              >
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