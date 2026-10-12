import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Call, type Replies, createStubCli, fileInput, flag, isEcs, json, named } from "./test-support/stub-cli";

/**
 * Ticket 52 (spec 12, "`deploy-app` workflow"): scripts/deploy-app.sh, which
 * the deploy-app workflow runs, against stub `aws` and `cosign` executables
 * (./test-support/stub-cli.ts).
 */

const SCRIPT = path.join(process.cwd(), "scripts", "deploy-app.sh");
const ACCOUNT = "111122223333";
const REGISTRY = `${ACCOUNT}.dkr.ecr.eu-north-1.amazonaws.com`;
const APP_DIGEST = `sha256:${"aa".repeat(32)}`;
const APP_IMAGE = `${REGISTRY}/pensieve@${APP_DIGEST}`;
const td = (revision: number) => `arn:aws:ecs:eu-north-1:${ACCOUNT}:task-definition/pensieve-app:${revision}`;
const CURRENT_TD = td(4);
const NEW_TD = td(5);
const APP_IDENTITY = "https://github.com/sgspinola/pensieve/.github/workflows/ci.yml@refs/heads/main";

const APP_TD = {
  taskDefinitionArn: CURRENT_TD,
  family: "pensieve-app",
  revision: 4,
  status: "ACTIVE",
  taskRoleArn: `arn:aws:iam::${ACCOUNT}:role/pensieve-app-task`,
  executionRoleArn: `arn:aws:iam::${ACCOUNT}:role/pensieve-app-execution`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "1024",
  containerDefinitions: [
    {
      name: "app",
      image: `${REGISTRY}/pensieve:main`,
      essential: true,
      environment: [{ name: "WEBAUTHN_RP_ID", value: "pensieve.fyi" }],
    },
    { name: "cloudflared", image: "cloudflare/cloudflared:2026.10.0@sha256:abc", essential: true },
  ],
  compatibilities: ["EC2", "FARGATE"],
  registeredAt: "2026-10-01T10:00:00.000Z",
};

function service(taskDefinition: string, desiredCount: number, rolloutState = "COMPLETED") {
  return json({
    services: [
      {
        serviceName: "pensieve",
        taskDefinition,
        desiredCount,
        runningCount: desiredCount,
        deployments: [{ status: "PRIMARY", taskDefinition, rolloutState }],
      },
    ],
  });
}

function happyReplies({ desiredCount = 1, finalTd = NEW_TD } = {}): Replies {
  const after = desiredCount === 0 ? 1 : desiredCount;
  return {
    "aws sts get-caller-identity": json({ Account: ACCOUNT }),
    "aws ecr describe-images": json({ imageDetails: [{ imageDigest: APP_DIGEST }] }),
    "aws ecr get-login-password": { stdout: "ecr-token" },
    "cosign login": {},
    "cosign verify": json([{ critical: {} }]),
    // The current state, then the state after the update.
    "aws ecs describe-services": [service(CURRENT_TD, desiredCount), service(finalTd, after)],
    "aws ecs describe-task-definition": json({ taskDefinition: APP_TD }),
    "aws ecs register-task-definition": json({ taskDefinition: { taskDefinitionArn: NEW_TD } }),
    "aws ecs update-service": json({ service: {} }),
  };
}

let cli: ReturnType<typeof createStubCli>;

beforeEach(() => {
  cli = createStubCli();
});

afterEach(() => {
  cli.cleanup();
});

const run = (args: string[], replies: Replies = happyReplies(), env: Record<string, string> = {}) =>
  cli.run(SCRIPT, args, replies, env);

const updates = (calls: Call[]) =>
  named(calls, "aws", "ecs", "update-service").map((c) => ({
    taskDefinition: flag(c, "--task-definition"),
    desiredCount: flag(c, "--desired-count"),
  }));

