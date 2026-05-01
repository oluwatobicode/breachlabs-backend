import { Router } from "express";
import { listChallenges, getChallengeById, downloadChallengeFile } from "../controllers/challenge.controller";
import { optionalAuth, requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/", optionalAuth, listChallenges);
router.get("/:id", optionalAuth, getChallengeById);
router.get("/:id/download", requireAuth, downloadChallengeFile);

export default router;
