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

// Supported Languages 
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

// --- Helper: Split words with positions ---
const splitWordsWithIndex = (text: string) => {
  const words = text.split(" ");
  let position = 0;
  return words.map(word => {
    const start = position;
    position += word.length + 1; // +1 for space
    return { word, start, end: position };
  });
};

// --- Main App Component ---
export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(SUPPORTED_LANGUAGES[0].code);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [markdownConverter, setMarkdownConverter] = useState<any>(null);

  // --- Speaker states ---
  const [speakingMessageId, setSpeakingMessageId] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [highlightedWordIndex, setHighlightedWordIndex] = useState<number | null>(null);
  const [currentWords, setCurrentWords] = useState<{word: string, start: number, end: number}[]>([]);

  // --- Edit states ---
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  // --- Theme ---
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // --- Effects ---
  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
  }, []);

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

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const welcomeMessage = "👋 Hello! I am the Import/Export AI Assistant. Please select your language and ask me anything about global trade.";
      setMessages([{ id: Date.now(), text: welcomeMessage, sender: 'ai' }]);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  // --- Speaker (highlight + pause/resume) ---
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

  // --- Gemini API ---
  const callGeminiAPI = async (prompt: string, history: any[] = []) => {
    setIsLoading(true);
    const fullHistory = [...history];
    fullHistory.push({ role: 'user', parts: [{ text: prompt }] });
    const payload = { contents: fullHistory };
    const apiKey = "AIzaSyCVrQzMfM239Hm-gGOklbeWEc_W-pRtuOQ"; 
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const result = await response.json();
      const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";
      setMessages(prev => [...prev, { id: Date.now(), text: aiText, sender: 'ai' }]);
    } catch (error) {
      console.error("Error:", error);
      setMessages(prev => [...prev, { id: Date.now(), text: "⚠️ Error connecting to AI.", sender: 'ai' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const newUserMessage: Message = { id: Date.now(), text, sender: 'user' };
    setMessages(prev => [...prev, newUserMessage]);
    setUserInput('');
    const languageName = SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage)?.name || 'English';
    const systemPrompt = `You are an expert AI assistant specializing in international trade, import, and export. Your name is 'Global Trade AI'. You provide clear, concise, and accurate information on topics like Incoterms, customs procedures, logistics, trade finance, and tariffs. Always be helpful and professional. Format your answers with markdown. CRITICAL: Your entire response MUST be in the following language: ${languageName}.`;
    const historyForApi = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Understood." }] },
      ...messages.slice(-6).map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }))
    ];
    callGeminiAPI(text, historyForApi);
  };

  const startEditing = (id: number, text: string) => {
    setEditingMessageId(id);
    setEditingText(text);
  };
  const saveEdit = (id: number) => {
    const updatedMessages = messages.map(msg =>
      msg.id === id ? { ...msg, text: editingText } : msg
    );
    setMessages(updatedMessages);
    setEditingMessageId(null);
    handleSendMessage(editingText);
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

  return (
    <div className={`background-container ${theme}`}>
      <div className="chat-container">
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
          {messages.map((msg) => (
            <div key={msg.id} className={`message-wrapper message-${msg.sender}`}>
              {editingMessageId === msg.id ? (
                <div>
                  <input value={editingText} onChange={(e) => setEditingText(e.target.value)} />
                  <button onClick={() => saveEdit(msg.id)}>✅</button>
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
                  {msg.sender === 'user' && <button onClick={() => startEditing(msg.id, msg.text)}>✏️</button>}
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

        <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(userInput); }} className="input-form">
          <button type="button" onClick={handleToggleListening} className={`mic-button ${isListening ? 'listening' : ''}`}>
            {isListening ? "🛑" : "🎤"}
          </button>
          <input value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="Type or speak..." className="text-input" />
          <button type="submit" className="send-button" disabled={!userInput.trim()}>➤</button>
        </form>
      </div>
    </div>
  );
}
