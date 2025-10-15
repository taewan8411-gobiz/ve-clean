import { kv } from '@vercel/kv';
import OpenAI from 'openai';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
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

    // 사용자 메시지 저장(최신이 왼쪽)
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

    // AI 답변 생성
    let assistantText = '';
    if (process.env.OPENAI_API_KEY) {
      const list = await kv.lrange(`post:${id}:msgs`, 0, -1);
      const history = list
        .map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: s }; } })
        .reverse(); // 과거→최신 순서

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const out = await openai.chat.completions.create({
        model: 'gpt-4o',
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

    // 👉 프론트가 바로 렌더할 수 있게 답변 텍스트 반환
    res.json({ ok: true, assistant: assistantText });
  } catch (e) {
    console.error('reply.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
