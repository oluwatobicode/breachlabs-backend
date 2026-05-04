import type { Request, Response } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

const rateLimitHandler =
  (message: string) => (_req: Request, res: Response) => {
    res.status(429).json({ success: false, message });
  };

const userOrIpKey = (req: Request) => {
  if (req.user?.id) return req.user.id;
  return req.ip ? ipKeyGenerator(req.ip) : "unknown";
};

export const submitChallengeRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: rateLimitHandler("Too many submissions. Please try again later."),
});

export const downloadChallengeFileRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: rateLimitHandler(
    "Too many download requests. Please try again in a minute.",
  ),
});

export const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Too many webhook requests. Please try again."),
});
