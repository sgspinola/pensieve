import { z } from "zod";

export const inviteOptionsBodySchema = z.object({
  token: z.string().trim().min(1, "token is required"),
  displayName: z.string().trim().min(1, "displayName is required"),
});

export type InviteOptionsBody = z.infer<typeof inviteOptionsBodySchema>;
