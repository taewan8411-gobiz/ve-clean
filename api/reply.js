import { kv } from '@vercel/kv';
import OpenAI from 'openai';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const SYSTEM_INTRO = (category='기타') => [
  `당신은 한국의 중소기업을 돕는 "${category}" 분야 전문가입니다.`,
  `실무자가 바로 실행할 수 있게 1) 단계, 2) 서류, 3) 기간/비용, 4) 체크리스트, 5) 주의사항 순서로 상세히 답하세요.`,
  `제목/질문을 반복하지 말고 바로 설명을 시작하세요.`
].join(' ');

function toText(c){
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p)))).join('');
  if (c && typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
  return String(c ?? '');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const id = req.query.id;
    const { content = '' } = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
    if (!id || !content) return res.status(400).json({ error: 'bad_request' });

    const post = await kv.hgetall(`post:${id}`);
    if (!post) return res.status(404).json({ error: 'not_found' });

    // 1) 사용자 질문을 'user' 역할로 확실히 저장
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content: String(content) }));

    // 2) 히스토리(과거→최신) 구성
    const raw = await kv.lrange(`post:${id}:msgs`, 0, -1); // 최신→과거
    const history = raw
      .map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: s }; } })
      .reverse()
      .map(m => {
        const role = String(m.role || '').trim().toLowerCase();
        return { role: (role === 'user' ? 'user' : 'assistant'), content: toText(m.content) };
      });

    // 3) OpenAI 호출 (키 없으면 생략)
    let assistantText = '';
    if (process.env.OPENAI_API_KEY) {
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
      assistantText = toText(out?.choices?.[0]?.message?.content || '');
      if (assistantText.trim()) {
        await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: assistantText }));
      }
    }

    // 프론트가 바로 렌더할 수 있게 텍스트 반환
    return res.json({ ok: true, assistant: assistantText });
  } catch (e) {
    console.error('reply.js error:', e);
    return res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
}
