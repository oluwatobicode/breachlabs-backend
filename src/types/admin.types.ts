import { z } from "zod";
import { Domain, Difficulty } from "../generated/prisma/enums";

export const updateChallengeSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    scenario: z.string().min(1).optional(),
    passScore: z.number().int().min(1).max(100).optional(),
    objectives: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    domain: z.enum(Object.values(Domain) as [string, ...string[]]).optional(),
    difficulty: z
      .enum(Object.values(Difficulty) as [string, ...string[]])
      .optional(),
    isFree: z.boolean().optional(),
    points: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateChallengeInput = z.infer<typeof updateChallengeSchema>;
