---
layout: home

hero:
  name: Pensieve Docs
  text: Architecture & Flow Reference
  tagline: >
    A Next.js 16 (App Router) app for items, flashcards, and a wiki, built on
    Drizzle ORM + Postgres with WebAuthn passkey auth.
  actions:
    - theme: brand
      text: Project Walkthrough
      link: /architecture/project-walkthrough
    - theme: alt
      text: Login Flow
      link: /flows/login-with-passkey

features:
  - title: Project Walkthrough
    details: A from-scratch primer for readers new to Next.js — repo layout, routing conventions, and which parts of the app use SSR, CSR, or static rendering (and which don't).
    link: /architecture/project-walkthrough
  - title: System Overview
    details: How a request moves from the App Router through the service layer, Drizzle ORM, and Postgres — plus where WebAuthn auth and session cookies sit.
    link: /architecture/system-overview
  - title: Database Schema
    details: The full table layout — items (including the self-referential wiki hierarchy), flashcards, tags, users, sessions, invites, and recovery codes.
    link: /architecture/database-schema
  - title: Module Structure
    details: A directory-level dependency map of src/app, src/services, src/lib, and src/db, derived from graphify's community detection.
    link: /architecture/module-structure
---

## About Pensieve

Pensieve is a personal knowledge workspace: a single Next.js 16 App Router
application (no separate backend service) with Drizzle ORM over Postgres and
WebAuthn passkey authentication, built on three features that share one
foundation:

- **Items** — bookmarks, tools, and "saved to read" articles.
- **Flashcards** — spaced-repetition study cards, a separate table from items.
- **Wiki** — hierarchical, self-authored pages that are themselves `items`
  with `kind: "page"`, linked into a tree via a self-referential `parentId`.

## Architecture

Structural diagrams (request lifecycle, database schema, module dependency
map) are hand-authored from this repo's own graphify knowledge graph
(`graphify-out/`) plus direct source reads, and are kept in sync the same
way — see the repo's `CLAUDE.md` for the update workflow.

- **[Project walkthrough](/architecture/project-walkthrough)** — a
  from-scratch primer (no Next.js background assumed) covering repo layout,
  routing conventions, and which parts of the app render via SSR, CSR, or
  static rendering.
- **[System overview](/architecture/system-overview)** — how a request moves
  from the browser through Next.js routing, the service layer, Drizzle, and
  Postgres, and how the passkey session is threaded through it.
- **[Database schema](/architecture/database-schema)** — every table,
  including the self-referential `items.parentId` that gives the wiki its
  hierarchy.
- **[Module structure](/architecture/module-structure)** — the major code
  communities graphify's clustering surfaced, and how they depend on each
  other.

## Flows

Sequence diagrams — happy path plus error branches (`alt`/`opt` blocks) —
are built from a Trailmark call-graph pass over this codebase
(`callees_of()` seeded at each route's entrypoints, plus branch/exception
data), with file:line citations throughout.

**Auth & onboarding**

- **[Login with a passkey](/flows/login-with-passkey)** — the full WebAuthn
  login ceremony, happy path and failure branches.
- **[Register with an invite](/flows/register-with-invite)** — redeeming an
  invite token through passkey registration.
- **[Account recovery](/flows/account-recovery)** — regaining access with a
  recovery code when a passkey isn't available.
- **[Admin: manage invites](/flows/admin-manage-invites)** — how an admin
  creates and revokes invites, and where that's enforced.

**Items**

- **[Item lifecycle](/flows/item-lifecycle)** — create, view, edit, and
  delete an item, including metadata auto-fetch.
- **[Items import / export](/flows/items-import-export)** — the
  frontmatter-file round trip for bulk-loading and exporting items.

**Flashcards**

- **[Flashcard lifecycle](/flows/flashcard-lifecycle)** — create, edit, and
  delete a flashcard.
- **[Flashcards import / export](/flows/flashcards-import-export)** — the
  frontmatter-file round trip for flashcards, including hash-based
  deduplication.
- **[Flashcard study session](/flows/flashcard-study-session)** — the
  spaced-repetition study flow.

**Wiki**

- **[Wiki article management](/flows/wiki-article-management)** — create,
  edit, reparent, and delete a wiki article, including the two delete
  branches (promote children vs. cascade) and cycle prevention on reparent.
