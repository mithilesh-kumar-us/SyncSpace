import jwt from "jsonwebtoken";

import { User } from "../models/User.js";

const TOKEN_TTL = "7d"; // V1 has no refresh-token rotation yet — a single, longer-lived access token

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export async function register(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password, and name are all required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const passwordHash = await User.hashPassword(password);
  try {
    const user = await User.create({ email, passwordHash, name });
    res.status(201).json({ user, token: issueToken(user) });
  } catch (err) {
    // The findOne check above has a race: two concurrent registrations for
    // the same email can both pass it before either finishes creating. The
    // schema's unique index is the actual guarantee; this just turns that
    // race's failure mode into the same clean 409 instead of a generic 500.
    if (err.code === 11000) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    throw err;
  }
}

export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  const valid = user && (await user.verifyPassword(password));
  if (!valid) {
    // Deliberately the same message whether the email doesn't exist or the
    // password is wrong — distinguishing the two lets an attacker enumerate
    // registered emails.
    return res.status(401).json({ error: "Invalid email or password." });
  }

  res.json({ user, token: issueToken(user) });
}

export async function me(req, res) {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user });
}
