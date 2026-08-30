import { Router } from "express";

import { login, me, register } from "../controllers/authController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const authRoutes = Router();

authRoutes.post("/register", asyncHandler(register));
authRoutes.post("/login", asyncHandler(login));
authRoutes.get("/me", requireAuth, asyncHandler(me));
