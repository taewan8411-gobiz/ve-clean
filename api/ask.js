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

function toText(c:any){
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p)))).join('');
  if (c && typeof c === 'object') return (c as any).text ?? (c as any).content ?? JSON.stringify(c);
  return String(c ?? '');
}

export default async function handler(req:any, res:any) {
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

      // 타임아웃(예: 8초) 방지용
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);

      try {
        const out = await openai.chat.completions.create({
          model: MODEL,                 // <- 여기서 MODEL 사용
          messages: [
            { role: 'system', content: SYSTEM_INTRO(category) },
            { role: 'user', content }
          ],
          temperature: 0.7,
          max_tokens: 800,             // 너무 크면 응답 지연 → 약간 낮춤
        }, { signal: controller.signal });

        const text = toText(out?.choices?.[0]?.message?.content);
        if (text?.trim()) {
          await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: text }));
        } else {
          console.warn('openai empty message for post', id);
        }
      } catch (err:any) {
        console.error('openai error for post', id, err?.message || err);
        await kv.lpush(`post:${id}:msgs`, JSON.stringify({
          role: 'assistant',
          content: 'AI 응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
        }));
      } finally {
        clearTimeout(t);
      }
    } else {
      console.warn('OPENAI_API_KEY not set — skipping first AI answer');
    }

    return res.json({ ok: true, id: String(id) });
  } catch (e:any) {
    console.error('ask.js error:', e);
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
}
