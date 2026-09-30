"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { readErrorMessage } from "@/lib/http-client";
import { RecoveryCodesDisplay } from "@/app/RecoveryCodesDisplay";
import styles from "@/app/form-controls.module.css";

export function LoginForm({ bootstrap }: { bootstrap: boolean }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [issuedRecoveryCodes, setIssuedRecoveryCodes] = useState<string[] | null>(null);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const optionsResponse = await fetch("/api/auth/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (!optionsResponse.ok) throw new Error(await readErrorMessage(optionsResponse));
      const optionsJSON = await optionsResponse.json();

      const response = await startRegistration({ optionsJSON });

      const verifyResponse = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, displayName }),
      });
      if (!verifyResponse.ok) throw new Error(await readErrorMessage(verifyResponse));
      const { recoveryCodes } = await verifyResponse.json();

      // Recovery codes are only ever returned here, once — hold the redirect
      // until the user has acknowledged them.
      setIssuedRecoveryCodes(recoveryCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setPending(false);
    }
  }

  async function handleLogin() {
    setError(null);
    setPending(true);

    try {
      const optionsResponse = await fetch("/api/auth/login/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) throw new Error(await readErrorMessage(optionsResponse));
      const optionsJSON = await optionsResponse.json();

      const response = await startAuthentication({ optionsJSON });

      const verifyResponse = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      if (!verifyResponse.ok) throw new Error(await readErrorMessage(verifyResponse));

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  async function handleRecover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const optionsResponse = await fetch("/api/auth/recover/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: recoveryCode }),
      });
      if (!optionsResponse.ok) throw new Error(await readErrorMessage(optionsResponse));
      const optionsJSON = await optionsResponse.json();

      const response = await startRegistration({ optionsJSON });

      const verifyResponse = await fetch("/api/auth/recover/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      if (!verifyResponse.ok) throw new Error(await readErrorMessage(verifyResponse));

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed");
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

  if (bootstrap) {
    return (
      <form onSubmit={handleRegister}>
        <p className={styles.hint}>No account exists yet. Register a passkey to create the admin account.</p>
        <input
          className={styles.field}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Display name"
          required
        />
        <button className={styles.button} type="submit" disabled={pending}>
          Create admin account
        </button>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </form>
    );
  }

  if (recovering) {
    return (
      <form onSubmit={handleRecover}>
        <p className={styles.hint}>Enter a saved recovery code to log in and register a new passkey.</p>
        <input
          className={styles.field}
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
          placeholder="Recovery code"
          required
        />
        <button className={styles.button} type="submit" disabled={pending}>
          Recover account
        </button>
        <button
          className={styles.buttonSecondary}
          type="button"
          onClick={() => {
            setRecovering(false);
            setError(null);
          }}
        >
          Back to login
        </button>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div>
      <button className={styles.button} onClick={handleLogin} disabled={pending}>
        Log in with passkey
      </button>
      <button className={styles.buttonSecondary} type="button" onClick={() => setRecovering(true)}>
        Lost your passkey?
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
