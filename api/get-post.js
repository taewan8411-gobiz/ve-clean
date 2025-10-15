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

    // 정규화 (모두 문자열로 오는 Upstash 특성 고려)
    const normalized = {
      id: String(post.id ?? id),
      category: post.category ?? '',
      title: post.title ?? '',
      content: post.content ?? '',
      createdAt: Number(post.createdAt) || Date.now()
    };

    // ✅ 메시지 가져오기: 여러 키 후보를 탐색하여 최초로 발견한 걸 사용
    // 기본: post:{id}:msgs  / 호환: post:{id}:messages
    const keys = [`post:${id}:msgs`, `post:${id}:messages`];
    let raw = [];
    for (const k of keys) {
      raw = await kv.lrange(k, 0, -1);
      if (raw && raw.length) break;
    }

    // 최신(왼쪽)에 push 되어 있을 것이므로 화면은 과거→최신으로 보여준다
    const msgs = (raw || [])
      .map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: s }; } })
      .reverse()
      .map(m => ({
        role: String(m.role || 'assistant').trim().toLowerCase() === 'user' ? 'user' : 'assistant',
        content: toText(m.content)
      }));

    res.json({ ...normalized, messages: msgs });
  } catch (e) {
    console.error('get-post.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
