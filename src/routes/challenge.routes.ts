import { Router } from "express";
import {
  listChallenges,
  getChallengeById,
  downloadChallengeFile,
} from "../controllers/challenge.controller";
import { optionalAuth, requireAuth } from "../middleware/auth.middleware";
import { downloadChallengeFileRateLimit } from "../middleware/rateLimit.middleware";

const router = Router();

router.get("/", optionalAuth, listChallenges);
router.get("/:id", optionalAuth, getChallengeById);
router.get(
  "/:id/download",
  requireAuth,
  downloadChallengeFileRateLimit,
  downloadChallengeFile,
);

export default router;
