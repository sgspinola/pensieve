import { getDb } from "@/db/client";
import { isInviteRedeemable } from "@/services/auth/invites";
import { InviteForm } from "./InviteForm";
import { Wordmark } from "@/app/Wordmark";
import styles from "@/app/auth-panel.module.css";
import formStyles from "@/app/form-controls.module.css";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const redeemable = await isInviteRedeemable(getDb(), token);

  return (
    <main className={styles.stage}>
      <div className={styles.panel}>
        <h1>
          <Wordmark />
        </h1>
        <hr className={styles.rule} />
        {redeemable ? (
          <InviteForm token={token} />
        ) : (
          <p role="alert" className={formStyles.error}>
            This invite link is invalid, already used, or expired.
          </p>
        )}
      </div>
    </main>
  );
}
