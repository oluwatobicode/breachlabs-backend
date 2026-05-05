import { Router } from "express";
import {
  listChallenges,
  getChallengeById,
  downloadChallengeFile,
  submitChallenge,
} from "../controllers/challenge.controller";
import { optionalAuth, requireAuth } from "../middleware/auth.middleware";
import {
  downloadChallengeFileRateLimit,
  submitChallengeRateLimit,
} from "../middleware/rateLimit.middleware";

const router = Router();

router.get("/", optionalAuth, listChallenges);
router.get("/:id", optionalAuth, getChallengeById);
router.get(
  "/:id/download",
  requireAuth,
  downloadChallengeFileRateLimit,
  downloadChallengeFile,
);
// Submit answers for a challenge
router.post(
  "/:id/submit",
  requireAuth,
  submitChallengeRateLimit,
  submitChallenge,
);

export default router;
