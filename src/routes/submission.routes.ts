import { Router } from "express";

import {
  listMySubmissions,
  publicSubmissions,
  getPublicUserCompletedChallenges,
  listMyChallengeSubmissions,
  getAParticularSubmission,
} from "../controllers/submission.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// Current user's submission history
router.get("/me", requireAuth, listMySubmissions);

// Public gallery of passed submissions
router.get("/public", publicSubmissions);
router.get("/public/users/:username/challenges", getPublicUserCompletedChallenges);

// Current user's submissions for a single challenge
router.get("/challenges/:challengeId/me", requireAuth, listMyChallengeSubmissions);

// One specific submission (with access control)
router.get("/:id", requireAuth, getAParticularSubmission);

export default router;
