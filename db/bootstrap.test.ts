import { readFileSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";

/**
 * Ticket 42: the roles-and-grants bootstrap (db/bootstrap.sql), proven
 * against real Postgres as spec 13's grants test describes. Roles are
 * cluster-wide, so they outlive the throwaway database and are dropped in
 * teardown. Each role is assumed with SET ROLE on the one superuser
 * connection, which checks privileges exactly as a login as that role would.
 *
 * RDS's master user isn't a superuser: it's a CREATEROLE user that owns the
 * database. The bootstrap runs as such a role here, so a grant only a
 * superuser could make fails in the test, not in production. Vanilla
 * Postgres has no `rds_iam`, so a stub stands in for it.
 */

const BOOTSTRAP_SQL = readFileSync(path.join(process.cwd(), "db", "bootstrap.sql"), "utf8");
const MASTER = "bootstrap_test_master";
const ROLES = ["pensieve_app", "pensieve_migrator", MASTER, "rds_iam"];

let db: TestDatabase;
let sql: postgres.Sql;
let teardown: () => Promise<void>;

async function dropRoles(): Promise<void> {
  for (const role of ROLES) {
    await sql.unsafe(`DROP ROLE IF EXISTS ${role}`);
  }
}

/** Runs `fn` as `role`, then switches back to the superuser. */
async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await sql.unsafe(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await sql.unsafe("RESET ROLE");
  }
}

async function bootstrap(): Promise<void> {
  await asRole(MASTER, () => sql.unsafe(BOOTSTRAP_SQL));
}

beforeAll(async () => {
  ({ db, sql, teardown } = await createTestDb({ migrate: false }));
  await sql.unsafe("SET client_min_messages = warning");
  await dropRoles();
  await sql.unsafe("CREATE ROLE rds_iam");
  await sql.unsafe(`CREATE ROLE ${MASTER} CREATEROLE`);
  await sql.unsafe(`GRANT rds_iam TO ${MASTER} WITH ADMIN OPTION`);
  const [{ name }] = await sql<{ name: string }[]>`select current_database() as name`;
  await sql.unsafe(`ALTER DATABASE "${name}" OWNER TO ${MASTER}`);

  await bootstrap();
  await asRole("pensieve_migrator", () => migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") }));
});

afterAll(async () => {
  await teardown();
  // The database is gone, so nothing depends on the roles any more. A new
  // connection, since teardown closed this one.
  const cleanup = await createTestDb({ migrate: false });
  sql = cleanup.sql;
  try {
    await dropRoles();
  } finally {
    await cleanup.teardown();
  }
});

describe("the app role, after bootstrap and migrations", () => {
  it("can select, insert, update and delete rows in a migrated table", async () => {
    const rows = await asRole("pensieve_app", async () => {
      const [{ id }] = await sql<{ id: number }[]>`insert into pings (message) values ('hello') returning id`;
      await sql`update pings set message = 'updated' where id = ${id}`;
      const selected = await sql<{ message: string }[]>`select message from pings where id = ${id}`;
      await sql`delete from pings where id = ${id}`;
      return selected;
    });

    expect(rows).toEqual([{ message: "updated" }]);
  });

  it.each([
    ["create a table", "create table app_made (id int)"],
    ["create a schema", "create schema app_made"],
    ["alter a migrated table", "alter table pings add column extra text"],
    ["drop a migrated table", "drop table pings"],
  ])("is refused when it tries to %s", async (_action, ddl) => {
    // 42501: insufficient_privilege, which includes "must be owner of table".
    await expect(asRole("pensieve_app", () => sql.unsafe(ddl))).rejects.toMatchObject({ code: "42501" });
  });

  it("can write a table the migrator creates later, with no new grant", async () => {
    await asRole("pensieve_migrator", () => sql`create table added_later (id serial primary key, note text not null)`);

    const rows = await asRole("pensieve_app", async () => {
      await sql`insert into added_later (note) values ('later')`;
      return sql<{ id: number; note: string }[]>`select id, note from added_later`;
    });

    expect(rows).toEqual([{ id: 1, note: "later" }]);
  });

  it("can read Drizzle's bookkeeping table but not write it", async () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"));

    const applied = await asRole("pensieve_app", () => sql`select hash from drizzle.__drizzle_migrations`);

    expect(applied).toHaveLength(journal.entries.length);
    await expect(
      asRole("pensieve_app", () => sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('x', 0)`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("can read pensieve_meta but not write it", async () => {
    await asRole("pensieve_migrator", async () => {
      await sql`create table pensieve_meta.probe (value text)`;
      await sql`insert into pensieve_meta.probe values ('from the migrator')`;
    });

    const rows = await asRole("pensieve_app", () => sql`select value from pensieve_meta.probe`);

    expect(rows).toEqual([{ value: "from the migrator" }]);
    await expect(
      asRole("pensieve_app", () => sql`insert into pensieve_meta.probe values ('from the app')`),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("re-running the bootstrap", () => {
  /** Every role, membership, owner and privilege the bootstrap could touch. */
  async function privilegeState() {
    return sql`
      select
        (select json_agg(r order by r.rolname) from (
          select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit
          from pg_roles where rolname like 'pensieve_%') r) as roles,
        (select json_agg(m order by m.role, m.member) from (
          select r.rolname as role, u.rolname as member, a.admin_option, a.inherit_option, a.set_option
          from pg_auth_members a
          join pg_roles r on r.oid = a.roleid
          join pg_roles u on u.oid = a.member
          where r.rolname like 'pensieve_%' or u.rolname like 'pensieve_%') m) as memberships,
        (select datacl::text from pg_database where datname = current_database()) as database_acl,
        (select json_agg(n order by n.nspname) from (
          select nspname, nspowner::regrole::text as owner, nspacl::text as acl
          from pg_namespace where nspname in ('public', 'drizzle', 'pensieve_meta')) n) as schemas,
        (select json_agg(d order by d.role, d.schema, d.defaclobjtype) from (
          select defaclrole::regrole::text as role, defaclnamespace::regnamespace::text as schema,
                 defaclobjtype, defaclacl::text as acl
          from pg_default_acl) d) as default_privileges,
        (select json_agg(c order by c.name) from (
          select oid::regclass::text as name, relowner::regrole::text as owner, relacl::text as acl
          from pg_class
          where relnamespace::regnamespace::text in ('public', 'drizzle', 'pensieve_meta')
            and relkind in ('r', 'S')) c) as relations
    `;
  }

  it("succeeds and changes nothing", async () => {
    const before = await privilegeState();

    await bootstrap();

    expect(await privilegeState()).toEqual(before);
  });
});
