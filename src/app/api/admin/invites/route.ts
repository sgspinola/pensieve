import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/current-user";
import { withErrorHandling } from "@/lib/api-errors";
import { createInvite } from "@/services/auth/invites";

// Not in src/proxy.ts's public-path allowlist, so this route is only
// reachable with a valid session already; createInvite additionally
// verifies that session's user is the admin, since the service layer (not
// this route) owns permission checks.
export const POST = withErrorHandling(async () => {
  const actor = await getCurrentUser();
  const invite = await createInvite(getDb(), actor.id);

  return NextResponse.json(invite);
});
