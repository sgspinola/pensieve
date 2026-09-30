"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MarkdownBlock } from "@/app/items/MarkdownBlock";
import type { SerializedFlashcard } from "@/app/flashcards/types";
import { SourceCitation } from "@/app/flashcards/SourceCitation";
import { useFirstRealValue } from "./useFirstRealValue";
import styles from "./Flashcard.module.css";

// Mirrors globals.css's --carousel-duration (also aliased by
// Flashcard.module.css's --flip-duration, which now only paces the
// non-visible face's delayed visibility/hit-testing handoff in CSS — see
// the class doc comment below for why the flip's own rotation moved off
// that custom property) and reused verbatim by StudySession.tsx's viewport
// height animation, so every piece of a card change — height, flip,
// carousel viewport — plays at the same deliberate pace. Motion's
// `transition` config is authored in JS rather than CSS (same as
// FlashcardRow's answer-reveal), so it can't reference the CSS custom
// property directly; kept in sync by convention. Shared by both this file's
// height and flip animations (ticket 04) so they can't drift apart from one
// another either.
const CARD_TRANSITION_DURATION_SECONDS = 0.6;

/**
 * One card, showing its front or back Markdown depending on `flipped`
 * (owned by the parent StudySession, reset to `false` on every card change
 * so a newly-shown card is never accidentally revealed). Flipping itself is
 * triggered externally — the [FLIP] button lives in StudySession's nav row,
 * alongside [PREVIOUS]/[NEXT], not on the card. Swipe/drag navigation is
 * handled entirely by the Embla carousel instance StudySession wires up
 * over the deck — this component has no gesture handling of its own.
 *
 * Flipping is a 3D rotateY transform on a dedicated `.flipCard` element
 * nested inside this root. Both faces are mounted at once (required for the
 * 3D illusion — the back face rotates into view as the front rotates away)
 * with `backface-visibility: hidden`; the CSS also toggles `visibility` on
 * whichever face isn't front-facing (after a matching delay) so it drops
 * out of hit-testing once the flip settles, while `aria-hidden` (set
 * directly off the same `flipped` prop, not off any animation state) keeps
 * the non-visible face out of tab order and away from screen readers the
 * instant `flipped` changes — both carried over unchanged from before
 * ticket 04, so rapid flip input can't desync which face assistive tech
 * sees from which face is visually settled-front.
 *
 * Ticket 04 (motion): `.flipCard` is a `motion.div` whose `rotateY` is
 * animated by Motion (0/180deg) instead of a CSS `transform: rotateY(...)`
 * rule toggled by a `.flipped` class — the class itself is still applied
 * (see `flipCard`'s render below) purely so Flashcard.module.css's static
 * visibility-delay selectors (`.flipCard.flipped > .faceFront`, etc.) still
 * have something to key off; the computed rotation angle itself is now the
 * one thing in this component set exclusively via Motion, never CSS.
 *
 * Ticket 03 (motion): the box's height animates to fit whichever face is
 * currently showing via Motion (`.flipScene` is a `motion.div`) rather than
 * a plain CSS `transition: height` driven by a `--card-height` custom
 * property — replaces the old `deferInitialHeight`/frame-deferred
 * measurement hack entirely. `useReducedMotion` is read explicitly because a
 * JS-driven Motion animation isn't covered by globals.css's blanket
 * `prefers-reduced-motion` media query the way a plain CSS transition is
 * (same reasoning as FlashcardRow's answer-reveal). `onHeightChange` reports
 * every measurement up to the parent StudySession, which uses it (for
 * whichever card is currently selected) to animate the carousel viewport's
 * own height — see StudySession.tsx.
 */
