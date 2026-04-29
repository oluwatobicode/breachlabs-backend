import { Router } from "express";

import {
  submitChallenge,
  listMySubmissions,
  publicSubmissions,
  getAParticularSubmission,
} from "../controllers/submission.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// Submit answers for a challenge (lives under /api/challenges/:id/submit)
router.post("/challenges/:id/submit", requireAuth, submitChallenge);

// Current user's submission history
router.get("/me", requireAuth, listMySubmissions);

// Public gallery of passed submissions
router.get("/public", requireAuth, publicSubmissions);

// One specific submission (with access control)
router.get("/:id", requireAuth, getAParticularSubmission);

export default router;
