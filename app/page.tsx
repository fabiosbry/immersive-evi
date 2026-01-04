"use client";

import { VoiceProvider } from "@humeai/voice-react";
import ImmersiveEVI from "@/components/ImmersiveEVI";

export default function Home() {
  return (
    <VoiceProvider
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
