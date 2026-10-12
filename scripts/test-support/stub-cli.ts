import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "vitest";

/**
 * Tickets 53 and 54: runs a deploy script (scripts/*.sh) for real with stub
 * `aws` and `cosign` executables first on PATH. Each stub logs its arguments
 * (and the contents of any file:// argument) and answers from a canned table
 * keyed by "<tool> <word…>", where the words are its arguments minus flags,
 * longest match first. So `aws ecs describe-task-definition` answers every
 * family, while `aws ecs describe-task-definition --task-definition
 * pensieve-app` can be answered separately. A list of replies answers
 * successive calls with the same key in order, repeating the last one. The
 * tests see exactly what the script would have asked AWS and Sigstore, in
 * order, without touching either.
 */

export type Reply = { stdout?: string; exit?: number };
export type Replies = Record<string, Reply | Reply[]>;
export type Call = { cmd: string; args: string[]; files: Record<string, string> };

export function json(value: unknown): Reply {
  return { stdout: JSON.stringify(value) };
}

const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const cmd = require("node:path").basename(process.argv[1]);
const args = process.argv.slice(2);
const files = {};
for (const a of args) if (a.startsWith("file://")) files[a] = fs.readFileSync(a.slice(7), "utf8");
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ cmd, args, files }) + "\\n");
const replies = JSON.parse(fs.readFileSync(process.env.STUB_REPLIES, "utf8"));
const words = [cmd, ...args.filter((a) => !a.startsWith("-"))];
for (let n = words.length; n > 0; n--) {
  const key = words.slice(0, n).join(" ");
  let reply = replies[key];
  if (Array.isArray(reply)) {
    const state = JSON.parse(fs.readFileSync(process.env.STUB_STATE, "utf8"));
    const seen = state[key] ?? 0;
    state[key] = seen + 1;
    fs.writeFileSync(process.env.STUB_STATE, JSON.stringify(state));
    reply = reply[Math.min(seen, reply.length - 1)];
  }
  if (reply) {
    if (reply.stdout) process.stdout.write(reply.stdout);
    process.exit(reply.exit ?? 0);
  }
}
process.stderr.write("stub: no reply for " + words.join(" ") + "\\n");
process.exit(99);
`;

/** A temporary directory holding the stubs; call `cleanup` after each test. */
export function createStubCli() {
  const dir = mkdtempSync(path.join(tmpdir(), "stub-cli-"));
  for (const tool of ["aws", "cosign"]) {
    writeFileSync(path.join(dir, tool), STUB);
    chmodSync(path.join(dir, tool), 0o755);
  }

  function run(script: string, args: string[], replies: Replies, env: Record<string, string> = {}) {
    writeFileSync(path.join(dir, "replies.json"), JSON.stringify(replies));
    writeFileSync(path.join(dir, "state.json"), "{}");
    writeFileSync(path.join(dir, "calls.log"), "");
    const result = spawnSync("bash", [script, ...args], {
      encoding: "utf8",
      // A clean environment: no real AWS profile or Docker config leaks in.
      env: {
        NODE_ENV: "test",
        PATH: `${dir}:${process.env.PATH}`,
        HOME: dir,
        STUB_LOG: path.join(dir, "calls.log"),
        STUB_REPLIES: path.join(dir, "replies.json"),
        STUB_STATE: path.join(dir, "state.json"),
        // scripts/lib/deploy.sh polls the service: no sleeping, and few polls.
        DEPLOY_WAIT_SECONDS: "0",
        DEPLOY_WAIT_ATTEMPTS: "3",
        ...env,
      },
    });
    const calls: Call[] = readFileSync(path.join(dir, "calls.log"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { status: result.status, output: result.stdout + result.stderr, calls };
  }

  return {
    dir,
    run,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const isEcs = (c: Call) => c.cmd === "aws" && c.args[0] === "ecs";

/** The calls of `cmd` whose leading arguments are `sub`. */
export const named = (calls: Call[], cmd: string, ...sub: string[]) =>
  calls.filter((c) => c.cmd === cmd && sub.every((s, i) => c.args[i] === s));

/** The value following `name` in a call's arguments. */
export function flag(call: Call, name: string): string {
  const i = call.args.indexOf(name);
  expect(i, `${name} in ${call.args.join(" ")}`).toBeGreaterThanOrEqual(0);
  return call.args[i + 1];
}

/** The JSON a call passed as `--cli-input-json file://…`. */
export function fileInput(call: Call): unknown {
  return JSON.parse(Object.values(call.files)[0]);
}
