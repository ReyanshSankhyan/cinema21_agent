// Serverless function for /api/signed-url
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const AGENT_ID = "agent_5601k1wg9qcmffk9szmp300ck698";

export default async function handler(req, res) {
  try {
    const client = new ElevenLabsClient({ apiKey: process.env.XI_API_KEY });
    const result = await client.conversationalAi.conversations.getSignedUrl({ agentId: AGENT_ID });
    res.status(200).json({ signedUrl: result.signedUrl, conversationId: result.conversationId });
  } catch (error) {
    res.status(500).json({ error: "Failed to get signed URL" });
  }
}