import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import multer from "multer";
import nodemailer from "nodemailer";

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

app.post("/notify/tag", async (req, res) => {
  const {
    email,
    taggedUser,
    taggedBy = "You",
    message,
    context = "Discussion Panel"
  } = req.body || {};

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Missing email" });
  }
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing message" });
  }

  const EMAIL_USER = process.env.EMAIL_USER;
  const EMAIL_PASS = process.env.EMAIL_PASS;

  if (!EMAIL_USER || !EMAIL_PASS) {
    return res.status(500).json({ error: "Email credentials not configured" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });

    const safeTaggedUser = typeof taggedUser === "string" ? taggedUser : "";
    const safeTaggedBy = typeof taggedBy === "string" ? taggedBy : "You";
    const safeContext = typeof context === "string" ? context : "Discussion Panel";

    const subject = "You were tagged in NoteGrid";
    const text = [
      safeTaggedUser ? `Hi ${safeTaggedUser},` : "Hi,",
      "",
      `${safeTaggedBy} tagged you in NoteGrid.`,
      "",
      `Context: ${safeContext}`,
      "",
      "Message:",
      message,
      "",
      "— NoteGrid"
    ].join("\n");

    await transporter.sendMail({
      from: EMAIL_USER,
      to: email,
      subject,
      text
    });

    return res.json({ ok: true });
  } catch (err) {
      console.error("EMAIL ERROR FULL:", err);
      return res.status(500).json({
        error: err.message,
        code: err.code
      });
    }
  
});

app.listen(3001, () =>
  console.log("AI server running on http://localhost:3001")
);
