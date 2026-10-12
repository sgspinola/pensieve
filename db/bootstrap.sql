-- Ticket 42: the database roles and grants (spec 13, "Bootstrap (roles and
-- grants)"), run as the RDS master user by the DB image's bootstrap.cjs, in
-- one transaction. Proven by db/bootstrap.test.ts.
--
-- Two roles, both logging in only with RDS IAM tokens (`rds_iam`):
--   pensieve_migrator  owns the schema: every table, sequence and type the
--                      migrations create, Drizzle's bookkeeping schema
--                      (`drizzle`) and `pensieve_meta`.
--   pensieve_app       reads and writes rows in `public`, reads `drizzle` and
--                      `pensieve_meta`, and can't change the schema.
-- The app role's table privileges come from default privileges on what the
-- migrator creates, so tables added by later migrations need no new grant.
--
-- Idempotent and additive: re-running it is safe and changes nothing that's
-- already in place. It never removes anything, so taking a privilege away
-- means adding an explicit REVOKE here (and re-running the bootstrap);
-- deleting a GRANT line alone leaves the privilege where it already exists.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pensieve_migrator') THEN
    CREATE ROLE pensieve_migrator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pensieve_app') THEN
    CREATE ROLE pensieve_app LOGIN;
  END IF;
END
$$;

GRANT rds_iam TO pensieve_migrator, pensieve_app;

-- Lets the master act for the migrator below: hand it schemas, and set the
-- default privileges on what it will create.
GRANT pensieve_migrator TO CURRENT_USER;

-- The migrator runs `CREATE SCHEMA IF NOT EXISTS` for drizzle and
-- pensieve_meta, which Postgres refuses without CREATE on the database even
-- though both schemas below already exist.
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO pensieve_migrator', current_database());
END
$$;

GRANT USAGE, CREATE ON SCHEMA public TO pensieve_migrator;
GRANT USAGE ON SCHEMA public TO pensieve_app;

ALTER DEFAULT PRIVILEGES FOR ROLE pensieve_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pensieve_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pensieve_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO pensieve_app;

-- ALTER too, so a schema that already existed under another owner (e.g.
-- migrations once run as master) ends up the migrator's as well.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE SCHEMA IF NOT EXISTS pensieve_meta;
ALTER SCHEMA drizzle OWNER TO pensieve_migrator;
ALTER SCHEMA pensieve_meta OWNER TO pensieve_migrator;
GRANT USAGE ON SCHEMA drizzle, pensieve_meta TO pensieve_app;

ALTER DEFAULT PRIVILEGES FOR ROLE pensieve_migrator IN SCHEMA drizzle
  GRANT SELECT ON TABLES TO pensieve_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pensieve_migrator IN SCHEMA pensieve_meta
  GRANT SELECT ON TABLES TO pensieve_app;
