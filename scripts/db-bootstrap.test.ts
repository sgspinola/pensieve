import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Replies, createStubCli, fileInput, flag, isEcs, json, named } from "./test-support/stub-cli";

/**
 * Ticket 53 (spec 13, "Local script"): scripts/db-bootstrap.sh, run for real
 * against stub `aws` and `cosign` executables (./test-support/stub-cli.ts).
 */

const SCRIPT = path.join(process.cwd(), "scripts", "db-bootstrap.sh");
const ACCOUNT = "111122223333";
const REGISTRY = `${ACCOUNT}.dkr.ecr.eu-north-1.amazonaws.com`;
const DIGEST = `sha256:${"ab".repeat(32)}`;
const IMAGE = `${REGISTRY}/pensieve-db@${DIGEST}`;
const TASK_ARN = `arn:aws:ecs:eu-north-1:${ACCOUNT}:task/pensieve/0123456789abcdef0123456789abcdef`;
const NEW_TD_ARN = `arn:aws:ecs:eu-north-1:${ACCOUNT}:task-definition/pensieve-db-bootstrap:8`;

// What describe-task-definition returns for Terraform's revision (infra/prod/compute.tf),
// including the describe-only fields register-task-definition rejects.
const CURRENT_TD = {
  taskDefinitionArn: `arn:aws:ecs:eu-north-1:${ACCOUNT}:task-definition/pensieve-db-bootstrap:7`,
  family: "pensieve-db-bootstrap",
  revision: 7,
  status: "ACTIVE",
  executionRoleArn: `arn:aws:iam::${ACCOUNT}:role/pensieve-db-bootstrap-execution`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "1024",
  runtimePlatform: { cpuArchitecture: "ARM64", operatingSystemFamily: "LINUX" },
  containerDefinitions: [
    {
      name: "db-bootstrap",
      image: `${REGISTRY}/pensieve-db:main`,
      essential: true,
      command: ["bootstrap.cjs"],
      environment: [{ name: "PGHOST", value: "pensieve.example.eu-north-1.rds.amazonaws.com" }],
      secrets: [
        { name: "PGUSER", valueFrom: "arn:aws:secretsmanager:eu-north-1:111122223333:secret:rds!db-x:username::" },
        { name: "PGPASSWORD", valueFrom: "arn:aws:secretsmanager:eu-north-1:111122223333:secret:rds!db-x:password::" },
      ],
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": "/ecs/pensieve-db-bootstrap",
          "awslogs-region": "eu-north-1",
          "awslogs-stream-prefix": "db_bootstrap",
        },
      },
    },
  ],
  compatibilities: ["EC2", "FARGATE"],
  requiresAttributes: [{ name: "com.amazonaws.ecs.capability.execution-role-awslogs" }],
  registeredAt: "2026-10-01T10:00:00.000Z",
  registeredBy: `arn:aws:iam::${ACCOUNT}:user/pensieve-admin`,
};
// New revisions carry no tags: neither deploy role may tag
// (ecs:TagResource), so the scripts share one behaviour and don't ask for them.
const NETWORK = {
  awsvpcConfiguration: { subnets: ["subnet-0aaa"], securityGroups: ["sg-0bbb"], assignPublicIp: "DISABLED" },
};

function happyReplies(exitCode: number | null = 0): Replies {
  return {
    "aws sts get-caller-identity": json({ Account: ACCOUNT, Arn: `arn:aws:iam::${ACCOUNT}:user/pensieve-admin` }),
    "aws ecr describe-images": json({ imageDetails: [{ imageDigest: DIGEST, imageTags: ["sha-1234567"] }] }),
    "aws ecr get-login-password": { stdout: "ecr-token" },
    "cosign login": {},
    "cosign verify": json([{ critical: {} }]),
    "aws ecs describe-task-definition": json({ taskDefinition: CURRENT_TD }),
    "aws ecs register-task-definition": json({
      taskDefinition: { ...CURRENT_TD, taskDefinitionArn: NEW_TD_ARN, revision: 8 },
    }),
    "aws ecs describe-services": json({ services: [{ serviceName: "pensieve", networkConfiguration: NETWORK }] }),
    "aws ecs run-task": json({ tasks: [{ taskArn: TASK_ARN }], failures: [] }),
    "aws ecs wait": {},
    "aws logs get-log-events": json({ events: [{ message: "Bootstrap applied" }] }),
    "aws ecs describe-tasks": json({
      tasks: [
        {
          taskArn: TASK_ARN,
          lastStatus: "STOPPED",
          stoppedReason: "Essential container in task exited",
          containers: [{ name: "db-bootstrap", ...(exitCode === null ? {} : { exitCode }) }],
        },
      ],
    }),
  };
}

