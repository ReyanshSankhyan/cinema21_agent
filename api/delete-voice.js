// Serverless function for DELETE /api/voice
export default async function handler(req, res) {
  // Voice deletion is disabled in serverless version
  res.status(200).json({ success: true });
}