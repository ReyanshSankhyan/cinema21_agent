// Serverless function for DELETE /api/agent
export default async function handler(req, res) {
  // Agent deletion is disabled in serverless version
  res.status(200).json({ success: true });
}