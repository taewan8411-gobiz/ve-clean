import { kv } from '@vercel/kv';
import OpenAI from 'openai';

const CATEGORIES = ['글로벌셀링','수출신고','물류통관','세무회계','바이어발굴','규격인증','기타'];
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const SYSTEM_INTRO = (category='기타') => [
  `당신은 한국의 중소기업을 돕는 "${category}" 분야 전문가입니다.`,
  `실무자가 바로 실행할 수 있게`,
  `1) 핵심 요약(1~2문장), 2) 단계별 절차, 3) 필요한 서류/양식, 4) 비용·기간, 5) 자주 하는 실수/주의사항, 6) 관련 기관·링크(있으면)`,
  `순서로 **최대한 상세하게** 안내하세요.`,
  `모르면 추정하지 말고 부족한 정보를 먼저 질문하세요.`,
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
        temperature: 0.2,
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
