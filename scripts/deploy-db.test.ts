import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Call, type Replies, createStubCli, fileInput, flag, isEcs, json, named } from "./test-support/stub-cli";

/**
 * Ticket 54 (spec 13, "`deploy-db` workflow"): scripts/deploy-db.sh, the
 * maintenance window the deploy-db workflow runs, against stub `aws` and
 * `cosign` executables (./test-support/stub-cli.ts).
 */

const SCRIPT = path.join(process.cwd(), "scripts", "deploy-db.sh");
const ACCOUNT = "111122223333";
const REGISTRY = `${ACCOUNT}.dkr.ecr.eu-north-1.amazonaws.com`;
const DB_DIGEST = `sha256:${"db".repeat(32)}`;
const APP_DIGEST = `sha256:${"aa".repeat(32)}`;
const DB_IMAGE = `${REGISTRY}/pensieve-db@${DB_DIGEST}`;
const APP_IMAGE = `${REGISTRY}/pensieve@${APP_DIGEST}`;
const td = (family: string, revision: number) =>
  `arn:aws:ecs:eu-north-1:${ACCOUNT}:task-definition/${family}:${revision}`;
const RECORDED_APP_TD = td("pensieve-app", 4);
const NEW_APP_TD = td("pensieve-app", 5);
const NEW_MIGRATE_TD = td("pensieve-migrate", 3);
const TASK_ARN = `arn:aws:ecs:eu-north-1:${ACCOUNT}:task/pensieve/fedcba9876543210fedcba9876543210`;
const NETWORK = {
  awsvpcConfiguration: { subnets: ["subnet-0aaa"], securityGroups: ["sg-0bbb"], assignPublicIp: "DISABLED" },
};
const DB_IDENTITY = "https://github.com/sgspinola/pensieve/.github/workflows/db.yml@refs/heads/main";
const APP_IDENTITY = "https://github.com/sgspinola/pensieve/.github/workflows/ci.yml@refs/heads/main";

const MIGRATE_TD = {
  taskDefinitionArn: td("pensieve-migrate", 2),
  family: "pensieve-migrate",
  revision: 2,
  status: "ACTIVE",
  taskRoleArn: `arn:aws:iam::${ACCOUNT}:role/pensieve-migrate-task`,
  executionRoleArn: `arn:aws:iam::${ACCOUNT}:role/pensieve-migrate-execution`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "1024",
  containerDefinitions: [
    {
      name: "migrate",
      image: `${REGISTRY}/pensieve-db:main`,
      essential: true,
      command: ["migrate.cjs"],
      environment: [
        { name: "PGHOST", value: "pensieve.example.eu-north-1.rds.amazonaws.com" },
        { name: "PGUSER", value: "pensieve_migrator" },
      ],
      logConfiguration: {
        logDriver: "awslogs",
        options: { "awslogs-group": "/ecs/pensieve-migrate", "awslogs-region": "eu-north-1", "awslogs-stream-prefix": "migrate" },
      },
    },
  ],
  compatibilities: ["EC2", "FARGATE"],
  registeredAt: "2026-10-01T10:00:00.000Z",
};

const APP_TD = {
  taskDefinitionArn: RECORDED_APP_TD,
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
    { name: "app", image: `${REGISTRY}/pensieve@sha256:${"00".repeat(32)}`, essential: true },
    { name: "cloudflared", image: "cloudflare/cloudflared:2026.10.0@sha256:abc", essential: true },
  ],
  compatibilities: ["EC2", "FARGATE"],
  registeredAt: "2026-10-01T10:00:00.000Z",
};

function service(taskDefinition: string, desiredCount: number, rolloutState = "COMPLETED", runningCount = desiredCount) {
  return json({
    services: [
      {
        serviceName: "pensieve",
        taskDefinition,
        desiredCount,
        runningCount,
        networkConfiguration: NETWORK,
        deployments: [{ status: "PRIMARY", taskDefinition, rolloutState }],
      },
    ],
  });
}

