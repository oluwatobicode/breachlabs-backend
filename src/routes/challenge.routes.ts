import { Router } from "express";
import { listChallenges, downloadChallengeFile } from "../controllers/challenge.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/", requireAuth, listChallenges);
router.get("/:id/download", requireAuth, downloadChallengeFile);

export default router;
