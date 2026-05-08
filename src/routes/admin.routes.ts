import { Router } from "express";
import {
  uploadChallengeFile,
  confirmChallengeFile,
  createChallenge,
  updateChallenge,
  deleteChallenge,
  listUsers,
  getAdminStats,
  rebuildLeaderboard,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  updateUserRole,
  updateUserSubscription,
} from "../controllers/admin.controller";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth, requireAdmin);

router.post("/challenge", createChallenge);
router.patch("/challenges/:id", updateChallenge);
router.delete("/challenges/:id", deleteChallenge);

router.post("/challenges/:id/file/presign", uploadChallengeFile);
router.post("/challenges/:id/file/confirm", confirmChallengeFile);

router.post("/challenges/:id/questions", createQuestion);
router.patch("/challenges/:id/questions/:questionId", updateQuestion);
router.delete("/challenges/:id/questions/:questionId", deleteQuestion);

router.get("/users", listUsers);
router.patch("/users/:id/role", updateUserRole);
router.patch("/users/:id/subscription", updateUserSubscription);
router.get("/stats", getAdminStats);

router.post("/leaderboard/rebuild", rebuildLeaderboard);

export default router;
