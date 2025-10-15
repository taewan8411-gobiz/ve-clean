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

    const list = await kv.lrange(`post:${id}:msgs`, 0, -1);
    const history = list.map(str => {
      try { return JSON.parse(str); } catch { return { role: 'user', content: str }; }
    }).reverse();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '너는 수출 애로해소 전문가야. 이전 대화 맥락을 유지해서 간결하게 답변해.' },
        ...history
      ]
    });

    // ✅ content를 문자열로 정제
    const message = completion.choices?.[0]?.message?.content;
    const text = typeof message === 'string'
      ? message
      : Array.isArray(message)
        ? message.map(m => m.text ?? '').join('\n')
        : typeof message === 'object'
          ? JSON.stringify(message)
          : String(message ?? '');

    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: text }));

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('reply.js error:', e);
    return res.status(500).json({ error: 'server_error', detail: e.message });
  }
}
