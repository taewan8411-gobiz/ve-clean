import { kv } from '@vercel/kv';
import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { category = '기타', title = '', content = '' } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'bad_request', message: '제목/내용 필수' });

    // 글 저장
    const id = await kv.incr('post:id');
    const post = { id: String(id), category, title, content, createdAt: Date.now() };
    await kv.hset(`post:${id}`, post);
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

    // OpenAI 답변
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '너는 수출 애로해소 전문가야. 간결하게 답변해.' },
        { role: 'user', content }
      ]
    });

    // ✅ content가 배열 또는 객체여도 문자열로 변환
    const message = completion.choices?.[0]?.message?.content;
    const text = typeof message === 'string'
      ? message
      : Array.isArray(message)
        ? message.map(m => m.text ?? '').join('\n')
        : typeof message === 'object'
          ? JSON.stringify(message)
          : String(message ?? '');

    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: text }));

    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error('ask.js error:', e);
    return res.status(500).json({ error: 'server_error', detail: e.message });
  }
}