export function Flashcard({
  card,
  flipped,
  onHeightChange,
}: {
  card: SerializedFlashcard;
  flipped: boolean;
  onHeightChange?: (height: number) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const frontFaceRef = useRef<HTMLDivElement>(null);
  const backFaceRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const prefersReducedMotion = useReducedMotion();

  // Lets `animate`'s transition (below) snap the very first real
  // measurement into place instead of visibly growing from the 0 fallback,
  // while every later change (a flip, or swapping to a differently-sized
  // card) still animates normally — see useFirstRealValue's own doc comment.
  // No `reset` needed here: this component mounts fresh per card (see
  // StudySession.tsx's `isMounted &&` conditional), so a new Flashcard
  // instance already starts with `cardHeight === null` on its own.
  const [isFirstMeasurement] = useFirstRealValue(cardHeight, null);

  // Measures the face that's now front-facing so the box always snugly fits
  // whichever side is showing. Both faces are already mounted (required for
  // the 3D flip), so `scrollHeight` can be read directly with no hidden
  // clone. Runs in a layout effect so a flip's remeasurement — and the very
  // first measurement on mount — lands before paint, with Motion (below)
  // owning how the resulting height change is animated rather than this
  // effect deciding whether to visibly flash it.
  useLayoutEffect(() => {
    const activeFace = flipped ? backFaceRef.current : frontFaceRef.current;
    if (!activeFace) return;
    const height = activeFace.scrollHeight;
    setCardHeight(height);
    // `onHeightChange` feeds StudySession.tsx's carousel `.viewport`, which
    // clips (`overflow: hidden`) around the *entire* `.card` — padding and
    // border included, unlike `.flipScene` above, which sits inside that
    // padding and so only ever needs the bare face height. Reporting the
    // bare `height` here would leave the viewport exactly `.card`'s
    // padding+border short, clipping that much off the bottom of whichever
    // face is showing. Padding/border are read fresh off the live element
    // (not hardcoded) so this can't drift from Flashcard.module.css, and
    // they're read synchronously here rather than via `cardRef.current`'s
    // own `offsetHeight` because that reflects `.flipScene`'s *animated*
    // height, which Motion may not have painted yet this frame — padding
    // and border are static regardless of any in-flight height animation.
    const cardEl = cardRef.current;
    if (cardEl) {
      const cardStyle = getComputedStyle(cardEl);
      const chrome =
        parseFloat(cardStyle.paddingTop) +
        parseFloat(cardStyle.paddingBottom) +
        parseFloat(cardStyle.borderTopWidth) +
        parseFloat(cardStyle.borderBottomWidth);
      onHeightChange?.(height + chrome);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped]);

  return (
    <div ref={cardRef} className={styles.card}>
      <motion.div
        className={styles.flipScene}
        // Pre-measurement fallback only — applied via inline style (not a
        // static `min-height` in the CSS module) specifically so it stops
        // applying the instant a real height is known, rather than
        // permanently flooring a genuinely short face's animated height.
        style={cardHeight === null ? { minHeight: "16rem" } : undefined}
        initial={false}
        // A `height` key that only appears in `animate` once measurement
        // completes (i.e. `animate={undefined}` on the very first render,
        // then `animate={{ height }}` on a later one) is never picked up by
        // Motion — it only starts tracking a style key it sees on the FIRST
        // render `animate` is given. So `height` must be present from the
        // very first render onward (falling back to 0 pre-measurement).
        animate={{ height: cardHeight ?? 0 }}
        // That 0 fallback must never itself be visibly animated from —
        // `isFirstMeasurement` (see above) makes the 0-to-real-height jump
        // instant (duration 0) exactly once per mount, the moment real
        // content is first measured, so a newly-shown card is correctly
        // sized immediately with no grow-from-nothing flash. Every later
        // change (a flip, or this same card component measuring a
        // differently-sized face again) still gets the full animated
        // duration, since `isFirstMeasurement` is only ever true for that
        // one post-mount render.
        transition={{
          duration: prefersReducedMotion || isFirstMeasurement ? 0 : CARD_TRANSITION_DURATION_SECONDS,
          ease: "easeInOut",
        }}
      >
        <motion.div
          className={`${styles.flipCard} ${flipped ? styles.flipped : ""}`}
          initial={false}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : CARD_TRANSITION_DURATION_SECONDS, ease: "easeInOut" }}
        >
          <div ref={frontFaceRef} className={`${styles.face} ${styles.faceFront}`} aria-hidden={flipped}>
            <MarkdownBlock source={card.front} isExpanded={true} />
          </div>
          <div ref={backFaceRef} className={`${styles.face} ${styles.faceBack}`} aria-hidden={!flipped}>
            <MarkdownBlock source={card.back} isExpanded={true} />
            {card.tags.length > 0 && (
              <p className={styles.tags}>
                Tags:{" "}
                <span className={styles.tagList}>
                  {card.tags.map((tag) => (
                    <span key={tag} className={styles.tagChip}>
                      {tag}
                    </span>
                  ))}
                </span>
              </p>
            )}
            <SourceCitation source={card.source} className={styles.citation} iconClassName={styles.citationIcon} />
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
