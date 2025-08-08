// Serverless function for /api/delete-all
export default async function handler(req, res) {
  // Deletion is disabled in serverless version
  res.status(200).json({ success: true });
}