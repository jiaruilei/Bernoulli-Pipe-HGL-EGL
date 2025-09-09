import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(express.json({ limit: "1mb" }));

// If your HTML is on GitHub Pages, allow that origin here:
app.use(cors({
  origin: [
    // replace <user> and <repo> below with your GitHub Pages origin
    "https://jiaruilei.github.io",
    "https://jiaruilei.github.io/jet-flow/"
  ],
}));

// Health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ChatGPT proxy
app.post("/api/chat", async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const { model="gpt-4o-mini", temperature=0.2, system="", messages=[] } = req.body || {};
    const chatMessages = [];
    if (system) chatMessages.push({ role: "system", content: system });
    for (const m of messages) if (m?.role && m?.content) chatMessages.push(m);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, temperature, messages: chatMessages })
    });

    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.json({ reply: data?.choices?.[0]?.message?.content ?? "" });
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AI coach proxy listening on :${port}`));

