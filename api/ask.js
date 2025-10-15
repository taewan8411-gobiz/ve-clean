import { kv } from '@vercel/kv';
import OpenAI from 'openai';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5'; // 기본 gpt-5

const CATEGORIES = [
  '글로벌셀링', '수출신고', '물류통관', '세무회계', '바이어발굴', '규격인증', '기타'
];

function systemPrompt(category = '기타') {
  return [
    `당신은 한국의 중소기업을 돕는 "${category}" 분야 전문가입니다.`,
    `상황을 빠르게 파악하고, 실무자가 바로 실행할 수 있도록`,
    `1) 배경/전제, 2) 단계별 절차, 3) 필요한 서류/양식, 4) 비용·기간, 5) 자주 하는 실수와 주의사항, 6) 관련 기관/링크(있으면)`,
    `순서로 **최대한 상세하게** 안내하세요.`,
    `법령/제도는 한국 기준을 우선하며, 해외 규격·물류·세무는 나라별 차이를 분리해 설명합니다.`,
    `모르면 추정하지 말고 부족한 정보 목록을 먼저 물어보세요.`,
  ].join(' ');
}

function toText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p)))).join('');
  if (c && typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
  return String(c ?? '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    let { category = '기타', title = '', content = '' } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'bad_request', message: '제목/내용 필수' });
    if (!CATEGORIES.includes(category)) category = '기타';

    // 글 저장
    const id = await kv.incr('post:id');
    const post = { id: String(id), category, title, content, createdAt: Date.now() };
    await kv.hset(`post:${id}`, post);
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

    // 목록 인덱스 최신 유지
    await kv.lpush('posts', String(id));
    await kv.ltrim('posts', 0, 999);

    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const out = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt(category) },
          { role: 'user', content }
        ],
        temperature: 0.2,
        max_tokens: 1000
      });

      const text = toText(out?.choices?.[0]?.message?.content);
      if (text.trim()) {
        await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: text }));
      }
    }

    res.json({ ok: true, id: String(id) });
  } catch (e) {
    console.error('ask.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
