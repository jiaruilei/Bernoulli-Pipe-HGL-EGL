import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

// --- Basic hardening & perf ---
app.use(helmet({
  // Allow inline scripts/styles from your single-file app
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));

// CORS (same-origin by default). Set CORS_ORIGIN if you host frontend elsewhere.
const corsOrigin = process.env.CORS_ORIGIN || undefined; // e.g., "https://your-frontend.onrender.com"
app.use(cors(corsOrigin ? { origin: corsOrigin } : undefined));

// --- Rate limit the API (protect your key & quota) ---
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 req/min per IP
});
app.use('/api/', limiter);

// --- Static files (your game) ---
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { maxAge: '1h', etag: true }));

// Health endpoint for Render
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// --- ChatGPT proxy endpoint ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post('/api/chat', async (req, res) => {
  try {
    const { model = 'gpt-4o-mini', temperature = 0.2, messages = [] } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ ok: false, error: 'Invalid payload: messages must be an array' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: 'Server missing OPENAI_API_KEY' });
    }

    // Chat Completions (matches your front-end payload)
    const out = await client.chat.completions.create({
      model,
      temperature,
      messages,
      // Optional safety caps:
      max_tokens: 600
    });

    const reply = out.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ ok: true, reply });
  } catch (err) {
    console.error('Chat proxy error:', err?.response?.data || err);
    return res.status(500).json({ ok: false, error: 'Coach error' });
  }
});

// Single-page fallback: serve index.html for unknown routes (optional)
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
