import { Router } from "express";
import {
  uploadChallengeFile,
  confirmChallengeFile,
  createChallenge,
} from "../controllers/admin.controller";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware";

const router = Router();

router.post("/challenge", requireAuth, requireAdmin, createChallenge);

router.post(
  "/challenges/:id/file/presign",
  requireAuth,
  requireAdmin,
  uploadChallengeFile,
);

router.post(
  "/challenges/:id/file/confirm",
  requireAuth,
  requireAdmin,
  confirmChallengeFile,
);

export default router;
