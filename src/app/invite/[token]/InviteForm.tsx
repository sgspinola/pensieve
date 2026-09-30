"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RecoveryCodesDisplay } from "@/app/RecoveryCodesDisplay";
import { readErrorMessage } from "@/lib/http-client";
import styles from "@/app/form-controls.module.css";

export function InviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [issuedRecoveryCodes, setIssuedRecoveryCodes] = useState<string[] | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const optionsResponse = await fetch("/api/auth/invite/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, displayName }),
      });
      if (!optionsResponse.ok) throw new Error(await readErrorMessage(optionsResponse));
      const optionsJSON = await optionsResponse.json();

      const response = await startRegistration({ optionsJSON });

      const verifyResponse = await fetch("/api/auth/invite/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, displayName }),
      });
      if (!verifyResponse.ok) throw new Error(await readErrorMessage(verifyResponse));
      const { recoveryCodes } = await verifyResponse.json();

      // Recovery codes are only ever returned here, once — hold the
      // redirect until the invitee has acknowledged them.
      setIssuedRecoveryCodes(recoveryCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setPending(false);
    }
  }

  if (issuedRecoveryCodes) {
    return (
      <RecoveryCodesDisplay
        codes={issuedRecoveryCodes}
        onContinue={() => {
          router.push("/");
          router.refresh();
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className={styles.hint}>You&apos;ve been invited to join Pensieve. Register a passkey to create your account.</p>
      <input
        className={styles.field}
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        placeholder="Display name"
        required
      />
      <button className={styles.button} type="submit" disabled={pending}>
        Accept invite
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </form>
  );
}
