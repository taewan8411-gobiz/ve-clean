import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.max(1, Math.min(50, parseInt(req.query.pageSize || '20', 10)));

    const ids = await kv.lrange('posts', 0, -1); // 최신 → 과거
    const rows = await Promise.all((ids || []).map(id => kv.hgetall(`post:${id}`)));
    const all = (rows || []).filter(Boolean);

    // 검색
    const filtered = !q ? all : all.filter(p =>
      (p.title||'').toLowerCase().includes(q) ||
      (p.content||'').toLowerCase().includes(q) ||
      (p.category||'').toLowerCase().includes(q)
    );

    // 페이지
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    // ✅ 답변 여부 판정: 다양한 저장형태를 모두 허용
    async function hasAssistant(id) {
      const keys = [`post:${id}:msgs`, `post:${id}:messages`]; // 예전/다른 키도 탐색
      for (const k of keys) {
        const arr = await kv.lrange(k, 0, -1);
        if (!arr || arr.length === 0) continue;
        for (const s of arr) {
          try {
            const m = JSON.parse(s);
            const role = String(m.role || '').trim().toLowerCase();
            if (role === 'assistant') return true;
          } catch {
            // 문자열로 저장된 경우(= 과거 호환): assistant가 문자열만 저장되었을 수도 있다
            // 이 경우엔 사용자/AI를 구분 못 하므로 길이가 2개 이상이면 답변이 있었다고 판단(보수적)
            if (arr.length >= 2) return true;
          }
        }
      }
      return false;
    }

    const result = await Promise.all(items.map(async p => {
      const answered = await hasAssistant(p.id);
      return {
        ...p,
        createdAt: Number(p.createdAt) || Date.now(), // 숫자화
        answered
      };
    }));

    res.json({ items: result, total, page, pageSize });
  } catch (e) {
    console.error('list.js error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
}
