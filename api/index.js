import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const isKVReady = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const isOpenAIReady = Boolean(process.env.OPENAI_API_KEY);

// 최소 라우트
app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true, node: process.version, kv_ready: isKVReady, openai_ready: isOpenAIReady });
});

// 기본 페이지
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

export default (req, res) => app(req, res);
