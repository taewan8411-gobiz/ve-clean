import { kv } from '@vercel/kv';
import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const id = req.query.id;
    const { content = '' } = req.body || {};
    if (!id || !content) return res.status(400).json({ error: 'bad_request' });

    const post = await kv.hgetall(`post:${id}`);
    if (!post) return res.status(404).json({ error: 'not_found' });

    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

    if (process.env.OPENAI_API_KEY) {
      const list = await kv.lrange(`post:${id}:msgs`, 0, -1);
      const history = list.map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: s }; } }).reverse();

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '너는 수출 애로해소 전문가야. 이전 맥락을 유지해서 간결하게 답변해.' },
          ...history
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

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('reply.js error:', e);
    return res.status(500).json({ error: 'server_error', detail: e.message });
  }
}
