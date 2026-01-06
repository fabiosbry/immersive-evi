import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const humeApiKey = process.env.HUME_API_KEY;

  if (!humeApiKey) {
    return NextResponse.json(
      { error: "HUME_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { chatId, text } = body;

    if (!chatId || !text) {
      return NextResponse.json(
        { error: "Missing chatId or text" },
        { status: 400 }
      );
    }

    console.log("📢 Sending to EVI TTS:", text);

    // Send assistant_input directly to Hume EVI for TTS
    const response = await fetch(
      `https://api.hume.ai/v0/evi/chat/${chatId}/send`,
      {
        method: "POST",
        headers: {
          "X-Hume-Api-Key": humeApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "assistant_input",
          text: text,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Hume assistant_input error:", errorText);
      return NextResponse.json(
        { error: "Failed to send to TTS" },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Send assistant input error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

