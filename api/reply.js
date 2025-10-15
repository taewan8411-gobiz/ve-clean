import { kv } from '@vercel/kv';
import OpenAI from 'openai';

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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}));
    const id = (req.query?.id as string) || body.id;   // <- query와 body 모두 지원
    const content = String(body.content ?? '');

    if (!id || !content) return res.status(400).json({ error: 'bad_request', message: 'id/content required' });

    const post = await kv.hgetall(`post:${id}`);
    if (!post) return res.status(404).json({ error: 'not_found' });

    // 1) 사용자 질문 저장(최신이 맨 앞)
    await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'user', content }));

    // 2) 히스토리(과거→최신) 구성 (최근 30개만)
    const raw = await kv.lrange(`post:${id}:msgs`, 0, 29); // 최신→과거, 30개 한정
    const history = raw
      .map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: s }; } })
      .reverse()
      .map(m => {
        const role = String(m.role || '').trim().toLowerCase();
        return { role: (role === 'user' ? 'user' : 'assistant') as 'user'|'assistant', content: toText(m.content) };
      });

    let assistantText = '';
    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // 타임아웃: 8초
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const out = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_INTRO(post.category || '기타') },
            ...history
          ],
          temperature: 0.7,
          max_tokens: 800, // 과도한 토큰은 지연 유발 → 적당히 제한
        }, { signal: controller.signal });

        assistantText = toText(out?.choices?.[0]?.message?.content || '');
        if (assistantText.trim()) {
          await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: assistantText }));
        } else {
          assistantText = '빈 응답이 반환되었습니다. 내용을 조금 더 구체적으로 입력해 보세요.';
          await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: assistantText }));
        }
      } catch (err:any) {
        console.error('openai error:', err?.name, err?.message || err);
        assistantText = 'AI 응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
        await kv.lpush(`post:${id}:msgs`, JSON.stringify({ role: 'assistant', content: assistantText }));
      } finally {
        clearTimeout(timeout);
      }
    } else {
      console.warn('OPENAI_API_KEY not set — skipping OpenAI call');
    }

    return res.json({ ok: true, assistant: assistantText });
  } catch (e:any) {
    console.error('reply.js error:', e);
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
}
