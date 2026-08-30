import cors from "cors";
import express from "express";

import { authRoutes } from "./routes/authRoutes.js";
import { documentRoutes } from "./routes/documentRoutes.js";

export const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);

// Centralized error handler — every asyncHandler-wrapped route funnels
// unhandled errors here instead of each controller formatting its own 500.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});
