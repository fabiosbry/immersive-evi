import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const JUDGE_SYSTEM_PROMPT = `Analyze user speech. Output ONE of: INTERRUPT, PAUSE, QUICK, DETAILED, or CONTINUE.

INTERRUPT - user needs help NOW:
- Heavy fillers (4+ "um", "uh", "like", "you know")
- Confusion: "I'm lost", "I don't know what I'm doing"
- Wrong path: From the context it is clear that the goal is a but the user talks about b or makes no progress towards a.
- Repetition: same idea 3+ times, heavy stuttering
- Long rambling: 30+ words without clear point
- Explicit: "interrupt me", "stop me", "help me"

PAUSE - user explicitly wants time to think:
- "let me think", "give me a moment", "hold on"
- "one second", "let me figure this out"

QUICK - user is in a rush (set verbosity):
- "I'm in a hurry", "make it quick", "short answer please"
- "I don't have much time", "be brief", "keep it short"
- "just the basics", "quick summary", "tldr"

DETAILED - user needs more explanation (set verbosity):
- "I don't understand", "explain more", "can you elaborate"
- "what do you mean", "I'm confused", "break it down"
- "slower please", "step by step", "more detail"

CONTINUE - normal conversation (default)

Output ONLY one word: INTERRUPT, PAUSE, QUICK, DETAILED, or CONTINUE`;

const INTERRUPT_RESPONSE_PROMPT = `You are a helpful voice assistant. The user seems to be struggling, confused, or rambling. 
Generate a brief, empathetic interruption to help them.

Rules:
- Start naturally with something like "Hey," or "Sorry to jump in," or "Let me help—"
- Keep it to 1-2 short sentences max (under 25 words total)
- Be warm and supportive, not condescending
- If they seem confused, offer to clarify or simplify
- If they're rambling, gently redirect to the main point
- Sound natural and conversational, like a helpful friend

Examples:
- "Hey, let me jump in here—sounds like you might be overthinking this. What's the main thing you're trying to do?"
- "Sorry to interrupt, but I think I can help. Let's take this step by step."
- "Hold on—I think I lost you there. Can you tell me what you're actually trying to achieve?"`;

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
    const { 
      speech, 
      conversationHistory = [], 
      speakingTime = 0 
    } = body;

    if (!speech || typeof speech !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'speech' field" },
        { status: 400 }
      );
    }

    // Calculate stats
    const wordCount = speech.split(/\s+/).filter(Boolean).length;
    const speechLower = speech.toLowerCase();
    const fillerCount = [
      "um", "uh", "like", "you know", "i don't know", "i'm not sure"
    ].reduce((count, filler) => {
      const regex = new RegExp(filler, "gi");
      return count + (speechLower.match(regex) || []).length;
    }, 0);

    // Format recent conversation history
    const historyText = conversationHistory
      .slice(-4)
      .map((m: { role: string; content: string }) => 
        `${m.role.toUpperCase()}: ${m.content}`
      )
      .join("\n");

    const judgePrompt = `Context: ${historyText || "No prior context"}

USER SPEECH: "${speech}"

Stats: ${speakingTime.toFixed(0)}s speaking, ${wordCount} words, ${fillerCount} filler/uncertainty phrases detected.

What should happen? INTERRUPT, PAUSE, QUICK, DETAILED, or CONTINUE.`;

    const groq = new Groq({ apiKey: groqApiKey });

    // First call: Judge the speech
    const judgeResponse = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: judgePrompt }
      ],
      max_tokens: 5,
      temperature: 0,
    });

    const result = judgeResponse.choices[0]?.message?.content?.trim().toUpperCase() || "CONTINUE";
    
    // Parse the result to ensure it's one of the valid options
    let action: "INTERRUPT" | "PAUSE" | "QUICK" | "DETAILED" | "CONTINUE" = "CONTINUE";
    if (result.includes("INTERRUPT")) action = "INTERRUPT";
    else if (result.includes("PAUSE")) action = "PAUSE";
    else if (result.includes("QUICK")) action = "QUICK";
    else if (result.includes("DETAILED")) action = "DETAILED";

    // If INTERRUPT, generate the response text for TTS
    let interruptResponse: string | undefined;
    
    if (action === "INTERRUPT") {
      const responsePrompt = `Conversation so far:
${historyText || "No prior context"}

USER (currently speaking, struggling): "${speech}"

Generate a helpful interruption response:`;

      const responseCall = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: INTERRUPT_RESPONSE_PROMPT },
          { role: "user", content: responsePrompt }
        ],
        max_tokens: 60,
        temperature: 0.7,
      });

      interruptResponse = responseCall.choices[0]?.message?.content?.trim();
      
      // Clean up the response - remove quotes if present
      if (interruptResponse) {
        interruptResponse = interruptResponse.replace(/^["']|["']$/g, '');
      }
    }

    return NextResponse.json({
      action,
      interruptResponse,
      stats: {
        wordCount,
        fillerCount,
        speakingTime,
      },
    });
  } catch (error) {
    console.error("Judge speech error:", error);
    return NextResponse.json(
      { error: "Failed to analyze speech" },
      { status: 500 }
    );
  }
}
