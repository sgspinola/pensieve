# Flashcard Study Session

Unlike every other flow in these docs, a study session is almost entirely
**client-side** — there is no `/api/flashcards/study` route, and no further
network round trip happens once the page loads. `src/app/flashcards/study/page.tsx`
is a Server Component that fetches the *entire* flashcard pool and tag list
once (`listFlashcards(db)` with no `limit`, and `listFlashcardTags(db)`,
`page.tsx:26`) and hands both down as props to `StudySession.tsx` (a
`"use client"` component, `src/app/flashcards/study/StudySession.tsx`),
which owns every bit of session state itself: tag selection, the shuffled
deck, the current card index, and flip state. Starting, restarting, or
going back to tag selection never re-fetches anything — it's all recompute
over the props the page already has.

## Why the whole pool, unpaginated

`page.tsx:22-24` notes explicitly: "the study deck needs the entire pool up
front to shuffle from, unlike the paginated `/flashcards` management list."
`listFlashcardTags` (`page.tsx:26`) additionally scopes the tag-selection
cloud to tags actually attached to at least one flashcard, so an item-only
tag never shows up as a distractor option that would silently produce an
empty deck.

## Stage machine

```mermaid
sequenceDiagram
    actor User
    participant Page as flashcards/study/page.tsx<br/>(Server Component)
    participant Session as StudySession.tsx<br/>(client, stage state)
    participant Deck as study/deck.ts<br/>(pure functions)
    participant Embla as embla-carousel-react

    User->>Page: navigate to /flashcards/study
    Page->>Page: requireCurrentUser()
    Page->>Page: listFlashcards(db) [no limit],<br/>listFlashcardTags(db)
    Page-->>Session: props: { flashcards, tags }
    Note over Session: stage = "selecting" (initial state)

    User->>Session: toggle tag chips (TagCloud)
    Session->>Deck: filterFlashcardsByTags(flashcards, selectedTags)
    Deck-->>Session: matchingCount (OR semantics,<br/>empty selection = every card)
    Note right of Session: [START] disabled while matchingCount === 0

    User->>Session: click [START]
    Session->>Deck: buildDeck(flashcards, selectedTags)
    Deck->>Deck: filterFlashcardsByTags(...)
    Deck->>Deck: shuffleDeck(...) — Fisher-Yates,<br/>returns a new array
    Deck-->>Session: shuffled deck[]
    Session->>Session: setIndex(0)<br/>setFlipped(false)<br/>stage = "studying"
    Session->>Session: resetViewportMeasurement()
    Note right of Session: so this session's first card-height<br/>measurement snaps in rather than<br/>animating from 0 (useFirstRealValue.ts)

    loop while stage === "studying"
        alt user clicks [FLIP] or presses Space
            Session->>Session: setFlipped(!flipped)
        else user clicks [NEXT]/[PREVIOUS] or presses ArrowRight/ArrowLeft
            Session->>Deck: advanceIndex(currentIndex, deck.length, direction)
            Deck-->>Session: next index (clamped — never wraps)
            alt next === current (already at a bound)
                Note right of Session: no-op
            else next >= deck.length
                Session->>Session: completeSession()<br/>(stage = "completed")
            else in-bounds
                Session->>Embla: emblaApi.scrollTo(next)
                Embla-->>Session: "select" event -> setIndex/setFlipped(false)
            end
        else user swipes/drags the carousel
            Note over Embla: Embla owns in-bounds drag/snap<br/>natively — StudySession never<br/>computes position during a normal swipe
            Embla-->>Session: "select" event on settle -> setIndex/setFlipped(false)
            opt swipe released past the last card (non-looping Embla<br/>can't produce a "select" event there)
                Session->>Session: pointerup delta beyond<br/>BOUNDARY_SWIPE_THRESHOLD_PX (80px)<br/>while !emblaApi.canScrollNext()
                Session->>Session: completeSession()
            end
        end
    end

    Note over Session: stage = "completed"
    alt user clicks [RESTART, RESHUFFLED]
        Session->>Deck: buildDeck(flashcards, selectedTags)
        Note right of Session: same startSession() path as [START] —<br/>fresh shuffle of the same tag selection
    else user clicks [PICK DIFFERENT TAGS]
        Session->>Session: pickDifferentTags() — clear selection,<br/>deck, index<br/>stage = "selecting"
    end
```

## Notable design choices

- **`advanceIndex` (`deck.ts:44-47`) is the single index-advance function
  every input method shares** — the `[PREVIOUS]`/`[NEXT]` buttons, arrow
  keys, and the boundary-swipe check all call through it rather than each
  re-implementing the clamping/bounds logic. It never wraps: `prev` at the
  first card and `next` at or past the end both clamp in place, and reaching
  `deckLength` (one past the last valid index) is the defined signal to show
  the completion screen rather than an out-of-bounds error.
- **In-bounds swipe navigation bypasses `advanceIndex` entirely.** A normal
  swipe/drag is handled natively by Embla's own drag-and-snap engine; only
  the "swipe past the last card" case needs a manual check
  (`handleViewportPointerUp`, `StudySession.tsx:182-190`), because a
  non-looping Embla carousel structurally can't scroll past its last slide
  and so never fires the `select` event a normal navigation relies on.
  `BOUNDARY_SWIPE_THRESHOLD_PX` (80px, `StudySession.tsx:28`) exists purely
  to detect that one gesture; it never drives any visual motion of its own.
- **`goToDirection` reads Embla's own `selectedScrollSnap()`, not React's
  `index` state, as the base for the next computation**
  (`StudySession.tsx:158-168`) — so rapid repeated button presses or key
  taps each compute off the carousel's actual current position rather than
  racing a not-yet-applied `setIndex` call.
- **Only the current card and its immediate neighbors mount real
  `Flashcard` content** (`Math.abs(deckIndex - index) <= 1`,
  `StudySession.tsx:355`); farther slides stay empty placeholders so a large
  deck doesn't render every card's markdown for the life of the session.
  Only the current slide ever receives the live `flipped` value — every
  other mounted slide stays unflipped, so navigating to a neighbor never
  visibly reveals its answer early.
- **`resetViewportMeasurement()` is called explicitly on every
  `startSession()`** (`StudySession.tsx:119`, including a restart), not
  just once — because `cardHeights` persists across sessions in the same
  browser session, a restart that happens to land on a previously-seen
  (already height-cached) card would otherwise not be recognized as a fresh
  session's first measurement, and would skip the "snap instead of animate"
  treatment `isFirstViewportMeasurement`/`useFirstRealValue.ts` provides.