let cli: ReturnType<typeof createStubCli>;

beforeEach(() => {
  cli = createStubCli();
});

afterEach(() => {
  cli.cleanup();
});

const run = (args: string[], replies: Replies = happyReplies()) => cli.run(SCRIPT, args, replies);

describe("db-bootstrap.sh", () => {
  it("verifies the image by digest against db.yml's main identity before any ECS call", () => {
    const { status, calls } = run(["1234567abcdef"]);

    expect(status).toBe(0);
    const describe = named(calls, "aws", "ecr", "describe-images")[0];
    expect(flag(describe, "--repository-name")).toBe("pensieve-db");
    expect(flag(describe, "--image-ids")).toBe("imageTag=sha-1234567");

    const verifies = named(calls, "cosign", "verify");
    expect(verifies).toHaveLength(1);
    const verify = verifies[0];
    expect(flag(verify, "--certificate-identity")).toBe(
      "https://github.com/sgspinola/pensieve/.github/workflows/db.yml@refs/heads/main",
    );
    expect(flag(verify, "--certificate-oidc-issuer")).toBe("https://token.actions.githubusercontent.com");
    expect(verify.args.at(-1)).toBe(IMAGE);

    const firstEcs = calls.findIndex(isEcs);
    expect(firstEcs).toBeGreaterThan(calls.indexOf(verify));
  });

  it("makes no ECS call when the signature doesn't verify", () => {
    const { status, calls, output } = run(["1234567"], {
      ...happyReplies(),
      "cosign verify": { stdout: "", exit: 1 },
    });

    expect(status).not.toBe(0);
    expect(calls.some(isEcs)).toBe(false);
    expect(output).toMatch(/signature/i);
  });

  it("registers a revision from the family's latest with only the image changed", () => {
    const { status, calls } = run(["1234567"]);

    expect(status).toBe(0);
    const latest = named(calls, "aws", "ecs", "describe-task-definition")[0];
    expect(flag(latest, "--task-definition")).toBe("pensieve-db-bootstrap");

    const registers = named(calls, "aws", "ecs", "register-task-definition");
    expect(registers).toHaveLength(1);
    const input = fileInput(registers[0]);
    const [container] = CURRENT_TD.containerDefinitions;
    expect(input).toEqual({
      family: "pensieve-db-bootstrap",
      executionRoleArn: CURRENT_TD.executionRoleArn,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256",
      memory: "1024",
      runtimePlatform: CURRENT_TD.runtimePlatform,
      containerDefinitions: [{ ...container, image: IMAGE }],
    });
  });

  it("reuses the latest revision when it already runs that image", () => {
    const replies = happyReplies();
    replies["aws ecs describe-task-definition"] = json({
      taskDefinition: {
        ...CURRENT_TD,
        containerDefinitions: [{ ...CURRENT_TD.containerDefinitions[0], image: IMAGE }],
      },
    });
    const { status, calls } = run(["1234567"], replies);

    expect(status).toBe(0);
    expect(named(calls, "aws", "ecs", "register-task-definition")).toEqual([]);
    expect(flag(named(calls, "aws", "ecs", "run-task")[0], "--task-definition")).toBe(CURRENT_TD.taskDefinitionArn);
  });

  it("runs the revision as a one-off Fargate task in the service's network config", () => {
    const { status, calls } = run(["1234567"]);

    expect(status).toBe(0);
    const services = named(calls, "aws", "ecs", "describe-services")[0];
    expect(flag(services, "--cluster")).toBe("pensieve");
    expect(flag(services, "--services")).toBe("pensieve");

    const runs = named(calls, "aws", "ecs", "run-task");
    expect(runs).toHaveLength(1);
    expect(flag(runs[0], "--cluster")).toBe("pensieve");
    expect(flag(runs[0], "--task-definition")).toBe(NEW_TD_ARN);
    expect(flag(runs[0], "--launch-type")).toBe("FARGATE");
    expect(JSON.parse(flag(runs[0], "--network-configuration"))).toEqual(NETWORK);

    const wait = named(calls, "aws", "ecs", "wait", "tasks-stopped")[0];
    expect(flag(wait, "--tasks")).toBe(TASK_ARN);
    expect(calls.indexOf(wait)).toBeGreaterThan(calls.indexOf(runs[0]));
    expect(flag(named(calls, "aws", "ecs", "describe-tasks")[0], "--tasks")).toBe(TASK_ARN);
  });

  it("exits 0 and prints the log group and stream when the container exits 0", () => {
    const { status, output } = run(["1234567"]);

    expect(status).toBe(0);
    expect(output).toContain("/ecs/pensieve-db-bootstrap");
    expect(output).toContain("db_bootstrap/db-bootstrap/0123456789abcdef0123456789abcdef");
  });

  it("prints the task's own log output", () => {
    const { status, output, calls } = run(["1234567"]);

    expect(status).toBe(0);
    const logs = named(calls, "aws", "logs", "get-log-events")[0];
    expect(flag(logs, "--log-group-name")).toBe("/ecs/pensieve-db-bootstrap");
    expect(flag(logs, "--log-stream-name")).toBe("db_bootstrap/db-bootstrap/0123456789abcdef0123456789abcdef");
    expect(output).toContain("Bootstrap applied");
  });

  it("still succeeds when the log output can't be read", () => {
    const { status } = run(["1234567"], { ...happyReplies(), "aws logs get-log-events": { exit: 255 } });

    expect(status).toBe(0);
  });

  it("exits non-zero, still printing the logs, when the container exits non-zero", () => {
    const { status, output } = run(["1234567"], happyReplies(3));

    expect(status).not.toBe(0);
    expect(output).toContain("/ecs/pensieve-db-bootstrap");
    expect(output).toContain("db_bootstrap/db-bootstrap/0123456789abcdef0123456789abcdef");
    expect(output).toMatch(/exit code 3/);
  });

  it("exits non-zero when the container never ran (no exit code)", () => {
    const { status, output } = run(["1234567"], happyReplies(null));

    expect(status).not.toBe(0);
    expect(output).toContain("Essential container in task exited");
  });

  it("exits non-zero, printing the logs, when waiting for the task gives up", () => {
    const { status, output, calls } = run(["1234567"], { ...happyReplies(), "aws ecs wait": { exit: 255 } });

    expect(status).not.toBe(0);
    expect(output).toContain("db_bootstrap/db-bootstrap/0123456789abcdef0123456789abcdef");
    expect(named(calls, "aws", "ecs", "describe-tasks")).toEqual([]);
  });

  it("exits non-zero when ECS doesn't start the task", () => {
    const { status, output, calls } = run(["1234567"], {
      ...happyReplies(),
      "aws ecs run-task": json({ tasks: [], failures: [{ arn: NEW_TD_ARN, reason: "RESOURCE:ENI" }] }),
    });

    expect(status).not.toBe(0);
    expect(output).toContain("RESOURCE:ENI");
    expect(named(calls, "aws", "ecs", "wait")).toEqual([]);
  });

  it("rejects an argument that isn't a commit SHA, calling nothing", () => {
    for (const args of [[], ["main"], ["123456"], ["1234567", "extra"]]) {
      const { status, calls } = run(args);
      expect(status, args.join(" ")).not.toBe(0);
      expect(calls).toEqual([]);
    }
  });
});
