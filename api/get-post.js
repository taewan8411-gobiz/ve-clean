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

    // 값 정규화 (문자열 → 숫자/문자)
    const normalized = {
      id: String(post.id ?? id),
      category: post.category ?? '',
      title: post.title ?? '',
      content: post.content ?? '',
      createdAt: Number(post.createdAt) || Date.now()
    };

    // 메시지: 최신(왼쪽에 push)로 저장 → 화면은 과거→최신 순으로 보여줌
    const raw = await kv.lrange(`post:${id}:msgs`, 0, -1); // 최신 → 과거
    const msgs = (raw || [])
      .map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: s }; } })
      .reverse() // 과거 → 최신
      .map(m => ({ role: m.role || 'assistant', content: toText(m.content) }));

    res.json({ ...normalized, messages: msgs });
  } catch (e) {
    console.error('get-post.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
