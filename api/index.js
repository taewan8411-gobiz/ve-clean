// api/index.js — Express + Upstash KV + OpenAI
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { kv } from "@vercel/kv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const kvReady = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const aiReady = !!process.env.OPENAI_API_KEY;

// 헬스체크
app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true, node: process.version, kv_ready: kvReady, openai_ready: aiReady });
});

// 글 목록
app.get("/api/posts", async (_req, res) => {
  if (!kvReady) return res.json({ items: [], note: "KV not configured" });
  try {
    const ids = await kv.lrange("posts", 0, 99);
    const rows = await Promise.all((ids || []).map(id => kv.hgetall(`post:${id}`)));
    rows.sort((a,b) => (b?.createdAt || 0) - (a?.createdAt || 0));
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e) });
  }
});

// 글 상세 + 대화
app.get("/api/posts/:id", async (req, res) => {
  if (!kvReady) return res.status(500).json({ error: "kv_not_configured" });
  try {
    const post = await kv.hgetall(`post:${req.params.id}`);
    if (!post) return res.status(404).json({ error: "not_found" });
    const msgs = await kv.lrange(`post:${req.params.id}:msgs`, 0, -1);
    const messages = (msgs || []).map(s => { try { return JSON.parse(s); } catch { return { role: "assistant", content: String(s) }; } }).reverse();
    res.json({ ...post, messages });
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e) });
  }
});

// 글 작성 + 첫 AI 답변
app.post("/api/ask", async (req, res) => {
  if (!kvReady)  return res.status(500).json({ error: "kv_not_configured" });
  if (!aiReady)  return res.status(500).json({ error: "missing_api_key" });

  const { category = "기타", title = "", content = "" } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: "bad_request", message: "제목/내용 필수" });

  try {
    const id = await kv.incr("post:id");
    const post = { id: String(id), category, title, content, createdAt: Date.now() };
    await Promise.all([
      kv.hset(`post:${id}`, post),
      kv.lpush("posts", String(id)),
      kv.ltrim("posts", 0, 999),
      kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: "user", content }))
    ]);

    const system = "역할: 수출 애로해소 전문가. 필수 섹션: (1)핵심 요약 (2)절차 (3)주의 (4)근거/출처 (5)체크리스트 (6)다음 행동. 톤: 간결.";
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const out = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content }
      ],
      temperature: 0.3,
      max_tokens: 900
    });
    const answer = out?.choices?.[0]?.message?.content?.trim() || "_응답 없음_";
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: "assistant", content: answer }));

    res.json({ id: String(id), answer });
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e) });
  }
});

// 이어 질문
app.post("/api/posts/:id/reply", async (req, res) => {
  if (!kvReady)  return res.status(500).json({ error: "kv_not_configured" });
  if (!aiReady)  return res.status(500).json({ error: "missing_api_key" });

  try {
    const { id } = req.params;
    const post = await kv.hgetall(`post:${id}`);
    if (!post) return res.status(404).json({ error: "not_found" });

    const { content = "" } = req.body || {};
    if (!content) return res.status(400).json({ error: "bad_request", message: "내용 필수" });

    const list = await kv.lrange(`post:${id}:msgs`, 0, -1);
    const historyAsc = (list || []).map(s => { try { return JSON.parse(s); } catch { return { role: "assistant", content: String(s) }; } }).reverse();
    historyAsc.push({ role: "user", content });
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: "user", content }));

    const system = "역할: 수출 애로해소 전문가. 위 대화 맥락을 이어서, 간결하고 단계별로 답변.";
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const out = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: system }, ...historyAsc],
      temperature: 0.7,
      max_tokens: 900
    });
    const answer = out?.choices?.[0]?.message?.content?.trim() || "_응답 없음_";
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: "assistant", content: answer }));
    res.json({ answer });
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e) });
  }
});

export default (req, res) => app(req, res);
