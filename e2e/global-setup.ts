import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import type { FullConfig } from "@playwright/test";
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { createSession } from "../src/services/auth/session";

const AUTH_DIR = path.join(__dirname, ".auth");
const STATE_FILE = path.join(AUTH_DIR, "user.json");
export const SEEDED_USER_FILE = path.join(AUTH_DIR, "seeded-user.json");

/**
 * Runs once before the whole e2e suite. Real WebAuthn registration can't be
 * scripted (passkeys require actual authenticator ceremonies), so this seeds
 * a throwaway member user directly via the same DB/service layer the app
 * itself uses (src/services/auth/session.ts's createSession), then writes a
 * Playwright storageState with that session's real cookie — the same
 * SESSION_COOKIE_NAME src/lib/auth-cookies.ts sets after a real login. Every
 * page load after this is exercising the app's actual auth gate
 * (src/proxy.ts) and real server-rendered/client-hydrated pages, not a
 * mocked-out shortcut.
 */
export default async function globalSetup(config: FullConfig) {
  const db = getDb();

  const [user] = await db
    .insert(users)
    .values({ displayName: "Playwright Smoke User", role: "member" })
    .returning();
  const session = await createSession(db, user.id);

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(SEEDED_USER_FILE, JSON.stringify({ userId: user.id }));

  const storageState = {
    cookies: [
      {
        name: "session",
        value: session.token,
        // Matches whichever host the suite targets: `next dev` on localhost,
        // or PLAYWRIGHT_BASE_URL's host (playwright.config.ts).
        domain: new URL(config.projects[0].use.baseURL ?? "http://localhost").hostname,
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
        expires: Math.floor(session.expiresAt.getTime() / 1000),
      },
    ],
    origins: [],
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(storageState, null, 2));
}
