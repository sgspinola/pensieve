import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/current-user";
import { listTags } from "@/services/tags/tags";
import { Header } from "@/app/Header";
import { Wordmark } from "@/app/Wordmark";
import { FlashcardForm } from "../FlashcardForm";
import shellStyles from "@/app/page-shell.module.css";
import sectionStyles from "@/app/items/ItemsLibrary.module.css";

export default async function AddFlashcardPage() {
  const user = await requireCurrentUser();

  const tagSuggestions = await listTags(getDb());

  return (
    <main className={`${shellStyles.shell} ${shellStyles.wide}`}>
      <h1>
        <Wordmark />
      </h1>
      <Header user={user} />
      <section className={sectionStyles.section}>
        <h2 className={sectionStyles.heading}>Add a flashcard</h2>
        <FlashcardForm mode={{ kind: "create" }} tagSuggestions={tagSuggestions} />
      </section>
    </main>
  );
}
