"use client";

import { VoiceProvider } from "@humeai/voice-react";
import ImmersiveEVI from "@/components/ImmersiveEVI";
import { useState, useEffect } from "react";

export default function Home() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchToken() {
      try {
        const response = await fetch("/api/hume-token");
        if (!response.ok) {
          throw new Error("Failed to get access token");
        }
        const data = await response.json();
        setAccessToken(data.accessToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
      } finally {
        setIsLoading(false);
      }
    }
    fetchToken();
  }, []);

  if (isLoading) {
    return (
      <main className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
          <p className="text-white/50 font-body text-sm">Initializing...</p>
        </div>
      </main>
    );
  }

  if (error || !accessToken) {
    return (
      <main className="h-screen w-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-4 glass-strong rounded-3xl p-12">
          <h1 className="text-2xl font-display font-medium text-white">Connection Error</h1>
          <p className="text-white/50 font-body">
            {error || "Unable to authenticate. Please try again."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <VoiceProvider
      auth={{ type: "accessToken", value: accessToken }}
      enableAudioWorklet={false}
      onInterruption={(msg) => {
        console.log("🔇 Interruption detected:", msg.type);
      }}
      onMessage={(msg) => {
        if (msg.type === "user_interruption") {
          console.log("🛑 user_interruption event - audio queue cleared by SDK");
        }
      }}
    >
      <ImmersiveEVI />
    </VoiceProvider>
  );
}
