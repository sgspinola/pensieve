import { getDb } from "@/db/client";
import { usersExist } from "@/services/auth/webauthn";
import { LoginForm } from "./LoginForm";
import { Wordmark } from "@/app/Wordmark";
import styles from "@/app/auth-panel.module.css";

export default async function LoginPage() {
  const bootstrap = !(await usersExist(getDb()));

  return (
    <main className={styles.stage}>
      <div className={styles.panel}>
        <h1>
          <Wordmark />
        </h1>
        <hr className={styles.rule} />
        <LoginForm bootstrap={bootstrap} />
      </div>
    </main>
  );
}
