"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Space } from "lucide-react";
import { toggleTagChip } from "@/app/items/chip-filters";
import { TagCloud } from "@/app/TagCloud";
import { TagFilterInput } from "@/app/TagFilterInput";
import type { SerializedFlashcard } from "@/app/flashcards/types";
import { advanceIndex, buildDeck, filterFlashcardsByTags, resolveStudyKeyAction, type AdvanceDirection } from "./deck";
import { Flashcard } from "./Flashcard";
import { useFirstRealValue } from "./useFirstRealValue";
import styles from "./StudySession.module.css";

type Stage = "selecting" | "studying" | "completed";

// Non-looping Embla structurally can't scroll past the last slide (no
// out-of-bounds snap point exists for it to land on), so a swipe release
// there never fires a `select` event the way an in-bounds swipe does. This
// threshold-based release check is the one narrow exception to "Embla owns
// navigation": it only ever runs while already sitting on the last card
// (`!emblaApi.canScrollNext()`), purely to decide whether to bypass the
// carousel and finish the session the same way [NEXT]/ArrowRight do there —
// it never drives any visual motion of its own (that stays 100% Embla's), so
// it doesn't duplicate the drag-to-follow-the-finger behavior deleted from
// Flashcard.tsx.
const BOUNDARY_SWIPE_THRESHOLD_PX = 80;

/**
 * Owns the entire study flow client-side against the already-fetched
 * flashcard/tag lists passed down from the server component — starting,
 * restarting, or returning to tag selection never triggers another network
 * round trip. Navigation through the deck is delegated to a single Embla
 * carousel instance (non-looping): swipe/drag is handled natively by Embla
 * on the viewport it's attached to, while the [PREVIOUS]/[NEXT] buttons and
 * arrow keys call `goToDirection`, which is the one shared entry point they
 * all use to drive Embla's `scrollTo` — every input method ends up moving
 * the same carousel rather than each implementing its own navigation.
 */
