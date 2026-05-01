import { Router } from "express";
import {
  uploadChallengeFile,
  confirmChallengeFile,
  createChallenge,
  updateChallenge,
  deleteChallenge,
  listUsers,
  getAdminStats,
} from "../controllers/admin.controller";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth, requireAdmin);

router.post("/challenge", createChallenge);
router.patch("/challenges/:id", updateChallenge);
router.delete("/challenges/:id", deleteChallenge);

router.post("/challenges/:id/file/presign", uploadChallengeFile);
router.post("/challenges/:id/file/confirm", confirmChallengeFile);

router.get("/users", listUsers);
router.get("/stats", getAdminStats);

export default router;
