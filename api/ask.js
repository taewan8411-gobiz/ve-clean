import { kv } from '@vercel/kv';
import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { category = '기타', title = '', content = '' } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'bad_request', message: '제목/내용 필수' });

    const id = await kv.incr('post:id');
    const post = { id: String(id), category, title, content, createdAt: Date.now() };
    await kv.hset(`post:${id}`, post);
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

    // 목록 인덱스(최신순) 유지
    await kv.lpush('posts', String(id));
    await kv.ltrim('posts', 0, 999);

    // OpenAI 첫 답변 (키 없으면 생략)
    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '너는 수출 애로해소 전문가야. 간결하고 단계별로 답변해.' },
          { role: 'user', content }
        ],
        temperature: 0.3,
        max_tokens: 800
      });

      const msg = completion.choices?.[0]?.message?.content;
      const text = typeof msg === 'string'
        ? msg
        : Array.isArray(msg)
          ? msg.map(p => (typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p)))).join('')
          : (msg?.text ?? JSON.stringify(msg ?? ''));

      if (text.trim()) {
        await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: text }));
      }
    }

    return res.status(200).json({ ok: true, id: String(id) });
  } catch (e) {
    console.error('ask.js error:', e);
    return res.status(500).json({ error: 'server_error', detail: e.message });
  }
}
