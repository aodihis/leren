import { describe, expect, it } from "vitest";

import { WORKER_ROLES, parseWorkerRoles } from "./roles";

describe("parseWorkerRoles", () => {
  it.each([undefined, "", "  ", " , "])("selects every role for %j", (value) => {
    expect(parseWorkerRoles(value)).toEqual({ roles: [...WORKER_ROLES] });
  });

  it("reads one role and several roles, and ignores spaces", () => {
    expect(parseWorkerRoles("listener")).toEqual({ roles: ["listener"] });
    expect(parseWorkerRoles(" processor , listener ")).toEqual({
      roles: ["listener", "processor"],
    });
  });

  it("counts a repeated role once", () => {
    expect(parseWorkerRoles("indexer,indexer")).toEqual({ roles: ["indexer"] });
  });

  it("names the unknown roles and lists the valid ones", () => {
    const result = parseWorkerRoles("listener,proccesor,other");

    expect(result).toEqual({
      error: 'Unknown role "proccesor", "other". The roles are listener, processor, indexer',
    });
  });
});
