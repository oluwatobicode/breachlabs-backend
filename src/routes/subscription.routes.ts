import { Router } from "express";
import {
  createCheckout,
  getPortalUrl,
} from "../controllers/subscription.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/checkout", requireAuth, createCheckout);
router.get("/portal", requireAuth, getPortalUrl);

export default router;