function happyReplies({ desiredCount = 1, migrateExit = 0, finalTd = RECORDED_APP_TD } = {}): Replies {
  return {
    "aws sts get-caller-identity": json({ Account: ACCOUNT }),
    "aws ecr describe-images pensieve-db": json({ imageDetails: [{ imageDigest: DB_DIGEST }] }),
    "aws ecr describe-images pensieve": json({ imageDetails: [{ imageDigest: APP_DIGEST }] }),
    "aws ecr get-login-password": { stdout: "ecr-token" },
    "cosign login": {},
    "cosign verify": json([{ critical: {} }]),
    // The recorded state; after scaling to 0; the network config for the
    // migrate task; then the state after the final update.
    "aws ecs describe-services": [
      service(RECORDED_APP_TD, desiredCount),
      service(RECORDED_APP_TD, 0),
      service(RECORDED_APP_TD, 0),
      service(finalTd, desiredCount),
    ],
    "aws ecs update-service": json({ service: {} }),
    "aws rds create-db-snapshot": json({ DBSnapshot: {} }),
    "aws rds wait db-snapshot-available": {},
    "aws ecs describe-task-definition pensieve-migrate": json({ taskDefinition: MIGRATE_TD }),
    "aws ecs describe-task-definition pensieve-app": json({ taskDefinition: APP_TD }),
    "aws ecs register-task-definition": [
      json({ taskDefinition: { taskDefinitionArn: NEW_MIGRATE_TD } }),
      json({ taskDefinition: { taskDefinitionArn: NEW_APP_TD } }),
    ],
    "aws ecs run-task": json({ tasks: [{ taskArn: TASK_ARN }], failures: [] }),
    "aws ecs wait tasks-stopped": {},
    "aws logs get-log-events": json({ events: [{ message: "Applied 1 migration" }] }),
    "aws ecs describe-tasks": json({
      tasks: [{ taskArn: TASK_ARN, stoppedReason: "Essential container in task exited", containers: [{ name: "migrate", exitCode: migrateExit }] }],
    }),
    "aws rds describe-db-snapshots": json({
      DBSnapshots: [
        { DBSnapshotIdentifier: "pensieve-predeploy-0000000-20261001000000" },
        { DBSnapshotIdentifier: "pensieve-predeploy-1111111-20261005000000" },
        { DBSnapshotIdentifier: "pensieve-manual-keep-me" },
      ],
    }),
    "aws rds delete-db-snapshot": json({ DBSnapshot: {} }),
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

const isRds = (c: Call) => c.cmd === "aws" && c.args[0] === "rds";
const updates = (calls: Call[]) =>
  named(calls, "aws", "ecs", "update-service").map((c) => ({
    taskDefinition: flag(c, "--task-definition"),
    desiredCount: flag(c, "--desired-count"),
  }));
const snapshotName = (calls: Call[]) =>
  flag(named(calls, "aws", "rds", "create-db-snapshot")[0], "--db-snapshot-identifier");
const index = (calls: Call[], cmd: string, ...sub: string[]) => calls.indexOf(named(calls, cmd, ...sub)[0]);

describe("deploy-db.sh", () => {
  it("rejects arguments that aren't commit SHAs, calling nothing", () => {
    for (const args of [[], ["main"], ["123456"], ["1234567", "not-a-sha"], ["1234567", "abcdef1", "extra"]]) {
      const { status, calls } = run(args);
      expect(status, args.join(" ")).not.toBe(0);
      expect(calls).toEqual([]);
    }
  });

  it("verifies the DB image against db.yml's main identity before touching ECS or RDS", () => {
    const { status, calls } = run(["1234567abc"]);

    expect(status).toBe(0);
    const verifies = named(calls, "cosign", "verify");
    expect(verifies).toHaveLength(1);
    expect(flag(verifies[0], "--certificate-identity")).toBe(DB_IDENTITY);
    expect(flag(verifies[0], "--certificate-oidc-issuer")).toBe("https://token.actions.githubusercontent.com");
    expect(verifies[0].args.at(-1)).toBe(DB_IMAGE);
    const firstChange = calls.findIndex((c) => isEcs(c) || isRds(c));
    expect(firstChange).toBeGreaterThan(calls.indexOf(verifies[0]));
  });

  it("with an app SHA, also verifies the app image against ci.yml's main identity first", () => {
    const { status, calls } = run(["1234567", "abcdef1"], happyReplies({ finalTd: NEW_APP_TD }));

    expect(status).toBe(0);
    const verifies = named(calls, "cosign", "verify");
    expect(verifies.map((v) => [flag(v, "--certificate-identity"), v.args.at(-1)])).toEqual([
      [DB_IDENTITY, DB_IMAGE],
      [APP_IDENTITY, APP_IMAGE],
    ]);
    const describeApp = named(calls, "aws", "ecr", "describe-images").map((c) => flag(c, "--image-ids"));
    expect(describeApp).toEqual(["imageTag=sha-1234567", "imageTag=sha-abcdef1"]);
    expect(calls.findIndex((c) => isEcs(c) || isRds(c))).toBeGreaterThan(calls.indexOf(verifies[1]));
  });

  it("changes nothing when a signature doesn't verify", () => {
    const { status, calls, output } = run(["1234567"], { ...happyReplies(), "cosign verify": { exit: 1 } });

    expect(status).not.toBe(0);
    expect(calls.some((c) => isEcs(c) || isRds(c))).toBe(false);
    expect(output).toMatch(/signature/i);
  });

  it("scales the service to 0 with its recorded revision and waits, before the snapshot", () => {
    const { status, calls } = run(["1234567"]);

    expect(status).toBe(0);
    expect(updates(calls)[0]).toEqual({ taskDefinition: RECORDED_APP_TD, desiredCount: "0" });
    const update = index(calls, "aws", "ecs", "update-service");
    const settled = calls.findIndex((c, i) => i > update && c.args[1] === "describe-services");
    expect(settled).toBeGreaterThan(update);
    expect(index(calls, "aws", "rds", "create-db-snapshot")).toBeGreaterThan(settled);
  });

  it("takes a named pre-deploy snapshot and waits for it before migrating", () => {
    const { status, calls } = run(["1234567abc"]);

    expect(status).toBe(0);
    const create = named(calls, "aws", "rds", "create-db-snapshot")[0];
    expect(flag(create, "--db-instance-identifier")).toBe("pensieve");
    expect(snapshotName(calls)).toMatch(/^pensieve-predeploy-1234567-\d{14}$/);
    const wait = named(calls, "aws", "rds", "wait", "db-snapshot-available")[0];
    expect(flag(wait, "--db-snapshot-identifier")).toBe(snapshotName(calls));
    expect(index(calls, "aws", "ecs", "run-task")).toBeGreaterThan(calls.indexOf(wait));
  });

  it("registers a migrate revision from the family's latest with the image changed and breaking migrations refused", () => {
    const { status, calls } = run(["1234567"]);

    expect(status).toBe(0);
    const register = named(calls, "aws", "ecs", "register-task-definition")[0];
    const [container] = MIGRATE_TD.containerDefinitions;
    expect(fileInput(register)).toEqual({
      family: "pensieve-migrate",
      taskRoleArn: MIGRATE_TD.taskRoleArn,
      executionRoleArn: MIGRATE_TD.executionRoleArn,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256",
      memory: "1024",
      containerDefinitions: [
        { ...container, image: DB_IMAGE, environment: [...container.environment, { name: "ALLOW_BREAKING", value: "false" }] },
      ],
    });
  });

  it("refuses breaking migrations without an app SHA, even when the latest revision allowed them", () => {
    const allowing = {
      ...MIGRATE_TD,
      containerDefinitions: [
        {
          ...MIGRATE_TD.containerDefinitions[0],
          environment: [...MIGRATE_TD.containerDefinitions[0].environment, { name: "ALLOW_BREAKING", value: "true" }],
        },
      ],
    };
    const { status, calls } = run(["1234567"], {
      ...happyReplies(),
      "aws ecs describe-task-definition pensieve-migrate": json({ taskDefinition: allowing }),
    });

    expect(status).toBe(0);
    const input = fileInput(named(calls, "aws", "ecs", "register-task-definition")[0]) as typeof MIGRATE_TD;
    expect(input.containerDefinitions[0].environment).toEqual([
      ...MIGRATE_TD.containerDefinitions[0].environment,
      { name: "ALLOW_BREAKING", value: "false" },
    ]);
  });

  it("allows breaking migrations only when an app SHA is given", () => {
    const { calls } = run(["1234567", "abcdef1"], happyReplies({ finalTd: NEW_APP_TD }));

    const input = fileInput(named(calls, "aws", "ecs", "register-task-definition")[0]) as typeof MIGRATE_TD;
    expect(input.containerDefinitions[0].environment).toEqual([
      ...MIGRATE_TD.containerDefinitions[0].environment,
      { name: "ALLOW_BREAKING", value: "true" },
    ]);
  });

  it("runs the migrate revision in the service's network config and waits for it", () => {
    const { status, calls, output } = run(["1234567"]);

    expect(status).toBe(0);
    const runTask = named(calls, "aws", "ecs", "run-task")[0];
    expect(flag(runTask, "--cluster")).toBe("pensieve");
    expect(flag(runTask, "--task-definition")).toBe(NEW_MIGRATE_TD);
    expect(JSON.parse(flag(runTask, "--network-configuration"))).toEqual(NETWORK);
    expect(flag(named(calls, "aws", "ecs", "wait", "tasks-stopped")[0], "--tasks")).toBe(TASK_ARN);
    expect(output).toContain("Applied 1 migration");
  });

  it("without an app SHA, restarts the recorded revision at the recorded count", () => {
    const { status, calls } = run(["1234567"]);

    expect(status).toBe(0);
    expect(updates(calls)).toEqual([
      { taskDefinition: RECORDED_APP_TD, desiredCount: "0" },
      { taskDefinition: RECORDED_APP_TD, desiredCount: "1" },
    ]);
    expect(index(calls, "aws", "ecs", "update-service") < index(calls, "aws", "ecs", "run-task")).toBe(true);
  });

  it("keeps a first deploy's service at 0 (deploy-app starts it)", () => {
    const { status, calls } = run(["1234567"], happyReplies({ desiredCount: 0 }));

    expect(status).toBe(0);
    expect(updates(calls).at(-1)).toEqual({ taskDefinition: RECORDED_APP_TD, desiredCount: "0" });
  });

  it("with an app SHA, starts a new app revision with only the app image changed", () => {
    const { status, calls } = run(["1234567", "abcdef1"], happyReplies({ finalTd: NEW_APP_TD }));

    expect(status).toBe(0);
    const register = named(calls, "aws", "ecs", "register-task-definition")[1];
    const [app, sidecar] = APP_TD.containerDefinitions;
    expect(fileInput(register)).toEqual({
      family: "pensieve-app",
      taskRoleArn: APP_TD.taskRoleArn,
      executionRoleArn: APP_TD.executionRoleArn,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256",
      memory: "1024",
      containerDefinitions: [{ ...app, image: APP_IMAGE }, sidecar],
    });
    expect(updates(calls).at(-1)).toEqual({ taskDefinition: NEW_APP_TD, desiredCount: "1" });
  });

  it("deletes the other pre-deploy snapshots, and nothing else, after a successful deploy", () => {
    const { status, calls } = run(["1234567"]);

    expect(status).toBe(0);
    const list = named(calls, "aws", "rds", "describe-db-snapshots")[0];
    expect(flag(list, "--db-instance-identifier")).toBe("pensieve");
    const deleted = named(calls, "aws", "rds", "delete-db-snapshot").map((c) => flag(c, "--db-snapshot-identifier"));
    expect(deleted).toEqual(["pensieve-predeploy-0000000-20261001000000", "pensieve-predeploy-1111111-20261005000000"]);
    expect(index(calls, "aws", "rds", "delete-db-snapshot")).toBeGreaterThan(
      calls.findLastIndex((c) => c.args[1] === "update-service"),
    );
  });

  it("on a failed or refused migration, restores the recorded revision and count and keeps the snapshots", () => {
    const { status, calls, output } = run(["1234567"], happyReplies({ migrateExit: 1 }));

    expect(status).not.toBe(0);
    expect(updates(calls)).toEqual([
      { taskDefinition: RECORDED_APP_TD, desiredCount: "0" },
      { taskDefinition: RECORDED_APP_TD, desiredCount: "1" },
    ]);
    expect(named(calls, "aws", "rds", "delete-db-snapshot")).toEqual([]);
    expect(output).toMatch(/migration failed or was refused/i);
    expect(output).toContain(snapshotName(calls));
  });

  it("fails before the snapshot when scaling to 0 fails", () => {
    const { status, calls } = run(["1234567"], { ...happyReplies(), "aws ecs update-service": { exit: 254 } });

    expect(status).not.toBe(0);
    expect(named(calls, "aws", "rds", "create-db-snapshot")).toEqual([]);
    expect(named(calls, "aws", "ecs", "run-task")).toEqual([]);
  });

  it("fails before the snapshot when tasks are still running after scaling to 0", () => {
    const replies = happyReplies();
    replies["aws ecs describe-services"] = [
      service(RECORDED_APP_TD, 1),
      service(RECORDED_APP_TD, 0, "COMPLETED", 1),
    ];
    const { status, calls } = run(["1234567"], replies);

    expect(status).not.toBe(0);
    expect(named(calls, "aws", "rds", "create-db-snapshot")).toEqual([]);
  });

  it("leaves the app stopped, without claiming nothing was applied, when the migration outlives the wait", () => {
    const { status, calls, output } = run(["1234567"], { ...happyReplies(), "aws ecs wait tasks-stopped": { exit: 255 } });

    expect(status).not.toBe(0);
    expect(updates(calls)).toEqual([{ taskDefinition: RECORDED_APP_TD, desiredCount: "0" }]);
    expect(output).toMatch(/may still be running/i);
    expect(output).not.toMatch(/nothing was migrated/i);
  });

  it("writes a failure line to the summary when it fails before the window", () => {
    const summary = path.join(cli.dir, "summary.md");
    const { status } = run(["1234567"], { ...happyReplies(), "cosign verify": { exit: 1 } }, { GITHUB_STEP_SUMMARY: summary });

    expect(status).not.toBe(0);
    expect(readFileSync(summary, "utf8")).toMatch(/:x:.*signature/i);
  });

  it("restores the service when the snapshot fails after scaling to 0", () => {
    const { status, calls } = run(["1234567"], { ...happyReplies(), "aws rds wait db-snapshot-available": { exit: 255 } });

    expect(status).not.toBe(0);
    expect(named(calls, "aws", "ecs", "run-task")).toEqual([]);
    expect(updates(calls).at(-1)).toEqual({ taskDefinition: RECORDED_APP_TD, desiredCount: "1" });
  });

  it("fails, pointing at the restore runbook and keeping the snapshots, when the new revision doesn't take", () => {
    // The circuit breaker rolled the service back to the recorded revision.
    const { status, calls, output } = run(["1234567", "abcdef1"], happyReplies({ finalTd: RECORDED_APP_TD }));

    expect(status).not.toBe(0);
    expect(output).toMatch(/restore runbook/i);
    expect(named(calls, "aws", "rds", "delete-db-snapshot")).toEqual([]);
  });

  it("writes the outcome to the GitHub job summary", () => {
    const summary = path.join(cli.dir, "summary.md");
    const { status } = run(["1234567"], happyReplies(), { GITHUB_STEP_SUMMARY: summary });

    expect(status).toBe(0);
    const text = readFileSync(summary, "utf8");
    expect(text).toContain("deploy-db");
    expect(text).toContain("sha-1234567");
  });
});
