/**
 * Records which units of work have started or finished, keyed by an idempotency key.
 *
 * `begin` returns true for the caller that may do the work, and false when another run has
 * already begun or completed it. `release` makes the key available again after a failed run.
 */
export type IdempotencyStore = {
  begin(key: string): Promise<boolean>;
  complete(key: string): Promise<void>;
  release(key: string): Promise<void>;
};

/** Keeps the keys in process memory. They do not survive a restart, so use it in tests only. */
export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const started = new Set<string>();

  return {
    async begin(key) {
      if (started.has(key)) {
        return false;
      }

      started.add(key);

      return true;
    },
    async complete() {},
    async release(key) {
      started.delete(key);
    },
  };
}

export type IdempotentResult<T> = { executed: true; value: T } | { executed: false };

/**
 * Runs `work` unless `key` has already begun or completed, which makes a redelivered message
 * harmless. The key is released when `work` throws, so the retry can run the work again.
 */
export async function runOnce<T>(
  store: IdempotencyStore,
  key: string,
  work: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  if (!(await store.begin(key))) {
    return { executed: false };
  }

  try {
    const value = await work();

    await store.complete(key);

    return { executed: true, value };
  } catch (error) {
    await store.release(key);

    throw error;
  }
}
