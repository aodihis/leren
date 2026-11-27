import { afterEach, describe, expect, it, vi } from "vitest";
import { runSuites } from "./run";

function suites() {
  return { first: vi.fn(async () => undefined), second: vi.fn(async () => undefined) };
}

describe("runSuites", () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("runs every suite when none is named, and releases the shared resources", async () => {
    const loaders = suites();
    const close = vi.fn(async () => undefined);

    await runSuites({ suites: loaders, requested: [], close });

    expect(loaders.first).toHaveBeenCalledOnce();
    expect(loaders.second).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("runs only the named suites", async () => {
    const loaders = suites();

    await runSuites({ suites: loaders, requested: ["second"] });

    expect(loaders.first).not.toHaveBeenCalled();
    expect(loaders.second).toHaveBeenCalledOnce();
  });

  it("runs nothing and fails when a named suite does not exist", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loaders = suites();

    await runSuites({ suites: loaders, requested: ["first", "missing"] });

    expect(loaders.first).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith("Unknown eval: missing. Available: first, second");
  });

  it("releases the shared resources when a suite throws", async () => {
    const close = vi.fn(async () => undefined);

    await expect(
      runSuites({
        suites: { broken: async () => Promise.reject(new Error("boom")) },
        requested: [],
        close,
      }),
    ).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledOnce();
  });
});
