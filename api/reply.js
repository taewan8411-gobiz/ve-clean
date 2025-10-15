import { kv } from '@vercel/kv';
import OpenAI from 'openai';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const SYSTEM_INTRO = (category='기타') => [
  `당신은 한국의 중소기업을 돕는 "${category}" 분야 전문가입니다.`,
  `이전 대화 맥락을 바탕으로, 실무자가 바로 실행할 수 있게`,
  `1) 단계, 2) 서류, 3) 기간/비용, 4) 체크리스트, 5) 주의사항`,
  `형식으로 **최대한 상세히** 답변하세요.`,
  `※ 제목/질문을 그대로 반복하지 말고 바로 설명을 시작하세요.`
].join(' ');

function toText(c){
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p)))).join('');
  if (c && typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
  return String(c ?? '');
}

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
      const out = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_INTRO(post.category || '기타') },
          ...history
        ],
        temperature: 0.2,
        max_tokens: 1000
      });

      const text = toText(out?.choices?.[0]?.message?.content);
      if (text.trim()) await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: text }));
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('reply.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
