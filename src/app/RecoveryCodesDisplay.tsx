"use client";

import buttonStyles from "@/app/form-controls.module.css";
import styles from "./RecoveryCodesDisplay.module.css";

// Shared by every flow that issues one-time recovery codes at
// passkey-registration time (bootstrap admin registration, invite-based
// member registration) — the display is identical regardless of which
// ceremony produced the codes.
export function RecoveryCodesDisplay({
  codes,
  onContinue,
}: {
  codes: string[];
  onContinue: () => void;
}) {
  return (
    <div className={styles.panel}>
      <p className={styles.hint}>
        Save these recovery codes somewhere safe. Each one can be used once to
        log back in if you lose access to this passkey — they won&apos;t be
        shown again.
      </p>
      <ul className={styles.codeList}>
        {codes.map((code) => (
          <li key={code}>
            <code className={styles.code}>{code}</code>
          </li>
        ))}
      </ul>
      <button className={buttonStyles.button} onClick={onContinue}>
        I&apos;ve saved my codes, continue
      </button>
    </div>
  );
}
