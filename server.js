import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// --- Optional fetch polyfill for Node < 18 (Render should use >=18, but this is safer)
if (typeof fetch === "undefined") {
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

dotenv.config();
const app = express();
app.use(express.json({ limit: "1mb" }));

// --- CORS: use origins (no paths). Add your GitHub Pages origin(s) here or set CORS_ORIGINS.
const corsOrigins = (process.env.CORS_ORIGINS || "https://jiaruilei.github.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: corsOrigins,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-instructor-token"],
}));

// --- Student-question logging and quiz guidance ---------------------------
// Render's normal filesystem may be reset on deploy/restart. For long-term logs,
// attach a Render Persistent Disk and set QUESTION_LOG_DIR to that mounted path.
const LOG_DIR = process.env.QUESTION_LOG_DIR || "/tmp/bernoulli-question-logs";
const LOG_FILE = path.join(LOG_DIR, "student-questions.jsonl");
const CHAT_LOG_FILE = process.env.CHAT_LOG_FILE || path.join(LOG_DIR, "ai-coach-chat-history.jsonl");
const ANALYTICS_LIMIT = Number.parseInt(process.env.QUESTION_ANALYTICS_LIMIT || "1000", 10);
const MAX_RECENT = Number.parseInt(process.env.MAX_RECENT_QUESTIONS || "40", 10);
const INSTRUCTOR_TOKEN = process.env.INSTRUCTOR_TOKEN || "";
const STORE_SCENE_CONTEXT = process.env.STORE_SCENE_CONTEXT === "true";
const recentRequestIds = new Set();

const QUIZ_TYPES = ["v2", "p2kPa", "dhMano", "dhPitot", "Q"];
const QUIZ_LABELS = {
  v2: "continuity: find v₂",
  p2kPa: "Bernoulli: find p₂",
  dhMano: "manometer Δh",
  dhPitot: "Pitot velocity head",
  Q: "flow rate Q",
};

const TOPIC_RULES = [
  {
    key: "continuity",
    label: "Continuity / diameter / area",
    quizTypes: ["v2", "Q"],
    patterns: [/continuity/i, /area/i, /diameter/i, /\bd1\b/i, /\bd2\b/i, /d₁/i, /d₂/i, /\bq\b/i, /flow\s*rate/i, /narrow/i, /widen/i, /increase\s*v[₂2]/i, /velocity/i],
  },
  {
    key: "pressure",
    label: "Pressure / pressure drop",
    quizTypes: ["p2kPa", "dhMano"],
    patterns: [/pressure/i, /\bp1\b/i, /\bp2\b/i, /p₁/i, /p₂/i, /drop/i, /gauge/i, /negative/i, /kpa/i],
  },
  {
    key: "elevation",
    label: "Elevation / height head",
    quizTypes: ["p2kPa", "dhMano"],
    patterns: [/elevation/i, /height/i, /higher/i, /lower/i, /raise/i, /\bz1\b/i, /\bz2\b/i, /z₁/i, /z₂/i],
  },
  {
    key: "bernoulli-heads",
    label: "Bernoulli / HGL / EGL",
    quizTypes: ["p2kPa", "dhMano", "dhPitot"],
    patterns: [/bernoulli/i, /\bhgl\b/i, /\begl\b/i, /head/i, /energy/i, /total\s*head/i],
  },
  {
    key: "manometer",
    label: "Manometer reading",
    quizTypes: ["dhMano"],
    patterns: [/manometer/i, /delta\s*h/i, /\bdh\b/i, /Δh/i, /tap/i],
  },
  {
    key: "pitot",
    label: "Pitot tube / stagnation head",
    quizTypes: ["dhPitot"],
    patterns: [/pitot/i, /stagnation/i, /velocity\s*head/i],
  },
  {
    key: "units",
    label: "Units / calculations",
    quizTypes: ["v2", "p2kPa", "Q"],
    patterns: [/unit/i, /dimension/i, /convert/i, /calculation/i, /formula/i, /equation/i],
  },
];

function truncate(text, max = 500) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitizeQuestion(text) {
  return truncate(text, 500)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{8,}\b/g, "[number]");
}

function sanitizeChatText(text, max = 4000) {
  return truncate(text, max)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{8,}\b/g, "[number]");
}

function sanitizeId(text) {
  return truncate(text, 120).replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function extractQuestionFromBody(body = {}) {
  if (typeof body.question === "string" && body.question.trim()) return sanitizeQuestion(body.question);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m?.role === "user" && typeof m.content === "string");
  if (!lastUser) return "";
  return sanitizeQuestion(lastUser.content.split(/\n\s*current\s+scene\s*:/i)[0]);
}

function classifyQuestion(question) {
  const topicHits = [];
  const quizTypes = new Set();

  for (const rule of TOPIC_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(question))) {
      topicHits.push(rule.key);
      for (const quizType of rule.quizTypes) quizTypes.add(quizType);
    }
  }

  if (!topicHits.length && /why|how|explain|walk|help|confus/i.test(question)) {
    topicHits.push("bernoulli-heads");
    ["p2kPa", "dhMano", "dhPitot"].forEach((quizType) => quizTypes.add(quizType));
  }

  return {
    topics: topicHits.length ? topicHits : ["general"],
    quizTypes: quizTypes.size ? [...quizTypes] : [...QUIZ_TYPES],
  };
}

