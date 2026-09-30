import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import { getLogger } from "@/lib/logging";
import { UnauthorizedError } from "@/services/errors";
import { logMutationFailure, logMutationSuccess } from "@/services/mutation-log";

const logger = getLogger(["pensieve", "session"]);
const ENTITY = "sessions";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface SessionUser {
  id: string;
  displayName: string;
  role: "admin" | "member";
}

export interface Session {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: Database,
  userId: string,
): Promise<Session> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const id = sha256Hex(token);

  try {
    await db.insert(sessions).values({ id, userId, expiresAt });
    logMutationSuccess(logger, "Session created", { entity: ENTITY, entityId: id });
    return { token, expiresAt };
  } catch (error) {
    logMutationFailure(logger, "Session creation failed", { entity: ENTITY }, error);
    throw error;
  }
}

/**
 * Resolves a session token to its user, throwing UnauthorizedError for any
 * missing/unknown/expired token. This is the service-layer choke point every
 * protected call goes through, so the global auth gate has one place to ask
 * "is this request authenticated?"
 */
export async function getSessionUser(
  db: Database,
  token: string | undefined | null,
): Promise<SessionUser> {
  if (!token) {
    throw new UnauthorizedError("No session token provided");
  }

  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sha256Hex(token)));

  if (!row || row.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Session is invalid or expired");
  }

  return { id: row.id, displayName: row.displayName, role: row.role };
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  const id = sha256Hex(token);
  try {
    await db.delete(sessions).where(eq(sessions.id, id));
    logMutationSuccess(logger, "Session deleted", { entity: ENTITY, entityId: id });
  } catch (error) {
    logMutationFailure(logger, "Session deletion failed", { entity: ENTITY, entityId: id }, error);
    throw error;
  }
}
