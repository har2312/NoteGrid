import express from "express";
import cors from "cors";
import OpenAI from "openai";
import multer from "multer";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB per file cap
});

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/analyze", upload.array("files"), async (req, res) => {
  const { text = "" } = req.body || {};
  const files = req.files || [];

  try {
    const userParts = [];
    const trimmed = (text || "").trim();
    if (trimmed) {
      userParts.push({ type: "text", text: trimmed });
    }

    const nonImageNotes = [];

    files.forEach((file) => {
      if (file.mimetype && file.mimetype.startsWith("image/")) {
        const base64 = file.buffer.toString("base64");
        userParts.push({
          type: "image_url",
          image_url: {
            url: `data:${file.mimetype};base64,${base64}`
          }
        });
      } else {
        nonImageNotes.push(`${file.originalname} (${file.mimetype || "unknown"})`);
      }
    });

    if (nonImageNotes.length) {
      userParts.push({
        type: "text",
        text: `Files included (not images): ${nonImageNotes.join(", ")}`
      });
    }

    // Ensure there is at least some content
    if (userParts.length === 0) {
      return res.status(400).json({ error: "No text or supported images provided" });
    }

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
          content: userParts
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
