import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const ids = await kv.lrange('posts', 0, 199);
    const rows = await Promise.all((ids || []).map(id => kv.hgetall(`post:${id}`)));
    const items = (rows || [])
      .filter(Boolean)
      .sort((a,b) => (b?.createdAt || 0) - (a?.createdAt || 0))
      .filter(p => !q || (p.title?.toLowerCase().includes(q) || p.content?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
