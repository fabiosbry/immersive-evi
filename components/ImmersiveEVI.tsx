"use client";

import { useVoice, VoiceReadyState } from "@humeai/voice-react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, X, Volume2, VolumeX } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  emotions?: { name: string; score: number }[];
  timestamp: Date;
  hidden?: boolean;
}

// Keywords for instant detection
const PAUSE_KEYWORDS = ["hold on", "wait", "one second", "let me think", "give me a moment", "pause"];
const QUICK_KEYWORDS = ["quick", "brief", "short", "hurry", "rush", "fast"];
const DETAILED_KEYWORDS = ["detail", "explain", "more time", "elaborate", "in depth", "how does that work", "what do you mean"];
const INTERRUPT_KEYWORDS = ["interrupt me", "lost", "uhm uhm"];

export default function ImmersiveEVI() {
  const {
    connect,
    disconnect,
    readyState,
    messages,
    sendSessionSettings,
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const interruptCooldownRef = useRef<boolean>(false);
  const micUnmuteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isConnected = readyState === VoiceReadyState.OPEN;
  
  // Reset connecting state when connected
  useEffect(() => {
    if (isConnected) {
      setIsConnecting(false);
    }
  }, [isConnected]);

  // Process messages from Hume
  useEffect(() => {
    if (!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if (!("type" in lastMessage)) return;

    if (lastMessage.type === "user_interruption") {
      console.log("🛑 user_interruption - stopping audio immediately");
      muteAudio();
      setTimeout(() => unmuteAudio(), 100);
    }

    if (lastMessage.type === "user_message") {
      const content = (lastMessage as any).message?.content || "";
      const emotions = extractEmotions(lastMessage);
      
      setConversation((prev) => {
        const lastConv = prev[prev.length - 1];
        if (lastConv?.role === "user") {
          return [...prev.slice(0, -1), { ...lastConv, content, emotions }];
        }
        return [...prev, { role: "user", content, emotions, timestamp: new Date() }];
      });

      setCurrentEmotions(emotions);
      detectKeywords(content);
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
    }
  }, [messages]);

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

  function detectKeywords(text: string) {
    const lower = text.toLowerCase();

    if (!interruptCooldownRef.current) {
      for (const kw of INTERRUPT_KEYWORDS) {
        if (lower.includes(kw)) {
          triggerInterrupt(kw);
          return;
        }
      }
    }

    for (const kw of PAUSE_KEYWORDS) {
      if (lower.includes(kw) && !isPaused) {
        console.log(`⏸️ PAUSE keyword detected: "${kw}"`);
        triggerPause();
        return;
      }
    }

    for (const kw of QUICK_KEYWORDS) {
      if (lower.includes(kw) && mode !== "quick") {
        console.log(`⚡ QUICK mode activated (keyword: "${kw}")`);
        setMode("quick");
        sendSessionSettings({
          context: {
            text: "Keep responses very brief and concise. Answer in 1 short sentence, maximum 2 sentences.",
            type: "editable" as any,
          },
        });
        return;
      }
    }

    for (const kw of DETAILED_KEYWORDS) {
      if (lower.includes(kw) && mode !== "detailed") {
        console.log(`📚 DETAILED mode activated (keyword: "${kw}")`);
        setMode("detailed");
        sendSessionSettings({
          context: {
            text: "Provide thorough, detailed explanations. Take your time to explain concepts fully in 2-3 sentences.",
            type: "editable" as any,
          },
        });
        return;
      }
    }
  }
  
  function triggerInterrupt(keyword: string) {
    console.log(`🛑 INTERRUPT triggered (keyword: "${keyword}")`);
    interruptCooldownRef.current = true;
    mute();
    
    sendSessionSettings({
      context: {
        text: `SAY: "Sorry, uhm, quick thought..." or "Hold on, sorry uhm, I could I add..." then make your point. DO NOT SAY "OKAY I CAN INTERRUPT YOU" just jump in with the interruption.`,
        type: "temporary" as any,
      },
    });
    
    setTimeout(() => {
      unmute();
      setTimeout(() => {
        interruptCooldownRef.current = false;
      }, 1000);
    }, 6000);
  }
  
  function triggerPause() {
    console.log("⏸️ PAUSE triggered - muting EVI audio");
    muteAudio();
    mute();
    setIsPaused(true);
    
    if (micUnmuteTimeoutRef.current) clearTimeout(micUnmuteTimeoutRef.current);
    micUnmuteTimeoutRef.current = setTimeout(() => {
      console.log("🎤 Mic unmuted - waiting for user to speak...");
      unmute();
    }, 2000);
  }

  function handleResume() {
    console.log("▶️ RESUME triggered - unmuting EVI audio");
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
    if (isConnecting) return; // Prevent double-clicks
    setIsConnecting(true);
    try {
      // Fetch access token from our secure API route
      const response = await fetch("/api/hume-token");
      if (!response.ok) {
        throw new Error("Failed to get access token");
      }
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

  // Audio visualizer data
  const visualizerBars = isConnected ? (isMuted ? fft : micFft) : [];
  const normalizedBars = visualizerBars.slice(0, 32).map((v, i) => Math.max(0.15, v));

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Desktop background video - rotated 90° right */}
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
      
      {/* Mobile background video - portrait optimized, zoomed to fill */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="md:hidden absolute inset-0 w-full h-full object-cover z-0 scale-125"
      >
        <source src="/video-mobile.mp4" type="video/mp4" />
      </video>

      {/* Dark overlay gradient */}
      <div className="absolute inset-0 video-overlay z-[1]" />

      {/* Content layer */}
      <div className="relative z-10 h-full w-full flex flex-col">
        {/* Header - Branding */}
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

        {/* Center - Voice Interface */}
        <motion.div 
          className="flex-1 flex items-center justify-center px-4"
          animate={{ y: showTranscript ? -60 : 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
        >
          <AnimatePresence mode="wait">
            {!isConnected ? (
              /* Idle State - Start Button */
              <motion.div
                key="idle"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex flex-col items-center gap-8"
              >
                {/* Breathing button */}
                <motion.button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="relative group"
                  whileHover={!isConnecting ? { scale: 1.02 } : {}}
                  whileTap={!isConnecting ? { scale: 0.95 } : {}}
                  animate={isConnecting ? { scale: [1, 1.05, 1] } : {}}
                  transition={isConnecting ? { duration: 0.8, repeat: Infinity, ease: "easeInOut" } : {}}
                >
                  {/* Outer glow ring - spins when connecting */}
                  <motion.div 
                    className={`absolute inset-0 rounded-full ${isConnecting ? 'bg-white/10' : 'bg-white/5'}`}
                    animate={isConnecting ? { rotate: 360 } : {}}
                    transition={isConnecting ? { duration: 2, repeat: Infinity, ease: "linear" } : {}}
                  />
                  
                  {/* Spinning ring when connecting */}
                  {isConnecting && (
                    <motion.div
                      className="absolute inset-[-4px] rounded-full border-2 border-transparent border-t-white/40"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                  )}
                  
                  {/* Main button */}
                  <motion.div 
                    className={`relative glass-strong rounded-full p-6 md:p-8 glow-subtle ${!isConnecting ? 'breathe-pulse' : ''}`}
                    animate={isConnecting ? { opacity: [1, 0.7, 1] } : {}}
                    transition={isConnecting ? { duration: 1, repeat: Infinity } : {}}
                  >
                    <Mic className={`w-10 h-10 md:w-12 md:h-12 ${isConnecting ? 'text-white/60' : 'text-white'}`} strokeWidth={1.5} />
                  </motion.div>
                  
                  {/* Hover ring - only when not connecting */}
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
              /* Active State - Visualizer */
              <motion.div
                key="active"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="flex flex-col items-center gap-8"
              >
                {/* Listening visualizer container */}
                <div className="relative">
                  {/* Pulse rings */}
                  {isPlaying && (
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
                  
                  {/* Main visualizer orb */}
                  <motion.div 
                    className="glass-strong rounded-full p-6 md:p-10 glow-subtle relative overflow-hidden"
                    animate={isPlaying ? { scale: [1, 1.02, 1] } : {}}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  >
                    {/* Audio bars */}
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
                  </motion.div>
                </div>

                {/* Status text */}
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-white/50 font-body text-sm tracking-wide"
                >
                  {isMuted ? "Microphone muted" : isPlaying ? "Speaking..." : "Listening..."}
                </motion.p>

                {/* Control buttons */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="flex items-center gap-3 md:gap-4"
                >
                  {/* Mute toggle */}
                  <motion.button
                    onClick={() => isMuted ? unmute() : mute()}
                    className={`glass rounded-full p-3 md:p-4 transition-all ${
                      isMuted ? "bg-red-500/20 border-red-500/30" : "hover:bg-white/10"
                    }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {isMuted ? (
                      <MicOff className="w-4 h-4 md:w-5 md:h-5 text-red-400" strokeWidth={1.5} />
                    ) : (
                      <Mic className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={1.5} />
                    )}
                  </motion.button>

                  {/* Audio mute toggle */}
                  <motion.button
                    onClick={() => isAudioMuted ? unmuteAudio() : muteAudio()}
                    className={`glass rounded-full p-3 md:p-4 transition-all ${
                      isAudioMuted ? "bg-amber-500/20 border-amber-500/30" : "hover:bg-white/10"
                    }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {isAudioMuted ? (
                      <VolumeX className="w-4 h-4 md:w-5 md:h-5 text-amber-400" strokeWidth={1.5} />
                    ) : (
                      <Volume2 className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={1.5} />
                    )}
                  </motion.button>

                  {/* Disconnect */}
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

        {/* Transcript toggle button */}
        {isConnected && conversation.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setShowTranscript(!showTranscript)}
            className="absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 glass rounded-full px-4 md:px-6 py-2 md:py-3 text-[10px] md:text-xs text-white/60 hover:text-white/80 hover:bg-white/10 transition font-body uppercase tracking-wider"
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </motion.button>
        )}

        {/* Floating transcript panel */}
        <AnimatePresence>
          {showTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-14 md:bottom-20 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-lg"
            >
              <div className="glass-strong rounded-2xl md:rounded-3xl p-3 md:p-6 max-h-40 md:max-h-64 overflow-y-auto">
                <div className="space-y-2 md:space-y-3">
                  {conversation.filter(m => !m.hidden).map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] px-3 md:px-4 py-1.5 md:py-2 rounded-xl md:rounded-2xl ${
                          msg.role === "user"
                            ? "bg-white/20 text-white"
                            : "bg-white/5 text-white/80"
                        }`}
                      >
                        <p className="text-xs md:text-sm font-body leading-relaxed">{msg.content}</p>
                      </div>
                    </motion.div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error display */}
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

        {/* Emotion indicators - hidden on mobile when transcript is open */}
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
      </div>
    </main>
  );
}

