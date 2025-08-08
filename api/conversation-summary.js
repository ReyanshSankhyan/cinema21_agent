// Serverless function for /api/conversation-summary
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const AGENT_ID = "agent_5601k1wg9qcmffk9szmp300ck698";

export default async function handler(req, res) {
  const client = new ElevenLabsClient({ apiKey: process.env.XI_API_KEY });
  const POLL_INTERVAL_MS = 3000;
  const MAX_WAIT_MS = 30000;
  const startTime = Date.now();
  let lastError = null;
  while (Date.now() - startTime < MAX_WAIT_MS) {
    try {
      const listData = await client.conversationalAi.conversations.list({ agent_id: AGENT_ID, pageSize: 3 });
      if (listData.conversations && listData.conversations.length > 0) {
        const convoObj = listData.conversations[0];
        const conversationId = convoObj.conversationId;
        const status = convoObj.status;
        if (!conversationId || conversationId === 'undefined') {
          lastError = 'Latest conversationId is undefined';
          throw new Error(lastError);
        }
        if (status !== 'done') {
          lastError = `Conversation ${conversationId} not done yet (status: ${status}), waiting...`;
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        try {
          const convo = await client.conversationalAi.conversations.get(conversationId);
          const transcriptSummary = convo.analysis && convo.analysis.transcriptSummary ? convo.analysis.transcriptSummary : null;
          if (convo.analysis && convo.analysis.summary) {
            return res.status(200).json({ summary: convo.analysis.summary, transcript: convo.transcript, transcriptSummary });
          } else if (convo.transcript) {
            return res.status(200).json({ transcript: convo.transcript, transcriptSummary });
          } else {
            return res.status(200).json({ summary: null, transcript: null, transcriptSummary });
          }
        } catch (err) {
          lastError = err.message || err;
          return res.status(500).json({ error: lastError });
        }
      } else {
        lastError = 'No conversations found for agent';
        throw new Error(lastError);
      }
    } catch (err) {
      lastError = err.message || err;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  return res.status(500).json({ error: lastError || 'Timeout waiting for conversation to complete.' });
}