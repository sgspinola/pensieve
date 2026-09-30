import { createHash } from "node:crypto";

// Shared by anything that stores only the hash of a secret at rest (session
// tokens, recovery codes) so a stolen DB dump can't be replayed as the
// secret itself.
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
