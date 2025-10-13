// api/healthz.js
export default function handler(_req, res) {
  res.status(200).json({ ok: true, message: "health ok" });
}
