import { Router } from "express";
import { getLeaderBoard } from "../controllers/leaderboard.controller";
import { optionalAuth } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/", optionalAuth, getLeaderBoard);

export default router;
