/** The roles that a worker process can run (decision 0045). */
export const WORKER_ROLES = ["listener", "processor", "indexer"] as const;

export type WorkerRole = (typeof WORKER_ROLES)[number];

/** The result of reading the roles of a process: the roles, or what is wrong with the value. */
export type ParsedRoles = { roles: WorkerRole[] } | { error: string };

function isWorkerRole(name: string): name is WorkerRole {
  return (WORKER_ROLES as readonly string[]).includes(name);
}

/**
 * Reads the value of `WORKER_ROLES`: role names separated by commas. An empty or unset value
 * selects every role, so a development setup with one process needs no setting. A name that is not
 * a role is an error that lists the valid names, so that a typo stops the process at startup and
 * does not silently run fewer jobs. A repeated name counts once.
 */
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
