// Serverless function for /api/agent
const AGENT_ID = "agent_5601k1wg9qcmffk9szmp300ck698";

export default async function handler(req, res) {
  res.status(200).json({ agentId: AGENT_ID });
}