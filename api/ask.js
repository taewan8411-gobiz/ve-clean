import { kv } from '@vercel/kv';
import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { category = '기타', title = '', content = '' } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'bad_request', message: '제목/내용 필수' });

    // 글 ID 생성 및 저장
    const id = await kv.incr('post:id');
    const post = { id: String(id), category, title, content, createdAt: Date.now() };
    await kv.hset(`post:${id}`, post);
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

    // (선택) AI 첫 답변
    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const out = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '역할: 수출 애로해소 전문가. 간결하고 단계별로 답변.' },
          { role: 'user', content }
        ],
        temperature: 0.3,
        max_tokens: 800
      });

      // ✅ content를 문자열로 변환
      const raw = out?.choices?.[0]?.message?.content;
      const text =
        typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
          ? raw.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('')
          : raw?.text ?? JSON.stringify(raw);

      if (text.trim()) {
        await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: text }));
      }
    }

    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error', detail: e.message });
  }
}
