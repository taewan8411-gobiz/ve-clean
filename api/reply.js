import { kv } from '@vercel/kv';
import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const id = req.query.id;
  const { content = '' } = req.body || {};
  if (!id || !content) return res.status(400).json({ error: 'bad_request' });

  const post = await kv.hgetall(`post:${id}`);
  if (!post) return res.status(404).json({ error: 'not_found' });

  // 사용자 메시지 저장
  await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

  // (선택) AI 이어답변
 if (process.env.OPENAI_API_KEY) {
    const list = await kv.lrange(`post:${id}:msgs`, 0, -1);
    const history = (list || []).map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: String(s) }; } }).reverse();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const out = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'system', content: '역할: 수출 애로해소 전문가. 위 맥락대로 간결하게 답변.' }, ...history],
      temperature: 0.3,
      max_tokens: 800
    });

    // ✅ content 정규화
    const raw = out?.choices?.[0]?.message?.content;
    const answer = Array.isArray(raw)
      ? raw.map(p => (typeof p === 'string' ? p : (p?.text ?? ''))).join('')
      : (typeof raw === 'string' ? raw : (raw?.text ?? ''));

    if (answer) {
      await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: answer }));
    }
  }
