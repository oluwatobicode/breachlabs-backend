import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/db.config";
import { sendError, sendSuccess } from "../utils/ApiResponse";
import { Prisma } from "../generated/prisma/client";
import { SubscriptionStatus } from "../generated/prisma/enums";
import { SubmittedAnswer } from "../types/submission.types";
import {
  DEFAULT_LIMIT,
  FREE_ATTEMPT_LIMIT,
  MAX_LIMIT,
} from "../config/constants.config";
import { normalize } from "../utils/normalize.utils";

/**
 * Normalize answer text for comparison: lowercase + trim whitespace.
 * Both userAnswer and answerKey go through this before string compare.
 */

/* -------------------------------------------------------------------------- */
/*                              Submit Challenge                              */
/* -------------------------------------------------------------------------- */

export const submitChallenge = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const { answers, reportUrl } = req.body as {
      answers: unknown;
      reportUrl?: unknown;
    };

    // --- Validate request body ---
    if (!Array.isArray(answers) || answers.length === 0) {
      return sendError(res, 400, "answers must be a non-empty array");
    }

    for (const [i, a] of answers.entries()) {
      if (
        !a ||
        typeof a !== "object" ||
        typeof (a as any).questionId !== "string" ||
        typeof (a as any).answer !== "string"
      ) {
        return sendError(
          res,
          400,
          `answers[${i}] must have shape { questionId: string, answer: string }`,
        );
      }
    }

    if (reportUrl !== undefined && typeof reportUrl !== "string") {
      return sendError(res, 400, "reportUrl must be a string if provided");
    }

    const submitted = answers as SubmittedAnswer[];

    // --- Fetch challenge + questions (server-side answerKey access only) ---
    const challenge = await prisma.challenge.findUnique({
      where: { id },
      select: {
        id: true,
        isFree: true,
        points: true,
        passScore: true,
        questions: {
          select: { id: true, text: true, answerKey: true, order: true },
        },
      },
    });

    if (!challenge) {
      return sendError(res, 404, "Challenge not found");
    }

    // --- Access check: paid challenges require PRO ---
    if (
      !challenge.isFree &&
      req.user!.subscriptionStatus !== SubscriptionStatus.PRO
    ) {
      return sendError(res, 403, "This challenge requires a PRO subscription");
    }

    // --- Validate every question is answered, no extras ---
    const questionIds = new Set(challenge.questions.map((q) => q.id));
    const submittedIds = new Set(submitted.map((a) => a.questionId));

    for (const qid of submittedIds) {
      if (!questionIds.has(qid)) {
        return sendError(res, 400, `unknown questionId: ${qid}`);
      }
    }

    for (const q of challenge.questions) {
      if (!submittedIds.has(q.id)) {
        return sendError(res, 400, `missing answer for question: ${q.id}`);
      }
    }

    // --- Attempt cap for FREE users ---
    const previousAttempts = await prisma.submission.count({
      where: { userId: req.user!.id, challengeId: id },
    });

    if (
      req.user!.subscriptionStatus !== SubscriptionStatus.PRO &&
      previousAttempts >= FREE_ATTEMPT_LIMIT
    ) {
      return sendError(
        res,
        403,
        `Free users limited to ${FREE_ATTEMPT_LIMIT} attempts per challenge. Upgrade to PRO for unlimited tries.`,
      );
    }

    // --- Grade ---
    const submittedMap = new Map(
      submitted.map((a) => [a.questionId, a.answer]),
    );

    const breakdown = challenge.questions
      .sort((a, b) => a.order - b.order)
      .map((q) => {
        const userAnswer = submittedMap.get(q.id) ?? "";
        const correct = normalize(userAnswer) === normalize(q.answerKey);
        return {
          questionId: q.id,
          text: q.text,
          userAnswer,
          correct,
          // NOTE: not exposing correctAnswer — keeps retries meaningful
        };
      });

    const correctCount = breakdown.filter((b) => b.correct).length;
    const totalQuestions = challenge.questions.length;
    const ratio = correctCount / totalQuestions;
    const score = Math.round(ratio * challenge.points);
    // passScore is the per-challenge pass threshold as a percentage (1-100);
    // fall back to 70 for legacy rows where the column is null.
    const passed = ratio >= (challenge.passScore ?? 70) / 100;

    // --- Persist ---
    const submission = await prisma.submission.create({
      data: {
        userId: req.user!.id,
        challengeId: id,
        answers: submitted as unknown as Prisma.InputJsonValue,
        score,
        passed,
        attemptNumber: previousAttempts + 1,
        reportUrl: typeof reportUrl === "string" ? reportUrl : null,
      },
      select: {
        id: true,
        score: true,
        passed: true,
        attemptNumber: true,
        createdAt: true,
      },
    });

    return sendSuccess(res, "Submission graded", 201, {
      submission,
      correctCount,
      totalQuestions,
      breakdown,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

/* -------------------------------------------------------------------------- */
/*                            List My Submissions                             */
/* -------------------------------------------------------------------------- */

export const listMySubmissions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // --- Pagination ---
    const rawPage = req.query.page;
    const rawLimit = req.query.limit;
    const page = typeof rawPage === "string" ? Number(rawPage) : 1;
    const limit =
      typeof rawLimit === "string" ? Number(rawLimit) : DEFAULT_LIMIT;

    if (!Number.isInteger(page) || page < 1) {
      return sendError(res, 400, "page must be a positive integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return sendError(res, 400, `limit must be between 1 and ${MAX_LIMIT}`);
    }

    // --- Filters ---
    const where: Prisma.SubmissionWhereInput = { userId: req.user!.id };

    const { challengeId, passed } = req.query;

    if (typeof challengeId === "string" && challengeId !== "") {
      where.challengeId = challengeId;
    }

    if (typeof passed === "string" && passed !== "") {
      if (passed !== "true" && passed !== "false") {
        return sendError(res, 400, "passed must be 'true' or 'false'");
      }
      where.passed = passed === "true";
    }

    const skip = (page - 1) * limit;

    const [submissions, total] = await prisma.$transaction([
      prisma.submission.findMany({
        where,
        select: {
          id: true,
          score: true,
          passed: true,
          attemptNumber: true,
          reportUrl: true,
          createdAt: true,
          challenge: {
            select: {
              id: true,
              title: true,
              domain: true,
              difficulty: true,
              points: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.submission.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return sendSuccess(res, "Fetched submissions", 200, {
      submissions,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

/* Public Submissions */

export const publicSubmissions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // --- Pagination ---
    const rawPage = req.query.page;
    const rawLimit = req.query.limit;
    const page = typeof rawPage === "string" ? Number(rawPage) : 1;
    const limit =
      typeof rawLimit === "string" ? Number(rawLimit) : DEFAULT_LIMIT;

    if (!Number.isInteger(page) || page < 1) {
      return sendError(res, 400, "page must be a positive integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return sendError(res, 400, `limit must be between 1 and ${MAX_LIMIT}`);
    }

    // --- Filters ---
    // Only passed submissions are public — failed attempts stay private.
    const where: Prisma.SubmissionWhereInput = { passed: true };

    const { challengeId } = req.query;
    if (typeof challengeId === "string" && challengeId !== "") {
      where.challengeId = challengeId;
    }

    const skip = (page - 1) * limit;

    const [submissions, total] = await prisma.$transaction([
      prisma.submission.findMany({
        where,
        // CRITICAL: never expose `answers` here — that would let users copy solutions
        select: {
          id: true,
          score: true,
          attemptNumber: true,
          createdAt: true,
          challenge: {
            select: {
              id: true,
              title: true,
              domain: true,
              difficulty: true,
              points: true,
            },
          },
          user: {
            select: { id: true, username: true, avatar: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.submission.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return sendSuccess(res, "Fetched public submissions", 200, {
      submissions,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

/* Get a Particular Submission  */

export const getAParticularSubmission = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    // First, light fetch to check ownership + passed status
    const meta = await prisma.submission.findUnique({
      where: { id },
      select: { userId: true, passed: true },
    });

    if (!meta) {
      return sendError(res, 404, "Submission not found");
    }

    const isOwner = meta.userId === req.user!.id;

    // Failed submissions are private — only owner can see
    if (!isOwner && !meta.passed) {
      return sendError(res, 403, "This submission is private");
    }

    // Owner gets full detail (including their answers).
    // Non-owner viewing a passed submission gets the public view (no answers).
    const submission = await prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        score: true,
        passed: true,
        attemptNumber: true,
        reportUrl: true,
        createdAt: true,
        ...(isOwner && { answers: true }),
        challenge: {
          select: {
            id: true,
            title: true,
            domain: true,
            difficulty: true,
            points: true,
          },
        },
        user: {
          select: { id: true, username: true, avatar: true },
        },
      },
    });

    return sendSuccess(res, "Fetched submission", 200, submission);
  } catch (error) {
    console.log(error);
    next(error);
  }
};
