import { z } from "zod";

export const recoverOptionsBodySchema = z.object({
  code: z.string().trim().min(1, "code is required"),
});

export type RecoverOptionsBody = z.infer<typeof recoverOptionsBodySchema>;
