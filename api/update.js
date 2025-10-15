import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const token = req.headers['x-admin-token'] || req.query.token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { id, title, content, category } = req.body || {};
    if (!id) return res.status(400).json({ error: 'bad_request' });

    const post = await kv.hgetall(`post:${id}`);
    if (!post) return res.status(404).json({ error: 'not_found' });

    const next = {
      ...post,
      title: title ?? post.title,
      content: content ?? post.content,
      category: category ?? post.category,
      updatedAt: Date.now()
    };
    await kv.hset(`post:${id}`, next);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
