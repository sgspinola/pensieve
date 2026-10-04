import { describe, expect, it } from "vitest";
import { getConnectionConfig } from "./connection";

const unusedSigner = async () => {
  throw new Error("signer must not be called");
};
const unusedCaBundle = () => {
  throw new Error("CA bundle must not be read");
};

describe("getConnectionConfig", () => {
  it("uses DATABASE_URL as-is when it is set", () => {
    const config = getConnectionConfig(
      { DATABASE_URL: "postgres://u:p@localhost:5432/pensieve", PGHOST: "ignored.example" },
      { signToken: unusedSigner, readCaBundle: unusedCaBundle },
    );

    expect(config).toEqual({ url: "postgres://u:p@localhost:5432/pensieve" });
  });

  describe("without DATABASE_URL (RDS IAM auth)", () => {
    const rdsEnv = {
      PGHOST: "pensieve.abc123.eu-north-1.rds.amazonaws.com",
      PGPORT: "5432",
      PGDATABASE: "pensieve",
      PGUSER: "pensieve_app",
    };

    it("connects with the host, port, database and user from the environment", () => {
      const config = getConnectionConfig(rdsEnv, { signToken: unusedSigner, readCaBundle: () => "CA" });

      expect(config).toMatchObject({
        host: "pensieve.abc123.eu-north-1.rds.amazonaws.com",
        port: 5432,
        database: "pensieve",
        username: "pensieve_app",
      });
    });

    it("signs a fresh IAM token for that host, port and user on every password call", async () => {
      const calls: unknown[] = [];
      let issued = 0;
      const signToken = async (target: { hostname: string; port: number; username: string }) => {
        calls.push(target);
        issued += 1;
        return `token-${issued}`;
      };

      const config = getConnectionConfig(rdsEnv, { signToken, readCaBundle: () => "CA" });
      if (!("password" in config)) throw new Error("expected IAM config");

      expect(calls).toHaveLength(0);
      await expect(config.password()).resolves.toBe("token-1");
      await expect(config.password()).resolves.toBe("token-2");
      expect(calls).toEqual([
        { hostname: "pensieve.abc123.eu-north-1.rds.amazonaws.com", port: 5432, username: "pensieve_app" },
        { hostname: "pensieve.abc123.eu-north-1.rds.amazonaws.com", port: 5432, username: "pensieve_app" },
      ]);
    });

    it("requires TLS verified against the RDS CA bundle", () => {
      const bundle = "-----BEGIN CERTIFICATE-----\nRDS-CA\n-----END CERTIFICATE-----\n";
      const config = getConnectionConfig(rdsEnv, { signToken: unusedSigner, readCaBundle: () => bundle });

      expect(config).toMatchObject({ ssl: { ca: bundle, rejectUnauthorized: true } });
    });

    it("refuses to start when a connection variable is missing, naming each one", () => {
      expect(() =>
        getConnectionConfig({ PGPORT: "5432", PGDATABASE: "pensieve" }, {
          signToken: unusedSigner,
          readCaBundle: unusedCaBundle,
        }),
      ).toThrow("DATABASE_URL is not set, and neither are PGHOST, PGUSER");
    });
  });
});