async function appendJsonl(filePath, object) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(object)}\n`, "utf8");
}

async function readQuestionRecords(limit = ANALYTICS_LIMIT) {
  try {
    const text = await fs.readFile(LOG_FILE, "utf8");
    const lines = text.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function readChatRecords(limit = Number.MAX_SAFE_INTEGER) {
  try {
    const text = await fs.readFile(CHAT_LOG_FILE, "utf8");
    const lines = text.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function recordQuestion({ question, source = "unknown", sessionId = "", requestId = "", scene = "" }) {
  const cleanQuestion = sanitizeQuestion(question);
  if (!cleanQuestion) return null;

  const cleanRequestId = sanitizeId(requestId);
  if (cleanRequestId) {
    if (recentRequestIds.has(cleanRequestId)) return null;
    recentRequestIds.add(cleanRequestId);
    if (recentRequestIds.size > 5000) {
      recentRequestIds.delete(recentRequestIds.values().next().value);
    }
  }

  const classification = classifyQuestion(cleanQuestion);
  const record = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    sessionId: sanitizeId(sessionId),
    requestId: cleanRequestId,
    source: sanitizeId(source || "unknown"),
    question: cleanQuestion,
    topics: classification.topics,
    quizTypes: classification.quizTypes,
  };

  if (STORE_SCENE_CONTEXT && scene) record.scene = truncate(scene, 1000);
  await appendJsonl(LOG_FILE, record);
  return record;
}

async function recordCoachChat({
  question,
  reply,
  source = "chatgpt-coach",
  sessionId = "",
  requestId = "",
  scene = "",
  classification = null,
  model = "",
}) {
  const cleanQuestion = sanitizeQuestion(question);
  const cleanReply = sanitizeChatText(reply, 4000);
  if (!cleanQuestion && !cleanReply) return null;

  const derived = classification?.topics?.length && classification?.quizTypes?.length
    ? classification
    : classifyQuestion(cleanQuestion);

  const record = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    sessionId: sanitizeId(sessionId),
    requestId: sanitizeId(requestId),
    source: sanitizeId(source || "chatgpt-coach"),
    model: sanitizeId(model),
    question: cleanQuestion,
    reply: cleanReply,
    topics: derived.topics,
    quizTypes: derived.quizTypes,
  };

  if (STORE_SCENE_CONTEXT && scene) record.scene = sanitizeChatText(scene, 1000);
  await appendJsonl(CHAT_LOG_FILE, record);
  return record;
}

function summarize(records) {
  const topicCounts = {};
  const quizTypeCounts = Object.fromEntries(QUIZ_TYPES.map((type) => [type, 0]));

  for (const record of records) {
    const topics = Array.isArray(record.topics) && record.topics.length
      ? record.topics
      : classifyQuestion(record.question || "").topics;

    const quizTypes = Array.isArray(record.quizTypes) && record.quizTypes.length
      ? record.quizTypes
      : classifyQuestion(record.question || "").quizTypes;

    for (const topic of topics) topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    for (const quizType of quizTypes) {
      if (quizTypeCounts[quizType] !== undefined) quizTypeCounts[quizType] += 1;
    }
  }

  const maxCount = Math.max(1, ...Object.values(quizTypeCounts));
  const quizWeights = {};

  for (const quizType of QUIZ_TYPES) {
    // Keep every quiz type alive, but give asked-about topics up to about 5x priority.
    quizWeights[quizType] = records.length
      ? Number((1 + (quizTypeCounts[quizType] / maxCount) * 4).toFixed(2))
      : 1;
  }

  const recommendedQuizTypes = [...QUIZ_TYPES]
    .sort((a, b) => quizWeights[b] - quizWeights[a])
    .map((type) => ({
      type,
      label: QUIZ_LABELS[type],
      weight: quizWeights[type],
      count: quizTypeCounts[type],
    }));

  const recent = records.slice(-MAX_RECENT).reverse().map((record) => ({
    ts: record.ts,
    sessionId: record.sessionId,
    source: record.source,
    question: record.question,
    topics: record.topics,
    quizTypes: record.quizTypes,
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalQuestions: records.length,
    topicCounts,
    quizTypeCounts,
    quizWeights,
    recommendedQuizTypes,
    recent,
  };
}

function requireInstructor(req, res, next) {
  if (!INSTRUCTOR_TOKEN) {
    return res.status(500).json({ error: "Server missing INSTRUCTOR_TOKEN" });
  }

  const provided = req.get("x-instructor-token") || "";
  if (!provided || provided !== INSTRUCTOR_TOKEN) {
    return res.status(401).json({ error: "Instructor token required or incorrect" });
  }

  next();
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

// --- Health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Public endpoint used by the web page to let aggregate student questions guide quiz mode.
// It intentionally omits raw question text.
app.get("/api/questions/quiz-signal", async (req, res) => {
  try {
    const records = await readQuestionRecords();
    const { recent, ...safeSummary } = summarize(records);
    res.json(safeSummary);
  } catch (err) {
    console.error("Quiz signal error:", err);
    res.status(500).json({ error: "Quiz signal error" });
  }
});

// Public logging endpoint for built-in coach interactions that do not call /api/chat.
app.post("/api/questions/log", async (req, res) => {
  try {
    const record = await recordQuestion({
      question: extractQuestionFromBody(req.body),
      source: req.body?.source || "built-in-coach",
      sessionId: req.body?.sessionId || "",
      requestId: req.body?.requestId || "",
      scene: req.body?.scene || "",
    });

    res.json({
      ok: true,
      recorded: Boolean(record),
      classification: record
        ? { topics: record.topics, quizTypes: record.quizTypes }
        : null,
    });
  } catch (err) {
    console.error("Question log error:", err);
    res.status(500).json({ error: "Question log error" });
  }
});

// Instructor endpoint: returns recent raw questions plus counts.
app.get("/api/questions/summary", requireInstructor, async (req, res) => {
  try {
    const records = await readQuestionRecords();
    res.json(summarize(records));
  } catch (err) {
    console.error("Question summary error:", err);
    res.status(500).json({ error: "Question summary error" });
  }
});

// Instructor endpoint: download a CSV copy of the logged questions.
app.get("/api/questions/export.csv", requireInstructor, async (req, res) => {
  try {
    const records = await readQuestionRecords(Number.MAX_SAFE_INTEGER);
    const rows = [
      ["timestamp", "session_id", "source", "topics", "quiz_types", "question"],
      ...records.map((record) => [
        record.ts,
        record.sessionId,
        record.source,
        record.topics,
        record.quizTypes,
        record.question,
      ]),
    ];

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=bernoulli-student-questions.csv");
    res.send(csv);
  } catch (err) {
    console.error("Question export error:", err);
    res.status(500).json({ error: "Question export error" });
  }
});

// Instructor endpoint: clear the question log when testing or starting a new class activity.
app.post("/api/questions/reset", requireInstructor, async (req, res) => {
  try {
    await fs.rm(LOG_FILE, { force: true });
    recentRequestIds.clear();
    res.json({ ok: true, cleared: true });
  } catch (err) {
    console.error("Question reset error:", err);
    res.status(500).json({ error: "Question reset error" });
  }
});

// Instructor endpoint: download full AI Coach chat history from /api/chat.
app.get("/api/chat/export.csv", requireInstructor, async (req, res) => {
  try {
    const records = await readChatRecords();

    const rows = [
      [
        "timestamp",
        "session_id",
        "request_id",
        "source",
        "model",
        "topics",
        "quiz_types",
        "question",
        "reply",
        "scene",
      ],
      ...records.map((record) => [
        record.ts,
        record.sessionId,
        record.requestId,
        record.source,
        record.model,
        record.topics,
        record.quizTypes,
        record.question,
        record.reply,
        record.scene || "",
      ]),
    ];

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=bernoulli-ai-coach-chat-history.csv");
    res.send(csv);
  } catch (err) {
    console.error("Chat export error:", err);
    res.status(500).json({ error: "Chat export error" });
  }
});

// --- ChatGPT proxy. Also logs the student's question and AI reply.
app.post("/api/chat", async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const {
      model = "gpt-5.4-mini",
      temperature = 0.2,
      system = "",
      messages = [],
    } = req.body || {};

    const question = extractQuestionFromBody(req.body);

    let classification = null;

    try {
      const record = await recordQuestion({
        question,
        source: req.body?.source || "chatgpt-coach",
        sessionId: req.body?.sessionId || "",
        requestId: req.body?.requestId || "",
        scene: req.body?.scene || "",
      });

      if (record) {
        classification = {
          topics: record.topics,
          quizTypes: record.quizTypes,
        };
      }
    } catch (logErr) {
      // Do not block tutoring if question logging fails.
      console.warn("Question logging failed:", logErr.message);
    }

    const chatMessages = [];

    if (system) {
      chatMessages.push({ role: "system", content: system });
    }

    for (const m of messages) {
      if (m?.role && m?.content) {
        chatMessages.push({ role: m.role, content: m.content });
      }
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: chatMessages,
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: txt, classification });
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content ?? "";

    try {
      await recordCoachChat({
        question,
        reply,
        source: req.body?.source || "chatgpt-coach",
        sessionId: req.body?.sessionId || "",
        requestId: req.body?.requestId || "",
        scene: req.body?.scene || "",
        classification,
        model,
      });
    } catch (chatLogErr) {
      // Do not block tutoring if chat-history logging fails.
      console.warn("Chat-history logging failed:", chatLogErr.message);
    }

    res.json({ reply, classification });
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy error" });
  }
});

// --- Start
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`AI coach proxy listening on :${port}`);
  console.log(`Health check at: http://localhost:${port}/api/health`);
  console.log(`Student-question log: ${LOG_FILE}`);
  console.log(`AI-coach chat log: ${CHAT_LOG_FILE}`);
});
