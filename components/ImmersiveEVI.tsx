"use client";

import { useVoice, VoiceReadyState } from "@humeai/voice-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  emotions?: { name: string; score: number }[];
  timestamp: Date;
  hidden?: boolean;
  isInterrupt?: boolean;
}

// Keywords for PAUSE, QUICK, DETAILED modes only (NOT for interrupt)
const PAUSE_KEYWORDS = ["hold on", "wait", "one second", "let me think", "give me a moment", "pause"];
const QUICK_KEYWORDS = ["quick", "brief", "short", "hurry", "rush", "fast"];
const DETAILED_KEYWORDS = ["detail", "explain", "more time", "elaborate", "in depth", "how does that work", "what do you mean"];

// LLM Judge configuration
const JUDGE_DEBOUNCE_MS = 400;
const MIN_WORDS_FOR_JUDGE = 8;
const MIN_SPEAKING_TIME_S = 1.5;

export default function ImmersiveEVI() {
  const {
    connect,
    disconnect,
    readyState,
    messages,
    sendSessionSettings,
    sendAssistantInput,
    pauseAssistant,
    resumeAssistant,
    isMuted,
    mute,
    unmute,
    isAudioMuted,
    muteAudio,
    unmuteAudio,
    status,
    error,
    micFft,
    fft,
    isPlaying,
    playerQueueLength,
  } = useVoice();

  const [conversation, setConversation] = useState<Message[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [mode, setMode] = useState<"normal" | "quick" | "detailed">("normal");
  const [currentEmotions, setCurrentEmotions] = useState<{ name: string; score: number }[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showHeadphoneTip, setShowHeadphoneTip] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const micUnmuteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // LLM Judge state
  const chatIdRef = useRef<string | null>(null);
  const turnStartTimeRef = useRef<number>(0);
  const lastJudgeTimeRef = useRef<number>(0);
  const judgeAbortControllerRef = useRef<AbortController | null>(null);
  const conversationHistoryRef = useRef<{ role: string; content: string }[]>([]);
  const interruptCooldownRef = useRef<boolean>(false);

  const isConnected = readyState === VoiceReadyState.OPEN;
  
  useEffect(() => {
    if (isConnected) {
      setIsConnecting(false);
      if (window.innerWidth < 768) {
        setShowHeadphoneTip(true);
        setTimeout(() => setShowHeadphoneTip(false), 5000);
      }
    }
  }, [isConnected]);

  // Track isInterrupting in a ref to avoid useEffect dependency issues
  const isInterruptingRef = useRef(false);
  useEffect(() => {
    isInterruptingRef.current = isInterrupting;
  }, [isInterrupting]);

  // LLM Judge for INTERRUPT detection
  const callLLMJudge = useCallback(async (speech: string) => {
    if (interruptCooldownRef.current || isInterruptingRef.current) return;
    
    const wordCount = speech.split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS_FOR_JUDGE) return;
    
    const speakingTime = (Date.now() - turnStartTimeRef.current) / 1000;
    if (speakingTime < MIN_SPEAKING_TIME_S) return;
    
    // Debounce
    const now = Date.now();
    if (now - lastJudgeTimeRef.current < JUDGE_DEBOUNCE_MS) return;
    lastJudgeTimeRef.current = now;
    
    // Cancel pending request
    if (judgeAbortControllerRef.current) {
      judgeAbortControllerRef.current.abort();
    }
    judgeAbortControllerRef.current = new AbortController();
    
    try {
      const response = await fetch("/api/judge-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speech,
          conversationHistory: conversationHistoryRef.current.slice(-4),
          speakingTime,
        }),
        signal: judgeAbortControllerRef.current.signal,
      });
      
      if (!response.ok) return;
      
      const { interrupt, message, reason, stats } = await response.json();
      console.log(`🤖 LLM Judge: ${interrupt ? "INTERRUPT" : "continue"}`, { reason, stats });
      
      if (interrupt && message && chatIdRef.current) {
        triggerInterrupt(message);
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.warn("LLM Judge error:", error);
      }
    }
  }, []);

  // Trigger interrupt with LLM-generated message  
  async function triggerInterrupt(message: string) {
    if (!chatIdRef.current || isInterruptingRef.current) return;
    
    console.log("🛑 INTERRUPT triggered");
    console.log("📢 Message:", message);
    
    interruptCooldownRef.current = true;
    isInterruptingRef.current = true;
    setIsInterrupting(true);
    
    // 1. Mute user IMMEDIATELY to stop audio going to EVI
    mute();
    console.log("🔇 User muted");
    
    // 2. PAUSE assistant to CANCEL its pending response
    pauseAssistant();
    console.log("⏸️ Assistant paused (canceling EVI response)");
    
    // 3. Small delay to ensure pause takes effect
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // 4. Send our message via REST API (assistant_input bypasses pause)
    try {
      const response = await fetch("/api/send-assistant-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chatIdRef.current,
          text: message,
        }),
      });
      if (response.ok) {
        console.log("✅ assistant_input sent");
      } else {
        console.warn("REST API failed:", response.status);
      }
    } catch (err) {
      console.error("REST API error:", err);
    }
    
    // 5. Add to conversation history (regardless of API response)
    conversationHistoryRef.current.push({ role: "assistant", content: message });
    setConversation((prev) => [
      ...prev,
      { role: "assistant", content: message, timestamp: new Date(), isInterrupt: true }
    ]);
    
    // 6. Resume assistant AFTER the await (100ms delay)
    setTimeout(() => {
      resumeAssistant();
      console.log("▶️ Assistant resumed");
    }, 100);
    
    // 7. Unmute user after 4s
    setTimeout(() => {
      unmute();
      isInterruptingRef.current = false;
      setIsInterrupting(false);
      console.log("🔊 User unmuted");
      
      // 8. Cooldown: prevent interrupts for 8s after this one
      setTimeout(() => {
        interruptCooldownRef.current = false;
        console.log("✓ Interrupt cooldown ended");
      }, 8000);
    }, 4000);
  }

  // Process messages from Hume
  useEffect(() => {
    if (!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if (!("type" in lastMessage)) return;

    // Capture chat ID
    if (lastMessage.type === "chat_metadata") {
      const chatId = (lastMessage as any).chatId;
      if (chatId) {
        chatIdRef.current = chatId;
        console.log("📝 Chat ID:", chatId.slice(0, 8) + "...");
      }
    }

    if (lastMessage.type === "user_interruption") {
      console.log("🛑 user_interruption");
      muteAudio();
      setTimeout(() => unmuteAudio(), 100);
    }

    if (lastMessage.type === "user_message") {
      const content = (lastMessage as any).message?.content || "";
      const emotions = extractEmotions(lastMessage);
      const isInterim = (lastMessage as any).interim === true;
      
      // Track turn start
      if (isInterim && turnStartTimeRef.current === 0) {
        turnStartTimeRef.current = Date.now();
        console.log("🎤 User speaking...");
      }
      
      setConversation((prev) => {
        const lastConv = prev[prev.length - 1];
        if (lastConv?.role === "user") {
          return [...prev.slice(0, -1), { ...lastConv, content, emotions }];
        }
        return [...prev, { role: "user", content, emotions, timestamp: new Date() }];
      });

      setCurrentEmotions(emotions);
      
      // Keyword detection for modes (NOT interrupt)
      detectKeywords(content);
      
      // LLM Judge for interrupt (on interim messages)
      if (isInterim && !isInterruptingRef.current) {
        callLLMJudge(content);
      }
      
      // Final message - track history
      if (!isInterim && content) {
        conversationHistoryRef.current.push({ role: "user", content });
        turnStartTimeRef.current = 0;
      }
    }

    if (lastMessage.type === "assistant_message") {
      const content = (lastMessage as any).message?.content || "";
      
      setConversation((prev) => {
        const lastConv = prev[prev.length - 1];
        if (lastConv?.role === "assistant" && !lastConv.hidden) {
          return [...prev.slice(0, -1), { ...lastConv, content: lastConv.content + " " + content, hidden: isPaused ? true : lastConv.hidden }];
        }
        return [...prev, { role: "assistant", content, timestamp: new Date(), hidden: isPaused }];
      });
      
      // Track history
      if (content) {
        const lastHistory = conversationHistoryRef.current[conversationHistoryRef.current.length - 1];
        if (lastHistory?.role === "assistant") {
          lastHistory.content += " " + content;
        } else {
          conversationHistoryRef.current.push({ role: "assistant", content });
        }
      }
    }
  }, [messages, callLLMJudge, isPaused]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  function extractEmotions(msg: any): { name: string; score: number }[] {
    try {
      const prosody = msg.models?.prosody?.scores;
      if (!prosody) return [];
      
      return Object.entries(prosody)
        .map(([name, score]) => ({ name, score: score as number }))
        .filter((e) => e.score > 0.1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  // Keyword detection for PAUSE, QUICK, DETAILED only
  function detectKeywords(text: string) {
    const lower = text.toLowerCase();

    for (const kw of PAUSE_KEYWORDS) {
      if (lower.includes(kw) && !isPaused) {
        console.log(`⏸️ PAUSE: "${kw}"`);
        triggerPause();
        return;
      }
    }

    for (const kw of QUICK_KEYWORDS) {
      if (lower.includes(kw) && mode !== "quick") {
        console.log(`⚡ QUICK mode: "${kw}"`);
        setMode("quick");
        sendSessionSettings({
          context: {
            text: "Keep responses very brief and concise. Answer in 1 brief sentence only.",
            type: "editable" as any,
          },
        });
        return;
      }
    }

    for (const kw of DETAILED_KEYWORDS) {
      if (lower.includes(kw) && mode !== "detailed") {
        console.log(`📚 DETAILED mode: "${kw}"`);
        setMode("detailed");
        sendSessionSettings({
          context: {
            text: "Detailed mode: Answer in two sentences and include a quick example.",
            type: "editable" as any,
          },
        });
        return;
      }
    }
  }
  
  function triggerPause() {
    // Don't pause if we're in interrupt mode
    if (isInterruptingRef.current) return;
    
    muteAudio();
    mute();
    setIsPaused(true);
    
    if (micUnmuteTimeoutRef.current) clearTimeout(micUnmuteTimeoutRef.current);
    micUnmuteTimeoutRef.current = setTimeout(() => {
      // Only unmute if not interrupting
      if (!isInterruptingRef.current) {
        unmute();
      }
    }, 2000);
  }

  function handleResume() {
    // Don't resume if we're in interrupt mode
    if (isInterruptingRef.current) return;
    
    if (micUnmuteTimeoutRef.current) clearTimeout(micUnmuteTimeoutRef.current);
    unmuteAudio();
    unmute();
    setIsPaused(false);
  }
  
  useEffect(() => {
    if (!isPaused || isMuted) return;
    if (!messages.length) return;
    
    const lastMessage = messages[messages.length - 1];
    if (!("type" in lastMessage)) return;
    
    if (lastMessage.type === "user_message") {
      const content = (lastMessage as any).message?.content || "";
      const isPausePhrase = PAUSE_KEYWORDS.some(kw => content.toLowerCase().includes(kw));
      if (!isPausePhrase && content.length > 3) {
        handleResume();
      }
    }
  }, [messages, isPaused, isMuted]);

  async function handleConnect() {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const response = await fetch("/api/hume-token");
      if (!response.ok) throw new Error("Failed to get access token");
      const { accessToken } = await response.json();
      
      const configId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID;
      await connect({
        auth: { type: "accessToken", value: accessToken },
        ...(configId && { configId }),
      });
    } catch (e) {
      console.error("Connection error:", e);
      setIsConnecting(false);
    }
  }

  const visualizerBars = isConnected && !isPaused ? (isMuted ? fft : micFft) : [];
  const normalizedBars = visualizerBars.slice(0, 32).map((v, i) => Math.max(0.15, v));

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Desktop background video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="hidden md:block absolute inset-0 w-[100vh] h-[100vw] object-cover z-0 rotate-90 origin-center translate-x-[calc(50vw-50vh)]"
        style={{
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%) rotate(90deg)',
          minWidth: '100vh',
          minHeight: '100vw',
        }}
      >
        <source src="/video.mov" type="video/mp4" />
      </video>
      
      {/* Mobile background video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="md:hidden absolute inset-0 w-full h-full object-cover z-0 scale-110"
      >
        <source src="/video-mobile.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 video-overlay z-[1]" />

      <div className="relative z-10 h-full w-full flex flex-col">
        <header className="absolute top-0 left-0 right-0 pt-12 md:pt-8 px-4 md:px-8 pb-4 flex items-center justify-between">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex items-center gap-2 md:gap-4"
          >
            <h1 className="text-lg md:text-2xl font-display font-semibold tracking-tight text-white">
              peoplemakethings
            </h1>
            {isConnected && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-white/50 font-body uppercase tracking-wider">Live</span>
              </motion.div>
            )}
          </motion.div>
        </header>

        <motion.div 
          className="flex-1 flex items-center justify-center px-4"
          animate={{ y: showTranscript ? -60 : 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
        >
          <AnimatePresence mode="wait">
            {!isConnected ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex flex-col items-center gap-8"
              >
                <motion.button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="relative group"
                  whileHover={!isConnecting ? { scale: 1.02 } : {}}
                  whileTap={!isConnecting ? { scale: 0.95 } : {}}
                  animate={isConnecting ? { scale: [1, 1.05, 1] } : {}}
                  transition={isConnecting ? { duration: 0.8, repeat: Infinity, ease: "easeInOut" } : {}}
                >
                  <motion.div 
                    className={`absolute inset-0 rounded-full ${isConnecting ? 'bg-white/10' : 'bg-white/5'}`}
                    animate={isConnecting ? { rotate: 360 } : {}}
                    transition={isConnecting ? { duration: 2, repeat: Infinity, ease: "linear" } : {}}
                  />
                  
                  {isConnecting && (
                    <motion.div
                      className="absolute inset-[-4px] rounded-full border-2 border-transparent border-t-white/40"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                  )}
                  
                  <motion.div 
                    className={`relative glass-strong rounded-full p-6 md:p-8 glow-subtle ${!isConnecting ? 'breathe-pulse' : ''}`}
                    animate={isConnecting ? { opacity: [1, 0.7, 1] } : {}}
                    transition={isConnecting ? { duration: 1, repeat: Infinity } : {}}
                  >
                    <Mic className={`w-10 h-10 md:w-12 md:h-12 ${isConnecting ? 'text-white/60' : 'text-white'}`} strokeWidth={1.5} />
                  </motion.div>
                  
                  {!isConnecting && (
                    <motion.div 
                      className="absolute inset-0 rounded-full border border-white/20"
                      initial={{ scale: 1, opacity: 0 }}
                      whileHover={{ scale: 1.1, opacity: 1 }}
                      transition={{ duration: 0.3 }}
                    />
                  )}
                </motion.button>

                <motion.p 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-white/40 font-body text-sm tracking-wide"
                >
                  {isConnecting ? "Connecting..." : "Tap to start conversation"}
                </motion.p>
              </motion.div>
            ) : (
              <motion.div
                key="active"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="flex flex-col items-center gap-8"
              >
                <div className="relative">
                  {isPlaying && !isPaused && (
                    <>
                      <motion.div
                        className="absolute inset-0 rounded-full border border-white/20"
                        animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                      />
                      <motion.div
                        className="absolute inset-0 rounded-full border border-white/10"
                        animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                        transition={{ duration: 2, delay: 0.5, repeat: Infinity, ease: "easeOut" }}
                      />
                    </>
                  )}
                  
                  <motion.div 
                    className="glass-strong rounded-full p-6 md:p-10 glow-subtle relative overflow-hidden"
                    animate={isPlaying && !isPaused ? { scale: [1, 1.02, 1] } : {}}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  >
                    {isPaused ? (
                      <div className="flex items-center justify-center h-12 w-24 md:h-16 md:w-32">
                        <span className="text-white/60 text-sm md:text-base font-body">waiting...</span>
                      </div>
                    ) : isInterrupting ? (
                      <div className="flex items-center justify-center h-12 w-24 md:h-16 md:w-32">
                        <span className="text-white/60 text-sm md:text-base font-body">interrupting...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-[2px] md:gap-[3px] h-12 w-24 md:h-16 md:w-32">
                        {normalizedBars.map((value, i) => (
                          <motion.div
                            key={i}
                            className="w-1 rounded-full bg-white/80"
                            animate={{ 
                              height: `${Math.max(8, value * 64)}px`,
                              opacity: 0.4 + value * 0.6
                            }}
                            transition={{ duration: 0.05, ease: "easeOut" }}
                          />
                        ))}
                      </div>
                    )}
                  </motion.div>
                </div>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <motion.button
                    onClick={() => disconnect()}
                    className="glass rounded-full p-3 md:p-4 hover:bg-white/10 transition-all"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <X className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={1.5} />
                  </motion.button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {isConnected && conversation.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setShowTranscript(!showTranscript)}
            className="hidden md:block absolute bottom-8 left-1/2 -translate-x-1/2 glass rounded-full px-6 py-3 text-xs text-white/60 hover:text-white/80 hover:bg-white/10 transition font-body uppercase tracking-wider"
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </motion.button>
        )}

        <AnimatePresence>
          {showTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="hidden md:block absolute bottom-20 left-1/2 -translate-x-1/2 w-full max-w-lg"
            >
              <div className="glass-strong rounded-3xl p-6 max-h-64 overflow-y-auto">
                <div className="space-y-3">
                  {conversation.filter(m => !m.hidden).map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                          msg.role === "user"
                            ? "bg-white/20 text-white"
                            : "bg-white/5 text-white/80"
                        }`}
                      >
                        <p className="text-sm font-body leading-relaxed">{msg.content}</p>
                      </div>
                    </motion.div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-24 left-1/2 -translate-x-1/2 glass rounded-2xl px-6 py-3 border-red-500/20 text-red-400 text-sm font-body"
            >
              {error.message}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {currentEmotions.length > 0 && isConnected && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className={`absolute right-4 md:right-8 top-20 md:top-1/2 md:-translate-y-1/2 ${showTranscript ? 'hidden md:block' : ''}`}
            >
              <div className="glass rounded-xl md:rounded-2xl p-3 md:p-4 space-y-2 md:space-y-3">
                <p className="text-[10px] md:text-xs text-white/40 font-body uppercase tracking-wider">Emotions</p>
                {currentEmotions.slice(0, 2).map((emotion) => (
                  <div key={emotion.name} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 md:gap-4">
                      <span className="text-[10px] md:text-xs text-white/60 font-body capitalize truncate max-w-[60px] md:max-w-none">
                        {emotion.name.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] md:text-xs text-white/40 font-body">
                        {Math.round(emotion.score * 100)}%
                      </span>
                    </div>
                    <div className="w-16 md:w-24 h-1 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${emotion.score * 100}%` }}
                        className="h-full bg-white/50 rounded-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showHeadphoneTip && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="md:hidden absolute top-24 left-4 right-4"
            >
              <div 
                className="glass rounded-xl px-4 py-3 text-center cursor-pointer"
                onClick={() => setShowHeadphoneTip(false)}
              >
                <p className="text-white/70 text-xs font-body">
                  🎧 Use headphones for best experience
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
