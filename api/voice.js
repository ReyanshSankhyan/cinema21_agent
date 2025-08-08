// Serverless function for /api/voice
const VOICE_ID = "gpzZjtWbZNetDrq8CXKD";

export default async function handler(req, res) {
  res.status(200).json({ voiceId: VOICE_ID });
}