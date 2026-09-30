import { z } from "zod";

export const registerOptionsBodySchema = z.object({
  displayName: z.string().trim().min(1, "displayName is required"),
});

export type RegisterOptionsBody = z.infer<typeof registerOptionsBodySchema>;
