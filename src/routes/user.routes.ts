import { Router } from "express";
import { getMe, updateMe, getPublicUserProfile } from "../controllers/user.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { updateMeSchema } from "../types/user.types";

const router = Router();

router.get("/me", requireAuth, getMe);
router.patch("/me", requireAuth, validate(updateMeSchema), updateMe);
router.get("/:username", getPublicUserProfile);

export default router;
