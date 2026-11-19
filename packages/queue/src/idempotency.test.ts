import { describe, expect, it, vi } from "vitest";

import { createInMemoryIdempotencyStore, runOnce } from "./idempotency";

describe("runOnce", () => {
  it("runs the work the first time a key is seen", async () => {
    const work = vi.fn().mockResolvedValue("done");

    const result = await runOnce(createInMemoryIdempotencyStore(), "key", work);

    expect(result).toEqual({ executed: true, value: "done" });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("skips the work when the key has already completed", async () => {
    const store = createInMemoryIdempotencyStore();
    const work = vi.fn().mockResolvedValue("done");

    await runOnce(store, "key", work);

    expect(await runOnce(store, "key", work)).toEqual({ executed: false });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("runs the work again for a different key", async () => {
    const store = createInMemoryIdempotencyStore();
    const work = vi.fn().mockResolvedValue("done");

    await runOnce(store, "a", work);
    await runOnce(store, "b", work);

    expect(work).toHaveBeenCalledTimes(2);
  });

  it("releases the key when the work throws so that a retry can run it", async () => {
    const store = createInMemoryIdempotencyStore();
    const work = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");

    await expect(runOnce(store, "key", work)).rejects.toThrow("boom");

    expect(await runOnce(store, "key", work)).toEqual({ executed: true, value: "ok" });
  });

  it("does not run the work while another run of the same key is in progress", async () => {
    const store = createInMemoryIdempotencyStore();

    const slow = runOnce(
      store,
      "key",
      () => new Promise<void>((resolve) => setTimeout(resolve, 20)),
    );

    const work = vi.fn();

    expect(await runOnce(store, "key", work)).toEqual({ executed: false });

    await slow;

    expect(work).not.toHaveBeenCalled();
  });
});
