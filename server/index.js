import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/analyze", async (req, res) => {
  const { text } = req.body;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You extract structured information from text.

Return ONLY valid JSON.
Return a JSON array.
Each item must be an object with EXACT keys:
- "type": one of "task", "decision", "question"
- "text": string

Example:
[
  { "type": "decision", "text": "Decided to ship onboarding v2." },
  { "type": "question", "text": "Who owns comms?" },
  { "type": "task", "text": "Prepare Q3 roadmap." }
]

No markdown.
No code fences.
No explanation.
`
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.2
    });

    const raw = completion.choices[0].message.content;
    console.log("AI RAW OUTPUT:", raw);

    const parsed = JSON.parse(raw);
    res.json(parsed);

  } catch (err) {
    console.error("AI ERROR:", err);
    res.status(500).json({ error: "AI failed" });
  }
});

app.listen(3001, () =>
  console.log("AI server running on http://localhost:3001")
);
