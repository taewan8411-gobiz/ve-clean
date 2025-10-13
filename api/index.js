// 최소 서버리스 함수 (vercel.json 없이도 동작)
export default function handler(req, res) {
  res.status(200).json({ ok: true, message: "Minimal clean project is running." });
}
