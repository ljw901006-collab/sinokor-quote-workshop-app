// 서버가 살아 있는지만 알려준다. 어떤 AI 키의 상태도 노출하지 않는다.
export default function handler(req, res) {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
}
