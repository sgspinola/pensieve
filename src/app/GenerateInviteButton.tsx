"use client";

import { useState } from "react";
import { readErrorMessage } from "@/lib/http-client";
import styles from "@/app/form-controls.module.css";

// Admin-only affordance for the one path by which a second user can join
// the workspace (see spec): generate a single-use link and hand it to the
// new member out of band (Signal, in person, etc.) — there's no
// email-sending capability here or anywhere else in the app.
export function GenerateInviteButton() {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleGenerate() {
    setError(null);
    setPending(true);
    setLink(null);

    try {
      const response = await fetch("/api/admin/invites", { method: "POST" });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const { token } = await response.json();

      setLink(`${window.location.origin}/invite/${token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate invite");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button className={styles.button} onClick={handleGenerate} disabled={pending}>
        Generate invite link
      </button>
      {link && (
        <p>
          Share this link with the new member — it can only be used once:{" "}
          <code>{link}</code>
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
