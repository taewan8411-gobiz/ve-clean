import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.max(1, Math.min(50, parseInt(req.query.pageSize || '20', 10)));

    const ids = await kv.lrange('posts', 0, -1); // 최신 → 과거
    const rows = await Promise.all((ids || []).map(id => kv.hgetall(`post:${id}`)));
    const all = (rows || []).filter(Boolean);

    const filtered = !q ? all : all.filter(p =>
      (p.title||'').toLowerCase().includes(q) ||
      (p.content||'').toLowerCase().includes(q) ||
      (p.category||'').toLowerCase().includes(q)
    );

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    const result = await Promise.all(items.map(async p => {
      const arr = await kv.lrange(`post:${p.id}:msgs`, 0, -1);
      const answered = (arr || []).some(s => {
        try { return JSON.parse(s).role === 'assistant'; }
        catch { return false; }
      });
      return { ...p, answered };
    }));

    res.json({ items: result, total, page, pageSize });
  } catch (e) {
    console.error('list.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
