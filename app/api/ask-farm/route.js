import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { question, context } = await req.json();

    if (!question) {
      return NextResponse.json(
        { error: "Missing question" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not set" },
        { status: 500 }
      );
    }

    // ---------------- PROMPT ----------------
    const prompt = `
You are a chilli farm AI assistant.

Sensor data:
${JSON.stringify(context)}

User question:
${question}

Give a short, practical answer (2–3 sentences).
`;

    // ---------------- GEMINI CALL (FIXED MODEL) ----------------
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    console.log("GEMINI RESPONSE:", JSON.stringify(data, null, 2));

    // ---------------- SAFE PARSE ----------------
    const answer =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.error?.message ||
      "No answer returned.";

    return NextResponse.json({ answer });
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}