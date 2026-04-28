import { z } from "zod";

export const updateMeSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers and underscores")
    .optional(),
  bio: z.string().max(200, "Bio must be at most 200 characters").optional(),
  avatar: z.string().url("Avatar must be a valid URL").optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
