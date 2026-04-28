import express, { Router, type Request, type Response } from "express";
import { Webhook } from "svix";
import { env } from "../config/env";
import {
  syncUserCreated,
  syncUserUpdated,
  syncUserDeleted,
} from "../services/clerk.service";

const router = Router();

// raw body is required for svix signature verification
router.post("/clerk", express.raw({ type: "application/json" }), async (req: Request, res: Response) => {
  const svixId = req.headers["svix-id"] as string;
  const svixTimestamp = req.headers["svix-timestamp"] as string;
  const svixSignature = req.headers["svix-signature"] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    res.status(400).json({ message: "Missing svix headers" });
    return;
  }

  const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
  let event: { type: string; data: any };

  try {
    event = wh.verify(req.body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as typeof event;
  } catch {
    res.status(400).json({ message: "Invalid webhook signature" });
    return;
  }

  try {
    switch (event.type) {
      case "user.created":
        await syncUserCreated(event.data);
        break;
      case "user.updated":
        await syncUserUpdated(event.data);
        break;
      case "user.deleted":
        await syncUserDeleted(event.data);
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Clerk webhook error:", err);
    res.status(500).json({ message: "Failed to process webhook" });
  }
});

export default router;
