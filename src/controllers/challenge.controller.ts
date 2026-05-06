import { NextFunction, Request, Response } from "express";
import { sendError, sendSuccess } from "../utils/ApiResponse";
import { prisma } from "../config/db.config";
import { getDownloadUrl } from "../services/s3.service";
import { Domain, Difficulty } from "../generated/prisma/enums";
import { Prisma } from "../generated/prisma/client";
import { normalize } from "../utils/normalize.utils";
import { createSubmissionWithRetry } from "../utils/retrySubmit.utils";
import { sanitizeSearchTerm } from "../utils/search.utils";
import { hasActiveProAccess } from "../utils/subscription.utils";
import { SubmittedAnswer } from "../types/submission.types";
import {
  recomputeUserPoints,
  syncUserToLeaderboard,
} from "../services/redis.service";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
} from "../config/constants.config";

const SORT_MAP = {
  newest: { createdAt: "desc" as const },
  oldest: { createdAt: "asc" as const },
  "points-asc": { points: "asc" as const },
  "points-desc": { points: "desc" as const },
};

// Page-based pagination: users browse a filtered catalog and may jump to page N directly.
// Cursor-based would be better for infinite-scroll feeds; offset is the right call for a
// filterable explore page where total count and page numbers are useful to the UI.
export const listChallenges = async (
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

    // --- Sort ---
    const sortKey =
      typeof req.query.sort === "string" ? req.query.sort : "newest";
    if (!(sortKey in SORT_MAP)) {
      return sendError(
        res,
        400,
        `sort must be one of: ${Object.keys(SORT_MAP).join(", ")}`,
      );
    }
    const orderBy = SORT_MAP[sortKey as keyof typeof SORT_MAP];

    // --- Filters ---
    const { domain, difficulty, isFree, search } = req.query;
    const where: Prisma.ChallengeWhereInput = { deletedAt: null };

    if (domain && typeof domain === "string") {
      if (!Object.values(Domain).includes(domain as Domain)) {
        return sendError(
          res,
          400,
          `domain must be one of: ${Object.values(Domain).join(", ")}`,
        );
      }
      where.domain = domain as Domain;
    }

    if (difficulty && typeof difficulty === "string") {
      if (!Object.values(Difficulty).includes(difficulty as Difficulty)) {
        return sendError(
          res,
          400,
          `difficulty must be one of: ${Object.values(Difficulty).join(", ")}`,
        );
      }
      where.difficulty = difficulty as Difficulty;
    }

    if (typeof isFree === "string" && isFree !== "") {
      if (isFree !== "true" && isFree !== "false") {
        return sendError(res, 400, "isFree must be 'true' or 'false'");
      }
      where.isFree = isFree === "true";
    }

    if (search && typeof search === "string") {
      const sanitizedSearch = sanitizeSearchTerm(search);
      if (sanitizedSearch) {
        where.OR = [
          { title: { contains: sanitizedSearch, mode: "insensitive" } },
          {
            description: {
              contains: sanitizedSearch,
              mode: "insensitive",
            },
          },
        ];
      }
    }

    const skip = (page - 1) * limit;
    if (skip > MAX_OFFSET) {
      return sendError(res, 400, "Requested page is too large");
    }

    const [challenges, total] = await prisma.$transaction([
      prisma.challenge.findMany({
        select: {
          id: true,
          title: true,
          description: true,
          domain: true,
          difficulty: true,
          isFree: true,
          points: true,
        },
        orderBy,
        skip,
        take: limit,
        where,
      }),
      prisma.challenge.count({ where }),
    ]);

    const completedRows = req.user
      ? await prisma.submission.findMany({
          where: {
            userId: req.user.id,
            passed: true,
            challengeId: { in: challenges.map((c) => c.id) },
          },
          select: { challengeId: true },
          distinct: ["challengeId"],
        })
      : [];
    const completedSet = new Set(completedRows.map((r) => r.challengeId));

    const challengesWithCompletion = challenges.map((c) => ({
      ...c,
      completed: completedSet.has(c.id),
    }));

    const totalPages = Math.ceil(total / limit);

    return res.json({
      challenges: challengesWithCompletion,
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

export const getChallengeById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        scenario: true,
        domain: true,
        difficulty: true,
        passScore: true,
        objectives: true,
        tools: true,
        isFree: true,
        points: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        questions: {
          select: { id: true, text: true, order: true },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!challenge || challenge.deletedAt) {
      return sendError(res, 404, "Challenge not found");
    }

    if (!challenge.isFree && !hasActiveProAccess(req.user)) {
      return sendError(res, 403, "This challenge requires a PRO subscription");
    }

    const { deletedAt, ...rest } = challenge;
    return res.json({ challenge: rest });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

export const downloadChallengeFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const challenge = await prisma.challenge.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        fileKey: true,
        isFree: true,
      },
    });

    if (!challenge) {
      return sendError(res, 404, "Challenge not found");
    }

    if (!challenge.fileKey) {
      return sendError(res, 404, "Challenge has no file uploaded yet");
    }

    // Access check: paid challenges require PRO subscription
    if (!challenge.isFree) {
      // req.user is set by requireAuth middleware
      if (!hasActiveProAccess(req.user)) {
        return sendError(
          res,
          403,
          "This challenge requires a PRO subscription",
        );
      }
    }

    // Build a friendly download filename
    const safeTitle = challenge.title.replace(/[^a-zA-Z0-9._-]/g, "_");
    const downloadFilename = `${safeTitle}.zip`;

    const downloadUrl = await getDownloadUrl(
      challenge.fileKey,
      downloadFilename,
    );

    return res.json({
      downloadUrl,
      expiresIn: 600,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

/**
 * Normalize answer text for comparison: lowercase + trim whitespace.
 * Both userAnswer and answerKey go through this before string compare.
 */

/*     Submit Challenge     */

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
    const submittedQuestionIds = submitted.map((answer) => answer.questionId);

    if (new Set(submittedQuestionIds).size !== submittedQuestionIds.length) {
      return sendError(res, 400, "Duplicate questionIds are not allowed");
    }

    if (typeof reportUrl === "string") {
      if (reportUrl.length > 2048) {
        return sendError(res, 400, "reportUrl is too long");
      }

      try {
        new URL(reportUrl);
      } catch {
        return sendError(res, 400, "reportUrl must be a valid URL");
      }
    }

    // --- Fetch challenge + questions (server-side answerKey access only) ---
    const challenge = await prisma.challenge.findFirst({
      where: { id, deletedAt: null },
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
    const hasProAccess = hasActiveProAccess(req.user);

    if (!challenge.isFree && !hasProAccess) {
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
    const submission = await createSubmissionWithRetry({
      userId: req.user!.id,
      challengeId: id,
      answers: submitted,
      reportUrl: typeof reportUrl === "string" ? reportUrl : null,
      score,
      passed,
      hasProAccess,
    });

    if (passed) {
      try {
        const points = await recomputeUserPoints(req.user!.id);
        await syncUserToLeaderboard(req.user!.id, points, {
          username: req.user!.username,
          avatar: req.user!.avatar,
        });
      } catch (error) {
        console.error("Failed to sync leaderboard after submission:", error);
      }
    }

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
