import express, { Router, type Request, type Response } from "express";
import { Webhook } from "svix";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { env } from "../config/env";
import {
  syncUserCreated,
  syncUserUpdated,
  syncUserDeleted,
} from "../services/clerk.service";
import {
  handleSubscriptionActivated,
  handleSubscriptionUpdated,
  handleSubscriptionRevoked,
} from "../services/polar-webhook.service";

const router = Router();

// raw body is required for svix signature verification
router.post(
  "/clerk",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
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
  },
);

router.post(
  "/polar",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    let event;
    try {
      event = validateEvent(
        req.body,
        req.headers as Record<string, string>,
        env.POLAR_WEBHOOK_SECRET,
      );
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        console.error("Polar webhook verification failed:", err.message);
        res.status(400).json({ message: err.message });
        return;
      }
      throw err;
    }

    try {
      switch (event.type) {
        case "subscription.created":
        case "subscription.active":
          await handleSubscriptionActivated(event.data);
          break;
        case "subscription.updated":
        case "subscription.canceled":
          await handleSubscriptionUpdated(event.data);
          break;
        case "subscription.revoked":
          await handleSubscriptionRevoked(event.data);
          break;
        default:
          console.log("Unhandled Polar event:", event.type);
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("Polar webhook error:", err);
      res.status(500).json({ message: "Failed to process webhook" });
    }
  },
);

export default router;
