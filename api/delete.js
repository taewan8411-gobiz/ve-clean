import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (!['POST','DELETE'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

  const token = req.headers['x-admin-token'] || req.query.token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const id = (req.body?.id || req.query?.id || '').toString();
    if (!id) return res.status(400).json({ error: 'bad_request' });

    // posts 목록에서 제거
    const ids = await kv.lrange('posts', 0, -1);
    const rest = (ids || []).filter(x => x !== id);
    if (rest.length !== (ids || []).length) {
      await kv.del('posts');
      if (rest.length) await kv.lpush('posts', ...rest);
    }

    await kv.del(`post:${id}`);
    await kv.del(`post:${id}:msgs`);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
