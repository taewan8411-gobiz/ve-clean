import { kv } from '@vercel/kv';

function toText(c){
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p)))).join('');
  if (c && typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
  return String(c ?? '');
}

export default async function handler(req, res) {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'bad_request', message: 'id required' });

    const post = await kv.hgetall(`post:${id}`);
    if (!post) return res.status(404).json({ error: 'not_found' });

    const normalized = {
      id: String(post.id ?? id),
      category: post.category ?? '',
      title: post.title ?? '',
      content: post.content ?? '',
      createdAt: Number(post.createdAt) || Date.now()
    };

    // 메시지 로딩 (기본 키 + 호환 키)
    const keys = [`post:${id}:msgs`, `post:${id}:messages`];
    let raw = [];
    for (const k of keys) {
      raw = await kv.lrange(k, 0, -1);
      if (raw && raw.length) break;
    }

    // 최신 → 과거 로 저장되어 있으니 화면은 과거 → 최신
    let msgs = (raw || [])
      .map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: s }; } })
      .reverse()
      .map(m => ({
        role: String(m.role || 'assistant').trim().toLowerCase() === 'user' ? 'user' : 'assistant',
        content: toText(m.content)
      }));

    // ======== 화면 보정 로직 ========
    // 1) 첫 메시지가 글의 본문과 동일하면, 그건 사용자 질문일 가능성이 높다 → user로 강제 표시
    if (msgs[0] && msgs[0].role === 'assistant') {
      const first = (msgs[0].content || '').trim();
      if (first && first.replace(/\s+/g,'') === (normalized.content||'').trim().replace(/\s+/g,'')) {
        msgs[0].role = 'user';
      }
    }
    // 2) 마지막 메시지가 짧은 질문 형태라면(?, “알려줘/해주세요/방법”), 사용자로 보정
    if (msgs.length) {
      const last = msgs[msgs.length - 1];
      const text = (last.content || '').trim();
      const looksLikeQuestion =
        text.length <= 60 &&
        (/[?？]$/.test(text) || /(알려줘|해주세요|방법|어떻게|해줘)$/.test(text));
      if (last.role === 'assistant' && looksLikeQuestion) {
        last.role = 'user';
      }
    }
    // =================================

    res.json({ ...normalized, messages: msgs });
  } catch (e) {
    console.error('get-post.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
