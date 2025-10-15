import { kv } from '@vercel/kv';
import OpenAI from 'openai';

const CATEGORIES = ['글로벌셀링','수출신고','물류통관','세무회계','바이어발굴','규격인증','기타'];
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const SYSTEM_INTRO = (category='기타') => [
  `당신은 한국 중소기업의 규모와 자원 상황을 이해하는 실전 경험 20년차의 "${category}" **분야 전문가**입니다.`,
  `답변은 **결론부터 명확히 요약**하고, 실무자가 **오늘 당장 실행할 수 있는 '구체적인 실행 가이드(Step-by-step)'**를 반드시 제시하세요.`,
  `필요하다면 **예시, 필수 서류 이름, 관련 정부 기관 명칭, 출처, 링크**를 포함하여 답변하세요.`,
  `원론적인 이야기는 최소화하고 현장 용어를 사용하며, 질문을 그대로 반복하지 말고 바로 실무 설명을 시작하세요.`
].join(' ');
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
    let { category='기타', title='', content='' } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'bad_request', message: '제목/내용 필수' });
    if (!CATEGORIES.includes(category)) category = '기타';

    // 새 글 ID
    const id = await kv.incr('post:id');
    const post = { id: String(id), category, title, content, createdAt: Date.now() };
    await kv.hset(`post:${id}`, post);

    // 대화 로그 (최신이 맨 앞)
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

    // 목록 인덱스(최신순)
    await kv.lpush('posts', String(id));
    await kv.ltrim('posts', 0, 999);

    // 첫 AI 답변
    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const out = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_INTRO(category) },
          { role: 'user', content }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });
      const text = toText(out?.choices?.[0]?.message?.content);
      if (text.trim()) await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: text }));
    }

    res.json({ ok: true, id: String(id) });
  } catch (e) {
    console.error('ask.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
