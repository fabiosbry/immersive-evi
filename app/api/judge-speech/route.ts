import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const JUDGE_SYSTEM_PROMPT = `You analyze user speech to decide if the AI should interrupt.

Output JSON: {"interrupt": true/false, "reason": "brief reason", "message": "string or null"}

INTERRUPT when:
- 4+ fillers (um, uh, like, you know)
- User sounds confused or lost
- 30+ words rambling without clear point
- User asks to be interrupted
- User uses keywords "yesterday", "anxious", "lost"

DO NOT interrupt if user is speaking normally or asking a clear question.

CRITICAL: When interrupt is true, the "message" field MUST be a string that starts EXACTLY with these words: "Sorry to interrupt, but" followed by a brief helpful & smart question (under 20 words total). The question should fit the context of the conversation and be helpful to the user, eg help him focus, help him reflect, etc.

Example outputs:
{"interrupt": true, "reason": "rambling", "message": "Sorry to interrupt, but what's the main thing you're trying to figure out?"}
{"interrupt": false, "reason": "speaking normally", "message": null}`;

export async function POST(request: NextRequest) {
  const groqApiKey = process.env.GROQ_API_KEY;

  if (!groqApiKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { speech, conversationHistory = [], speakingTime = 0 } = body;

    if (!speech || typeof speech !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'speech' field" },
        { status: 400 }
      );
    }

    // Calculate stats
    const wordCount = speech.split(/\s+/).filter(Boolean).length;
    const speechLower = speech.toLowerCase();
    const fillerCount = ["um", "uh", "like", "you know", "i don't know", "i'm not sure"]
      .reduce((count, filler) => {
        const regex = new RegExp(filler, "gi");
        return count + (speechLower.match(regex) || []).length;
      }, 0);

    // Format conversation history
    const historyText = conversationHistory
      .slice(-4)
      .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const prompt = `Recent conversation:
${historyText || "No prior context"}

USER IS CURRENTLY SAYING: "${speech}"

Stats: ${speakingTime.toFixed(1)}s speaking, ${wordCount} words, ${fillerCount} filler words detected.

Should the AI interrupt? Respond with JSON only.`;

    const groq = new Groq({ apiKey: groqApiKey });

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content?.trim() || "";
    
    // Parse JSON response
    let result = { interrupt: false, reason: "", message: null as string | null };
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse LLM response:", content);
    }

    // Ensure interrupt message starts correctly
    let finalMessage = result.message;
    if (result.interrupt && finalMessage) {
      // Fix message if it doesn't start with "Sorry to interrupt"
      if (!finalMessage.toLowerCase().startsWith("sorry to interrupt")) {
        finalMessage = "Sorry to interrupt, but " + finalMessage;
      }
      console.log("🛑 INTERRUPT MESSAGE:", finalMessage);
    }

    return NextResponse.json({
      interrupt: result.interrupt === true,
      reason: result.reason || "",
      message: finalMessage,
      stats: { wordCount, fillerCount, speakingTime },
    });
  } catch (error) {
    console.error("Judge speech error:", error);
    return NextResponse.json(
      { error: "Failed to analyze speech" },
      { status: 500 }
    );
  }
}

