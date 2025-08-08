// Serverless function for /api/verify-password
export default async function handler(req, res) {
  const { password } = req.body;
  const correctPassword = process.env.WEBSITE_PASSWORD;
  if (!correctPassword) {
    return res.status(500).json({ error: "Password not configured" });
  }
  if (password === correctPassword) {
    res.status(200).json({ success: true });
  } else {
    res.status(401).json({ error: "Incorrect password" });
  }
}