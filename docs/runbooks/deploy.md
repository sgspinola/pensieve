# Deploy

A release (a merge from `develop` into `main`) only publishes signed images. Nothing reaches production until you dispatch a deploy workflow and approve it. Both workflows run only on `main`, verify each image's signature by digest before changing anything, and share one concurrency group, so two prod deploys never overlap.

## Which workflow

| Change | Dispatch | Downtime |
| --- | --- | --- |
| App only | `deploy-app` with `app_sha` | About a minute: one Fargate cold start |
| Additive migration only | `deploy-db` with `db_sha` | About 5 minutes, while the app is stopped for the snapshot and migration |
| Additive migration plus the app that uses it | `deploy-db` with `db_sha`, then `deploy-app` with `app_sha` | Both of the above |
| Breaking migration | `deploy-db` with `db_sha` **and** `app_sha` | One window of about 5 minutes; the new app starts at the end |

`app_sha` and `db_sha` are the `main` commits whose releases published the images, so 7 to 40 hex characters. A release that didn't change the app publishes no new app image, so `app_sha` is the commit of the last release that did change it. `aws ecr describe-images --repository-name pensieve` lists the `sha-*` tags.

## Additive or breaking

A migration is **breaking** when the running app couldn't work against the schema it produces. Mark it by making `-- pensieve:breaking` the first line of its SQL file, by hand, after `npm run db:generate`. Everything else is additive.

Rule of thumb:
- **Breaking:** drops, renames, type changes, `NOT NULL` without a default, and new constraints that existing rows or the current app could violate.
- **Additive:** new tables, nullable or defaulted columns, and indexes.

No linter enforces the marker; it's a review-time judgement. Two things back it up:
- The migrator refuses a pending breaking migration unless `deploy-db` got an `app_sha`, without applying anything.
- The app's startup check refuses to run against a database that's missing one of its migrations, or that holds a breaking migration newer than the app.

## What each workflow does

**`deploy-app`** (role `pensieve-github-deploy-app`, which can't touch the database):
1. Verifies `sha-<app_sha>` in `pensieve` against `ci.yml@refs/heads/main`.
2. Registers a `pensieve-app` revision from the family's latest, with only the app image changed (pinned by digest).
3. Points the service at it, at its current desired count, or 1 on the first deploy. Then it waits until the rollout completes.

**`deploy-db`** (role `pensieve-github-deploy-db`):
1. Verifies the DB image (and the app image, with `app_sha`).
2. Records the service's revision and count, then scales it to 0.
3. Snapshots the database as `pensieve-predeploy-<db_sha>-<UTC time>`.
4. Runs the migrator as a one-off task, with `ALLOW_BREAKING=true` only if `app_sha` was given.
5. Starts the recorded revision, or a new one for `app_sha`, at the recorded count.
6. Deletes the older pre-deploy snapshots. Point-in-time recovery covers anything older.

Each run's summary says what happened, and links the log group on a failure.

## When it fails

| Failure | What's left running | What to do |
| --- | --- | --- |
| Signature verification (either workflow) | Nothing changed | Check the SHA. Only images published by `main`'s workflows verify |
| `deploy-app`: the new revision never turns healthy | The circuit breaker rolls back to the previous revision; the run fails and links `/ecs/pensieve-app` | Read the app log. A startup schema refusal means the app needs a `deploy-db` first |
| `deploy-db`: migration failed or was refused | The previous revision and count are restored; nothing was migrated (one transaction); the snapshot is kept | Read `/ecs/pensieve-migrate`. A refusal names the breaking migrations: re-dispatch with `app_sha` |
| `deploy-db`: gave up waiting for the migrator | **The app stays stopped**: the migrator may still be running | Check `/ecs/pensieve-migrate`. Once it has finished, start the app with `deploy-app` or `deploy-db` again |
| `deploy-db`: the app didn't stabilise after migrating | The circuit breaker rolls back; on a breaking schema, the startup check keeps the old app down | Follow the rollback for a breaking migration below, which uses the [restore runbook](./restore) |

## Rollback

- **After an app-only deploy:** dispatch `deploy-app` with the previous `app_sha`. The service's previous revisions stay registered, but `deploy-app` always builds from the family's latest, so the SHA is what you choose.
- **After an additive migration:** nothing to undo. Older apps run fine on a database ahead of them by additive migrations.
- **After a breaking migration:** the old app can't run on the new schema. Restore the pre-deploy snapshot taken by that `deploy-db` run ([restore runbook](./restore)), then dispatch `deploy-app` with the previous `app_sha`. Restores run locally as the admin user; no GitHub role can restore.
