import { z } from "zod";
import { Domain, Difficulty } from "../generated/prisma/enums";

const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 2000;
const SCENARIO_MAX_LENGTH = 10000;
const OBJECT_ITEM_MAX_LENGTH = 120;
const TOOL_ITEM_MAX_LENGTH = 120;
const QUESTION_TEXT_MAX_LENGTH = 1000;
const ANSWER_KEY_MAX_LENGTH = 500;

const challengeQuestionSchema = z.object({
  text: z.string().min(1).max(QUESTION_TEXT_MAX_LENGTH),
  answerKey: z.string().min(1).max(ANSWER_KEY_MAX_LENGTH),
  order: z.number().finite().int().min(0),
});

export const createChallengeSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX_LENGTH),
    description: z.string().min(1).max(DESCRIPTION_MAX_LENGTH),
    scenario: z.string().min(1).max(SCENARIO_MAX_LENGTH),
    passScore: z.number().finite().int().min(1).max(100).optional(),
    objectives: z.array(z.string().min(1).max(OBJECT_ITEM_MAX_LENGTH)),
    tools: z.array(z.string().min(1).max(TOOL_ITEM_MAX_LENGTH)),
    domain: z.nativeEnum(Domain),
    difficulty: z.nativeEnum(Difficulty),
    isFree: z.boolean().optional(),
    points: z.number().finite().int().min(0).optional(),
    questions: z
      .array(challengeQuestionSchema)
      .min(1, "questions array is required (at least one)")
      .refine(
        (questions) =>
          new Set(questions.map((question) => question.order)).size ===
          questions.length,
        {
          message: "questions must have unique order values",
        },
      ),
  })
  .strict();

export const updateChallengeSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX_LENGTH).optional(),
    description: z.string().min(1).max(DESCRIPTION_MAX_LENGTH).optional(),
    scenario: z.string().min(1).max(SCENARIO_MAX_LENGTH).optional(),
    passScore: z.number().finite().int().min(1).max(100).optional(),
    objectives: z
      .array(z.string().min(1).max(OBJECT_ITEM_MAX_LENGTH))
      .optional(),
    tools: z.array(z.string().min(1).max(TOOL_ITEM_MAX_LENGTH)).optional(),
    domain: z.nativeEnum(Domain).optional(),
    difficulty: z.nativeEnum(Difficulty).optional(),
    isFree: z.boolean().optional(),
    points: z.number().finite().int().min(0).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type CreateChallengeInput = z.infer<typeof createChallengeSchema>;
export type UpdateChallengeInput = z.infer<typeof updateChallengeSchema>;
