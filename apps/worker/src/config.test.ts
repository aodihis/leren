import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

const validEnv = {
  DATABASE_URL: "postgres://leren:leren@localhost:54329/leren",
  VECTOR_STORE_URL: "http://localhost:16333",
  RABBITMQ_URL: "amqp://leren:leren@localhost:56720",
};

/** The valid environment without the vector store. */
const { VECTOR_STORE_URL: _unused, ...withoutStore } = validEnv;

const loadWithTypo = () => loadConfig({ ...withoutStore, WORKER_ROLES: "listner" });

describe("loadConfig", () => {
  it("reads the reply model key as optional", () => {
    expect(loadConfig(validEnv).REPLY_MODEL).toBeUndefined();
    expect(loadConfig({ ...validEnv, REPLY_MODEL: "fast" }).REPLY_MODEL).toBe("fast");
  });

  it("reads the MCP settings of the reply pipeline and requires a long secret", () => {
    const config = loadConfig(validEnv);

    expect(config.MCP_SESSION_SECRET).toBeUndefined();
    expect(config.MCP_URL).toBe("http://localhost:3000/mcp");
    expect(() => loadConfig({ ...validEnv, MCP_SESSION_SECRET: "short" })).toThrow(
      /MCP_SESSION_SECRET/,
    );
  });

  it("reads empty MCP variables as not set", () => {
    const config = loadConfig({ ...validEnv, MCP_SESSION_SECRET: "", MCP_URL: "" });

    expect(config.MCP_SESSION_SECRET).toBeUndefined();
    expect(config.MCP_URL).toBe("http://localhost:3000/mcp");
  });

  it("reads the poll interval in seconds and defaults it to one minute", () => {
    expect(loadConfig(validEnv).EMAIL_POLL_INTERVAL_SECONDS).toBe(60);
    expect(
      loadConfig({ ...validEnv, EMAIL_POLL_INTERVAL_SECONDS: "5" }).EMAIL_POLL_INTERVAL_SECONDS,
    ).toBe(5);
  });

  it("requires the settings of an enabled provider", () => {
    expect(() => loadConfig({ ...validEnv, CHANNEL_PROVIDERS: "google" })).toThrow(
      /GOOGLE_CLIENT_ID[\s\S]*GOOGLE_CLIENT_SECRET[\s\S]*CHANNEL_TOKEN_ENCRYPTION_KEY/,
    );
    expect(() => loadConfig({ ...validEnv, CHANNEL_PROVIDERS: "unknown" })).toThrow(
      /CHANNEL_PROVIDERS/,
    );
  });

  describe("worker roles (decision 0045)", () => {
    it("starts every role when WORKER_ROLES is not set or is empty", () => {
      const all = ["listener", "processor", "indexer"];

      expect(loadConfig(validEnv).WORKER_ROLES).toEqual(all);
      expect(loadConfig({ ...validEnv, WORKER_ROLES: "" }).WORKER_ROLES).toEqual(all);
    });

    it("reads the roles that are named", () => {
      expect(loadConfig({ ...validEnv, WORKER_ROLES: "processor" }).WORKER_ROLES).toEqual([
        "processor",
      ]);
    });

    it("stops with an error that lists the valid roles when a name is unknown", () => {
      expect(() => loadConfig({ ...validEnv, WORKER_ROLES: "listner" })).toThrow(
        /WORKER_ROLES: Unknown role "listner". The roles are listener, processor, indexer/,
      );
    });

    it("needs the vector store only for the indexer role", () => {
      expect(() => loadConfig({ ...withoutStore, WORKER_ROLES: "indexer" })).toThrow(
        /VECTOR_STORE_URL/,
      );
      expect(() => loadConfig({ ...withoutStore })).toThrow(/VECTOR_STORE_URL/);
      expect(
        loadConfig({ ...withoutStore, WORKER_ROLES: "listener,processor" }).VECTOR_STORE_URL,
      ).toBeUndefined();
    });

    it("needs the settings of the enabled providers only for the roles that use a mailbox", () => {
      const google = { ...validEnv, CHANNEL_PROVIDERS: "google" };

      expect(() => loadConfig({ ...google, WORKER_ROLES: "listener" })).toThrow(/GOOGLE_CLIENT_ID/);
      expect(() => loadConfig({ ...google, WORKER_ROLES: "processor" })).toThrow(
        /GOOGLE_CLIENT_ID/,
      );
      expect(loadConfig({ ...google, WORKER_ROLES: "indexer" }).WORKER_ROLES).toEqual(["indexer"]);
    });

    it("reports only the unknown role, and not the settings of roles it did not name, when the value is invalid", () => {
      expect(loadWithTypo).toThrow(/WORKER_ROLES: Unknown role "listner"/);
      expect(loadWithTypo).not.toThrow(/VECTOR_STORE_URL/);
    });
  });

  it("lists every missing variable in one error", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*VECTOR_STORE_URL[\s\S]*RABBITMQ_URL/);
  });
});
