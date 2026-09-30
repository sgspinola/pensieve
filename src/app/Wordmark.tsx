import Link from "next/link";
import { LogoMark } from "./LogoMark";
import styles from "./Wordmark.module.css";

export function Wordmark() {
  return (
    <Link href="/" className={styles.wordmark}>
      PENSIEVE
      <LogoMark className={styles.mark} />
    </Link>
  );
}