describe("deploy-app.sh", () => {
  it("rejects an argument that isn't a commit SHA, calling nothing", () => {
    for (const args of [[], ["main"], ["123456"], ["1234567", "abcdef1"]]) {
      const { status, calls } = run(args);
      expect(status, args.join(" ")).not.toBe(0);
      expect(calls).toEqual([]);
    }
  });

  it("verifies sha-<7> in pensieve by digest against ci.yml's main identity before any ECS call", () => {
    const { status, calls } = run(["abcdef1234"]);

    expect(status).toBe(0);
    const describe = named(calls, "aws", "ecr", "describe-images")[0];
    expect(flag(describe, "--repository-name")).toBe("pensieve");
    expect(flag(describe, "--image-ids")).toBe("imageTag=sha-abcdef1");
    const verify = named(calls, "cosign", "verify")[0];
    expect(flag(verify, "--certificate-identity")).toBe(APP_IDENTITY);
    expect(flag(verify, "--certificate-oidc-issuer")).toBe("https://token.actions.githubusercontent.com");
    expect(verify.args.at(-1)).toBe(APP_IMAGE);
    expect(calls.findIndex(isEcs)).toBeGreaterThan(calls.indexOf(verify));
  });

  it("changes nothing when the tag is missing", () => {
    const { status, calls, output } = run(["abcdef1"], { ...happyReplies(), "aws ecr describe-images": { exit: 254 } });

    expect(status).not.toBe(0);
    expect(calls.some(isEcs)).toBe(false);
    expect(output).toContain("sha-abcdef1");
  });

  it("changes nothing when the signature doesn't verify", () => {
    const { status, calls, output } = run(["abcdef1"], { ...happyReplies(), "cosign verify": { exit: 1 } });

    expect(status).not.toBe(0);
    expect(calls.some(isEcs)).toBe(false);
    expect(output).toMatch(/signature/i);
  });

  it("registers a revision from the family's latest with only the app image changed", () => {
    const { status, calls } = run(["abcdef1"]);

    expect(status).toBe(0);
    expect(flag(named(calls, "aws", "ecs", "describe-task-definition")[0], "--task-definition")).toBe("pensieve-app");
    const [app, sidecar] = APP_TD.containerDefinitions;
    expect(fileInput(named(calls, "aws", "ecs", "register-task-definition")[0])).toEqual({
      family: "pensieve-app",
      taskRoleArn: APP_TD.taskRoleArn,
      executionRoleArn: APP_TD.executionRoleArn,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256",
      memory: "1024",
      containerDefinitions: [{ ...app, image: APP_IMAGE }, sidecar],
    });
  });

  it("points the service at the new revision, keeping its desired count, and waits for the rollout", () => {
    const replies = happyReplies({ desiredCount: 1 });
    replies["aws ecs describe-services"] = [
      service(CURRENT_TD, 1),
      service(NEW_TD, 1, "IN_PROGRESS"),
      service(NEW_TD, 1, "IN_PROGRESS"),
      service(NEW_TD, 1),
    ];
    const { status, calls } = run(["abcdef1"], replies);

    expect(status).toBe(0);
    expect(updates(calls)).toEqual([{ taskDefinition: NEW_TD, desiredCount: "1" }]);
    const update = named(calls, "aws", "ecs", "update-service")[0];
    const polls = named(calls, "aws", "ecs", "describe-services").filter((c) => calls.indexOf(c) > calls.indexOf(update));
    expect(polls).toHaveLength(3);
  });

  it("fails as soon as the circuit breaker fails the rollout", () => {
    const replies = happyReplies();
    replies["aws ecs describe-services"] = [service(CURRENT_TD, 1), service(NEW_TD, 1, "FAILED")];
    const { status, output } = run(["abcdef1"], replies);

    expect(status).not.toBe(0);
    expect(output).toMatch(/circuit breaker/i);
  });

  it("fails when the rollout doesn't finish in time, without claiming a rollback", () => {
    const replies = happyReplies();
    replies["aws ecs describe-services"] = [service(CURRENT_TD, 1), service(NEW_TD, 1, "IN_PROGRESS")];
    const { status, output } = run(["abcdef1"], replies);

    expect(status).not.toBe(0);
    expect(output).toMatch(/gave up waiting/i);
    expect(output).not.toMatch(/circuit breaker/i);
  });

  it("starts the first deploy's service at desired count 1", () => {
    const { status, calls } = run(["abcdef1"], happyReplies({ desiredCount: 0 }));

    expect(status).toBe(0);
    expect(updates(calls)).toEqual([{ taskDefinition: NEW_TD, desiredCount: "1" }]);
  });

  it("fails, linking the app log group, when the circuit breaker rolls back", () => {
    const summary = path.join(cli.dir, "summary.md");
    const { status, output } = run(["abcdef1"], happyReplies({ finalTd: CURRENT_TD }), { GITHUB_STEP_SUMMARY: summary });

    expect(status).not.toBe(0);
    expect(output).toContain("/ecs/pensieve-app");
    const text = readFileSync(summary, "utf8");
    expect(text).toMatch(/:x:/);
    expect(text).toContain("https://eu-north-1.console.aws.amazon.com/cloudwatch/home?region=eu-north-1#logsV2:log-groups/log-group/$252Fecs$252Fpensieve-app");
  });

  it("never snapshots, migrates or runs a one-off task", () => {
    const { status, calls } = run(["abcdef1"]);

    expect(status).toBe(0);
    expect(calls.filter((c) => c.cmd === "aws" && c.args[0] === "rds")).toEqual([]);
    expect(named(calls, "aws", "ecs", "run-task")).toEqual([]);
  });

  it("writes the outcome to the GitHub job summary", () => {
    const summary = path.join(cli.dir, "summary.md");
    const { status } = run(["abcdef1"], happyReplies(), { GITHUB_STEP_SUMMARY: summary });

    expect(status).toBe(0);
    const text = readFileSync(summary, "utf8");
    expect(text).toContain("sha-abcdef1");
    expect(text).toContain(":white_check_mark:");
  });
});
