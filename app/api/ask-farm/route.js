import { NextResponse } from "next/server";

// Uses Google Gemini (aistudio.google.com/apikey) by default.
// Swap the URL/body below for Anthropic's api.anthropic.com/v1/messages
// if you'd rather use a Claude API key instead — see the comment below.

export async function POST(req) {
  try {
    const { question, context } = await req.json();

    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "LLM_API_KEY not configured on the server" },
        { status: 500 }
      );
    }

    const prompt =
      `You are a chilli farm assistant. Here is the last 20 sensor readings ` +
      `(JSON): ${JSON.stringify(context)}. ` +
      `Answer this question in 2-3 plain-English sentences: "${question}"`;

    // ---- Gemini (default) ----
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await res.json();
    const answer =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "No answer returned.";

    return NextResponse.json({ answer });

    // ---- Anthropic Claude (alternative) ----
    // Uncomment this block and comment out the Gemini block above
    // if you'd rather use a Claude API key.
    //
    // const res = await fetch("https://api.anthropic.com/v1/messages", {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "x-api-key": apiKey,
    //     "anthropic-version": "2023-06-01",
    //   },
    //   body: JSON.stringify({
    //     model: "claude-sonnet-4-6",
    //     max_tokens: 300,
    //     messages: [{ role: "user", content: prompt }],
    //   }),
    // });
    // const data = await res.json();
    // const answer = data?.content?.[0]?.text ?? "No answer returned.";
    // return NextResponse.json({ answer });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong reaching the farm assistant." },
      { status: 500 }
    );
  }
}
