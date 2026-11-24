/** Records which units of work have begun. */
export type IdempotencyStore = {
  begin(key: string): Promise<boolean>;
  complete(key: string): Promise<void>;
  release(key: string): Promise<void>;
};

/** An in-memory idempotency store for tests. */
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

/** Runs work once per idempotency key. */
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
