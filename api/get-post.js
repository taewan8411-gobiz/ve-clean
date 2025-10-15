import { kv } from '@vercel/kv';

function toText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p)))).join('');
  if (c && typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
  return String(c ?? '');
}

export default async function handler(req, res) {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'bad_request' });

    const post = await kv.hgetall(`post:${id}`);
    if (!post) return res.status(404).json({ error: 'not_found' });

    const raw = await kv.lrange(`post:${id}:msgs`, 0, -1);
    const messages = (raw || [])
      .map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: s }; } })
      .reverse()
      .map(m => ({ ...m, content: toText(m.content) }));

    return res.status(200).json({ ...post, messages });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
