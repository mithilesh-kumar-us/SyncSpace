import jwt from "jsonwebtoken";

// Attaches req.userId when a valid JWT is present; rejects otherwise. Every
// route that needs a logged-in user goes through this once, rather than
// each controller parsing the header itself.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header." });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}
