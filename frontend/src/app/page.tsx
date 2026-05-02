"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Paperclip, Send, Loader2, FileText, Plus, MessageSquare, Settings, User, Search, ChevronDown, CheckCircle2 } from "lucide-react";

// Define our strict types
type Message = { role: "user" | "ai"; text: string; sources?: {page: string, text: string}[] };
type Session = { id: string; title: string; timestamp: number; messages: Message[] };

export default function ChatUI() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  // --- NEW: Session Management State ---
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 1. On Mount: Load saved sessions from browser local storage
  useEffect(() => {
    const savedSessions = localStorage.getItem("contextcore_sessions");
    if (savedSessions) {
      setSessions(JSON.parse(savedSessions));
    }
  }, []);

  // 2. Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // --- HELPER: Update a session in state and local storage ---
  const saveSession = (id: string, title: string, updatedMessages: Message[]) => {
    setSessions((prev) => {
      const existing = prev.find(s => s.id === id);
      let newSessions;
      
      if (existing) {
        newSessions = prev.map(s => s.id === id ? { ...s, messages: updatedMessages, timestamp: Date.now() } : s);
      } else {
        newSessions = [{ id, title, timestamp: Date.now(), messages: updatedMessages }, ...prev];
      }
      
      localStorage.setItem("contextcore_sessions", JSON.stringify(newSessions));
      return newSessions;
    });
  };

  // --- MAIN CHAT PIPELINE ---
  const askQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    const userMsg: Message = { role: "user", text: query };
    const currentHistory = [...messages];
    const newMessages = [...messages, userMsg];
    
    setMessages(newMessages);
    setQuery("");
    setIsLoading(true);

    // Handle Session Creation/Updating
    let activeId = currentSessionId;
    let activeTitle = "New Workspace";
    
    if (!activeId) {
      activeId = Date.now().toString();
      setCurrentSessionId(activeId);
      activeTitle = query.split(" ").slice(0, 4).join(" ") + "..."; // Auto-generate title
    } else {
      activeTitle = sessions.find(s => s.id === activeId)?.title || activeTitle;
    }

    // Save immediately so user sees their message
    saveSession(activeId, activeTitle, newMessages);

    try {
      const res = await fetch("http://127.0.0.1:8000/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userMsg.text, chat_history: currentHistory }), 
      });

      if (!res.ok) throw new Error("Backend connection failed");
      const data = await res.json();

      const aiMsg: Message = { role: "ai", text: data.answer, sources: data.sources };
      const finalMessages = [...newMessages, aiMsg];
      
      setMessages(finalMessages);
      saveSession(activeId, activeTitle, finalMessages); // Save AI response

    } catch (error: any) {
      const errorMsg: Message = { role: "ai", text: `**System Error:** ${error.message || "Could not reach the ContextCore Engine."}` };
      const finalMessages = [...newMessages, errorMsg];
      setMessages(finalMessages);
      saveSession(activeId, activeTitle, finalMessages);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }

    try {
      const res = await fetch("http://127.0.0.1:8000/upload", {
        method: "POST",
        body: formData,
      });
      
      const data = await res.json();
      if (res.ok) {
        const fileNames = Array.from(files).map(f => `\`${f.name}\``).join(", ");
        const sysMsg: Message = { role: "ai", text: `✅ **System Update:** Successfully memorized ${files.length} document(s):\n${fileNames}.` };
        
        const newMessages = [...messages, sysMsg];
        setMessages(newMessages);

        // If we are in an active session, save this system message to it
        if (currentSessionId) {
          const activeTitle = sessions.find(s => s.id === currentSessionId)?.title || "Workspace";
          saveSession(currentSessionId, activeTitle, newMessages);
        }

      } else {
        throw new Error(data.error || "Upload failed");
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: "ai", text: `❌ **Upload Error:** ${error.message}` }]);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = ""; 
    }
  };

  // --- ACTIONS ---
  const startNewSession = () => {
    setMessages([]);
    setCurrentSessionId(null);
  };

  const loadSession = (session: Session) => {
    setMessages(session.messages);
    setCurrentSessionId(session.id);
  };

  // --- TIME CATEGORIZATION LOGIC ---
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  
  const todaySessions = sessions.filter(s => (now - s.timestamp) < oneDay);
  const previousSessions = sessions.filter(s => (now - s.timestamp) >= oneDay && (now - s.timestamp) < 7 * oneDay);

  return (
    <div className="flex h-screen bg-[#212121] text-gray-100 font-sans overflow-hidden selection:bg-blue-500/30">
      
      {/* --- PROFESSIONAL SIDEBAR --- */}
      <aside className="w-[280px] bg-[#171717] flex-col hidden md:flex border-r border-gray-800 flex-shrink-0">
        
        <div className="p-4 border-b border-gray-800">
          <button 
            onClick={startNewSession}
            className="flex items-center justify-between w-full hover:bg-[#2f2f2f] transition-colors p-3 rounded-xl text-sm font-semibold text-gray-200 border border-gray-700/50 shadow-sm"
          >
            <div className="flex items-center gap-2"><Plus size={18} /> New Workspace</div>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* Dynamic Today Group */}
          {todaySessions.length > 0 && (
            <div>
              <div className="text-xs font-bold text-gray-500 mb-3 px-2 uppercase tracking-wider">Today</div>
              <div className="flex flex-col gap-1">
                {todaySessions.map(session => (
                  <button 
                    key={session.id}
                    onClick={() => loadSession(session)}
                    className={`flex items-center gap-3 text-sm p-2.5 rounded-lg w-full text-left truncate transition-colors ${
                      currentSessionId === session.id ? "bg-[#2f2f2f] text-gray-200" : "text-gray-400 hover:bg-[#212121]"
                    }`}
                  >
                    <MessageSquare size={16} className={currentSessionId === session.id ? "text-blue-400 flex-shrink-0" : "flex-shrink-0"}/>
                    <span className="truncate font-medium">{session.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Dynamic Previous 7 Days Group */}
          {previousSessions.length > 0 && (
            <div>
              <div className="text-xs font-bold text-gray-500 mb-3 px-2 uppercase tracking-wider">Previous 7 Days</div>
              <div className="flex flex-col gap-1">
                {previousSessions.map(session => (
                  <button 
                    key={session.id}
                    onClick={() => loadSession(session)}
                    className={`flex items-center gap-3 text-sm p-2.5 rounded-lg w-full text-left truncate transition-colors ${
                      currentSessionId === session.id ? "bg-[#2f2f2f] text-gray-200" : "text-gray-400 hover:bg-[#212121]"
                    }`}
                  >
                    <MessageSquare size={16} className={currentSessionId === session.id ? "text-blue-400 flex-shrink-0" : "flex-shrink-0"}/>
                    <span className="truncate">{session.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {sessions.length === 0 && (
            <div className="text-xs text-gray-500 px-2 text-center mt-10">
              No recent workspaces.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-800 bg-[#171717]">
          <button className="flex items-center gap-3 text-sm text-gray-300 hover:bg-[#2f2f2f] p-3 rounded-xl w-full text-left transition-colors mb-1">
            <Settings size={18} /> Settings
          </button>
          <button className="flex items-center justify-between text-sm text-gray-300 hover:bg-[#2f2f2f] p-3 rounded-xl w-full text-left transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 bg-gradient-to-tr from-blue-600 to-emerald-500 rounded-full flex items-center justify-center shadow-md">
                <User size={14} className="text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-medium text-gray-200">Admin User</span>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10}/> Local Engine Online</span>
              </div>
            </div>
          </button>
        </div>
      </aside>

      {/* --- MAIN CHAT AREA --- */}
      <main className="flex-1 flex flex-col h-full relative bg-[#212121]">
        
        <header className="md:hidden flex items-center justify-between p-4 border-b border-gray-800 bg-[#171717]">
          <h1 className="text-lg font-bold text-gray-200">ContextCore</h1>
          <button onClick={startNewSession} className="p-2 bg-blue-600 rounded-lg text-white"><Plus size={18}/></button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto mt-10">
              <div className="w-24 h-24 bg-gradient-to-br from-blue-900/40 to-emerald-900/20 rounded-3xl flex items-center justify-center mb-8 shadow-2xl border border-gray-700/50">
                <FileText className="text-blue-400 w-12 h-12" />
              </div>
              <h2 className="text-3xl font-bold mb-4 tracking-tight text-gray-100">ContextCore 1.0</h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-8">
               A private, local AI workspace powered by Retrieval-Augmented Generation (RAG). Upload your documents to initialize the vector database and query your data.
              </p>
            </div>
          ) : (
            <div className="space-y-8 max-w-3xl mx-auto pb-6">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} max-w-[90%]`}>
                    
                    <div className={`px-6 py-5 rounded-3xl shadow-sm ${
                      msg.role === "user" 
                        ? "bg-[#2f2f2f] text-gray-100 rounded-br-sm" 
                        : "bg-transparent text-gray-100 border border-gray-800 bg-[#1e1e1e]/50 rounded-bl-sm"
                    }`}>
                      <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-[#171717] prose-pre:border prose-pre:border-gray-800">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-6 border-t border-gray-700/50 pt-4">
                          <details className="group">
                            <summary className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-400 hover:text-blue-400 transition-colors list-none select-none">
                              <Search size={14} />
                              View Source Evidence ({msg.sources.length} chunk matches)
                              <ChevronDown size={14} className="group-open:rotate-180 transition-transform ml-1" />
                            </summary>
                            
                            <div className="mt-4 space-y-3 pl-3 border-l-2 border-blue-500/30">
                              {msg.sources.map((src, sIdx) => (
                                <div key={sIdx} className="bg-[#171717] rounded-xl p-4 border border-gray-800 shadow-inner">
                                  <span className="block font-bold text-blue-400 mb-2 border-b border-gray-800 pb-2 text-[11px] uppercase tracking-wider">
                                    Document Page {src.page}
                                  </span>
                                  <p className="whitespace-pre-wrap leading-relaxed text-xs text-gray-400 font-mono">
                                    {src.text}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex justify-start px-6 py-5 items-center gap-4 text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                  <span className="text-sm font-medium animate-pulse">Running semantic search...</span>
                </div>
              )}
              <div ref={chatEndRef} className="h-4" />
            </div>
          )}
        </div>

        <div className="w-full p-4 bg-gradient-to-t from-[#212121] via-[#212121] to-transparent shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="bg-[#2f2f2f] border border-gray-700 focus-within:border-gray-500 focus-within:ring-1 focus-within:ring-gray-500 rounded-2xl p-2 flex items-end gap-2 shadow-2xl transition-all">
              
              <input type="file" accept=".pdf" multiple className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
              <button 
                type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading || isLoading}
                className="p-3 text-gray-400 hover:text-gray-200 hover:bg-[#3f3f3f] rounded-xl transition-colors disabled:opacity-50"
              >
                {isUploading ? <Loader2 className="w-5 h-5 animate-spin text-blue-400" /> : <Paperclip className="w-5 h-5" />}
              </button>

              <textarea
                className="flex-1 max-h-48 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none py-3 px-2 text-gray-100 placeholder-gray-500 outline-none"
                placeholder="Ask anything about your documents..." 
                rows={1} value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askQuestion(); } }}
                disabled={isLoading || isUploading}
              />

              <button
                onClick={askQuestion} disabled={!query.trim() || isLoading || isUploading}
                className="p-3 bg-white text-black hover:bg-gray-200 disabled:bg-[#3f3f3f] disabled:text-gray-500 rounded-xl transition-colors font-bold shadow-md"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}