export function StudySession({ flashcards, tags }: { flashcards: SerializedFlashcard[]; tags: string[] }) {
  const [stage, setStage] = useState<Stage>("selecting");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [deck, setDeck] = useState<SerializedFlashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // Ticket 03 (motion): every mounted card's own measured content height,
  // keyed by flashcard id (reported by Flashcard.tsx's onHeightChange) — see
  // `currentCardHeight` below, which reads only the current card's entry out
  // of this map to drive the carousel viewport's own height animation.
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const prefersReducedMotion = useReducedMotion();
  // `loop: false` is Embla's default already, but this ticket's carousel is
  // non-looping by requirement, so it's spelled out explicitly rather than
  // relied on implicitly. `duration` (Embla's own frame-based tween length
  // for both drag-release settling and programmatic scrollTo — 25 is
  // Embla's own default) is made `prefers-reduced-motion`-aware here since
  // Embla's internal tween isn't covered by globals.css's CSS-transition
  // media query at all; when reduced motion is preferred it's set to 0,
  // making Embla's own positional movement instant, so the Motion-authored
  // crossfade below (also reduced to a 0-duration snap in that case) is the
  // only visible transition. The hook is called unconditionally (rules of
  // hooks) even though `emblaRef` is only attached to a DOM node while
  // `stage === "studying"`; embla-carousel-react tears down and reinitializes
  // its instance automatically as that ref's node unmounts/remounts across
  // stage changes, so a fresh deck always gets a fresh carousel.
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, duration: prefersReducedMotion ? 0 : 25 });
  // Only read by the boundary-swipe release check below — see
  // BOUNDARY_SWIPE_THRESHOLD_PX's comment. Not used for any visual dragging.
  const boundarySwipeStartXRef = useRef<number | null>(null);
  // The current card's own already-known height (its neighbor-mount
  // optimization means this is populated before it ever becomes current —
  // see handleCardHeightChange below), fed to the viewport's own height
  // animation. `undefined` (nothing known yet, e.g. the very first paint of
  // a freshly started session) is handled by `isFirstViewportMeasurement`
  // below rather than left to fall back to ordinary intrinsic sizing — see
  // its own comment for why an explicit fallback matters.
  const currentCardHeight = deck[index] ? cardHeights[deck[index].id] : undefined;
  // Lets the viewport's height transition (below) snap the very first known
  // height of a session into place instead of visibly growing from a 0
  // fallback, while navigating between cards later still animates normally
  // — see useFirstRealValue's own doc comment. Unlike Flashcard.tsx's own
  // use of this hook, this state lives on StudySession itself (not on the
  // viewport's motion.div, which does remount fresh each session), and
  // `cardHeights` isn't cleared between sessions — so `startSession`
  // explicitly calls `resetViewportMeasurement()` below, since a restart
  // landing on a previously-seen (already-cached) card would otherwise not
  // be recognized as a fresh session's first measurement.
  const [isFirstViewportMeasurement, resetViewportMeasurement] = useFirstRealValue(currentCardHeight, undefined);

  const matchingCount = filterFlashcardsByTags(flashcards, selectedTags).length;

  // Shared entry point for finishing the session, whether triggered by
  // [NEXT]/ArrowRight running off the end of the deck or by a swipe past the
  // last card (see BOUNDARY_SWIPE_THRESHOLD_PX). `index` is set to
  // `deck.length` (one past the last valid card) for parity with the old
  // sentinel value, even though the completed screen itself doesn't read it.
  function completeSession() {
    setIndex(deck.length);
    setFlipped(false);
    setStage("completed");
  }

  // Shared by the tag-selection screen's [START] and the completion screen's
  // [RESTART, RESHUFFLED] — both mean "build a fresh shuffled deck from the
  // current tag selection and start studying it," so there's exactly one
  // implementation rather than two that could drift apart.
  function startSession() {
    setDeck(buildDeck(flashcards, selectedTags));
    setIndex(0);
    setFlipped(false);
    setStage("studying");
    // See isFirstViewportMeasurement's own comment above: needed so every
    // fresh session's first known card height is treated as a snap rather
    // than an animated grow — even a restart that lands on a card whose
    // height happens to already be cached in `cardHeights` from earlier in
    // the same browser session.
    resetViewportMeasurement();
  }

  function pickDifferentTags() {
    setSelectedTags([]);
    setTagFilter("");
    setDeck([]);
    setIndex(0);
    setFlipped(false);
    setStage("selecting");
  }

  // Keeps `index`/`flipped` in sync whenever Embla's selected slide changes
  // — whether from our own `goToDirection` calls below or a genuine
  // swipe/drag gesture, so swipe navigation (handled natively by Embla) ends
  // up updating the same "Card X of Y" progress and flip-reset behavior as
  // every other input method.
  useEffect(() => {
    if (!emblaApi) return;
    function handleSelect() {
      setIndex(emblaApi!.selectedScrollSnap());
      setFlipped(false);
    }
    emblaApi.on("select", handleSelect);
    return () => {
      emblaApi.off("select", handleSelect);
    };
  }, [emblaApi]);

  // Shared entry point for the previous/next buttons and the arrow keys
  // (swipe navigates directly through Embla's own drag handling, not through
  // this function). `advanceIndex` (deck.ts, untouched by the carousel
  // mechanism) computes the intended next index off Embla's own
  // `selectedScrollSnap()` rather than the possibly-stale `index` state, so
  // rapid repeated presses each compute off the previous press's real
  // target instead of racing a not-yet-applied React state update. Reaching
  // one past the last card bypasses the carousel entirely and goes straight
  // to the completion screen; a clamped, no-movement request (e.g.
  // [PREVIOUS] on the first card) is a no-op.
  function goToDirection(direction: AdvanceDirection) {
    if (!emblaApi) return;
    const current = emblaApi.selectedScrollSnap();
    const next = advanceIndex(current, deck.length, direction);
    if (next === current) return;
    if (next >= deck.length) {
      completeSession();
      return;
    }
    emblaApi.scrollTo(next);
  }

  // See BOUNDARY_SWIPE_THRESHOLD_PX: captures the release point of a
  // swipe/drag that starts anywhere in the carousel viewport, purely to
  // detect one gesture Embla's non-looping bounds can't complete on their
  // own — swiping past the last card. Every in-bounds swipe is handled
  // entirely by Embla itself (via `emblaRef`, attached to the same element)
  // and is untouched by this; these handlers never call `preventDefault` or
  // drive any transform of their own.
  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    boundarySwipeStartXRef.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleViewportPointerUp(event: PointerEvent<HTMLDivElement>) {
    const startX = boundarySwipeStartXRef.current;
    boundarySwipeStartXRef.current = null;
    if (startX === null || !emblaApi) return;
    const deltaX = event.clientX - startX;
    if (deltaX <= -BOUNDARY_SWIPE_THRESHOLD_PX && !emblaApi.canScrollNext()) {
      completeSession();
    }
  }

  function handleViewportPointerCancel() {
    boundarySwipeStartXRef.current = null;
  }

  // Ticket 03 (motion): records one card's measured content height, keyed
  // by its own flashcard id — called by every currently-mounted Flashcard
  // (current card and its up-to-two neighbors), not just the current one, so
  // a neighbor's height is already known by the time navigation makes it
  // current (no re-measurement lag at the moment of navigating to it).
  function handleCardHeightChange(cardId: string, height: number) {
    setCardHeights((current) => (current[cardId] === height ? current : { ...current, [cardId]: height }));
  }

  // Arrow-key navigation and space-to-flip — same shared `goToDirection`/
  // `setFlipped` the buttons call, active only while actually studying a
  // deck so it can't fire during tag selection or on the completion screen.
  // Space always flips regardless of which element has focus, so it takes
  // over from (and prevents) a focused button's own native space activation.
  useEffect(() => {
    if (stage !== "studying") return;

    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveStudyKeyAction(event.key);
      if (action === "next") {
        goToDirection("next");
      } else if (action === "prev") {
        goToDirection("prev");
      } else if (action === "flip") {
        event.preventDefault();
        setFlipped((current) => !current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, emblaApi, deck.length]);

  if (stage === "selecting") {
    return (
      <div className={`${styles.panel} ${styles.panelWide}`}>
        <h2 className={styles.heading}>Select tags to study</h2>
        {tags.length === 0 ? (
          <p className={styles.empty}>No tags exist yet — add tags to a flashcard first.</p>
        ) : (
          <TagFilterInput
            id="study-tag-filter"
            tags={tags}
            value={tagFilter}
            onChange={setTagFilter}
            className={styles.filterField}
          >
            {(visibleTags) => (
              <TagCloud
                tags={visibleTags}
                selectedTags={selectedTags}
                onToggle={(tag) => setSelectedTags((current) => toggleTagChip(current, tag))}
              />
            )}
          </TagFilterInput>
        )}
        {matchingCount === 0 ? (
          <p className={styles.empty}>
            {selectedTags.length > 0 ? "No flashcards match the selected tags." : "No flashcards exist yet."}
          </p>
        ) : (
          selectedTags.length === 0 && (
            <p className={styles.empty}>No tags selected — this will study every flashcard.</p>
          )
        )}
        <button
          type="button"
          className={`${styles.primaryButton} ${styles.startButton}`}
          disabled={matchingCount === 0}
          onClick={startSession}
        >
          Start
        </button>
      </div>
    );
  }

  if (stage === "completed") {
    return (
      <div className={styles.panel}>
        <h2 className={styles.heading}>Session complete</h2>
        <p>You studied every matching card ({deck.length} total).</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={startSession}>
            Restart, reshuffled
          </button>
          <button type="button" className={styles.secondaryButton} onClick={pickDifferentTags}>
            Pick different tags
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <p className={styles.progress}>
        Card {index + 1} of {deck.length}
      </p>
      {/*
       * Every card gets an Embla `.slide` div up front — Embla needs the
       * full track to compute correct snap points and translate it as the
       * selected slide changes, whether from a swipe or a `goToDirection`
       * call. Only the current slide and its immediate neighbors mount a
       * real `Flashcard` (each rendering two MarkdownBlocks); farther
       * slides stay empty placeholders so a large deck doesn't render every
       * card's markdown for the life of the session, and get `inert` so
       * their (off-screen) content can never enter the keyboard tab order.
       * Only the slide at `index` gets the live `flipped` value; every
       * other mounted slide stays unflipped so nothing is ever visibly
       * revealed by navigating to it.
       *
       * Ticket 03 (motion): Embla still owns the actual track — drag,
       * swipe, bounds, and (reduced-motion-aware, see `duration` above)
       * positional snapping stay exactly as ticket 01 built them. Motion is
       * layered on top of that, consuming Embla's exposed `index`: the
       * outer `.viewport` is a `motion.div` whose `height` animates to
       * `currentCardHeight` (replacing the old deferInitialHeight/
       * useLayoutEffect dance, and fixing a real gap that dance never
       * actually closed — since `.container` is a flex row, every mounted
       * slide's height was implicitly stretched to the tallest of the
       * current card *and* its off-screen neighbors, not just the current
       * card, without an explicit height overriding that); each mounted
       * slide's inner wrapper is a `motion.div` crossfading between a
       * dimmed/scaled-down rest state and a fully visible one based on
       * `isCurrent`, providing the actual "slide transition between cards"
       * — the one thing Embla's own positional engine doesn't do on its
       * own (it moves cards into place; it never fades or settles them).
       */}
      <motion.div
        className={styles.viewport}
        ref={emblaRef}
        onPointerDown={handleViewportPointerDown}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerCancel}
        initial={false}
        // A `height` key that only appears in `animate` once the current
        // card's height is first known (i.e. `animate={undefined}` on the
        // very first render of a session, then `animate={{ height }}` once
        // populated) is never picked up by Motion — it only starts tracking
        // a style key it sees on the FIRST render `animate` is given. Without
        // an explicit height applied from the start, this flex row silently
        // falls back to auto-sizing to the tallest of the current card *and*
        // its off-screen neighbor (see the comment above) — the exact bug
        // this animation exists to prevent. `0` is a placeholder for before
        // the first measurement lands — never itself visibly animated from,
        // since `isFirstViewportMeasurement` (declared above) makes that one
        // 0-to-real-height jump instant. Every later change (navigating to a
        // differently-sized card) still gets the full animated duration.
        animate={{ height: currentCardHeight ?? 0 }}
        transition={{
          duration: prefersReducedMotion || isFirstViewportMeasurement ? 0 : 0.6,
          ease: "easeInOut",
        }}
      >
        <div className={styles.container}>
          {deck.map((deckCard, deckIndex) => {
            const isCurrent = deckIndex === index;
            const isMounted = Math.abs(deckIndex - index) <= 1;
            return (
              <div
                className={styles.slide}
                key={deckCard.id}
                inert={!isCurrent}
                // Test-only hook, no visual/functional effect: the currently
                // active slide's own `isCurrent` (already computed above for
                // the crossfade) is the only unambiguous way to tell it apart
                // from its off-screen neighbor, which stays mounted with real
                // Flashcard content for Embla's drag/snap math and only hides
                // via ancestor CSS clipping + transform — never
                // `display`/`visibility` on the slide itself. A page-wide
                // query for card text can't tell the current slide from that
                // clipped neighbor; e2e/smoke.spec.ts's study-session tests
                // scope their card-identity queries to
                // `[data-current-slide="true"]` instead.
                data-current-slide={isCurrent ? "true" : undefined}
              >
                {isMounted && (
                  <motion.div
                    initial={false}
                    animate={{ opacity: isCurrent ? 1 : 0.35, scale: isCurrent ? 1 : 0.97 }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: "easeOut" }}
                  >
                    <Flashcard
                      card={deckCard}
                      flipped={isCurrent ? flipped : false}
                      onHeightChange={(height) => handleCardHeightChange(deckCard.id, height)}
                    />
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>
      <div className={styles.navButtons}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => goToDirection("prev")}
          disabled={index === 0}
        >
          <ChevronLeft size={15} aria-hidden="true" />
          Previous
        </button>
        <button
          type="button"
          className={styles.flipButton}
          onClick={() => setFlipped((current) => !current)}
          title="Press space to flip"
        >
          {flipped ? "Show question" : "Flip"}
          <Space size={14} className={styles.flipHint} aria-hidden="true" />
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => goToDirection("next")}>
          Next
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
      <Link href="/flashcards" className={styles.exitLink}>
        Exit to management
      </Link>
    </div>
  );
}
