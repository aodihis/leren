/** The roles that a worker process can run. */
export const WORKER_ROLES = ["listener", "processor", "indexer"] as const;

export type WorkerRole = (typeof WORKER_ROLES)[number];

/** The result of reading the roles of a process. */
export type ParsedRoles = { roles: WorkerRole[] } | { error: string };

function isWorkerRole(name: string): name is WorkerRole {
  return (WORKER_ROLES as readonly string[]).includes(name);
}

/** Reads the WORKER_ROLES value. */
export function parseWorkerRoles(value: string | undefined): ParsedRoles {
  const names = (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (names.length === 0) {
    return { roles: [...WORKER_ROLES] };
  }

  const unknown = names.filter((name) => !isWorkerRole(name));

  if (unknown.length > 0) {
    return {
      error: `Unknown role ${unknown.map((name) => `"${name}"`).join(", ")}. The roles are ${WORKER_ROLES.join(", ")}`,
    };
  }

  return { roles: WORKER_ROLES.filter((role) => names.includes(role)) };
}
