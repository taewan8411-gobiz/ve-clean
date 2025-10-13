import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'bad_request' });

  const post = await kv.hgetall(`post:${id}`);
  if (!post) return res.status(404).json({ error: 'not_found' });

  const list = await kv.lrange(`post:${id}:msgs`, 0, -1);
  const messages = (list || []).map(s => { try { return JSON.parse(s); } catch { return { role: 'assistant', content: String(s) }; } }).reverse();

  return res.status(200).json({ ...post, messages });
}
