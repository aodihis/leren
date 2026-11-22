import { render } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

/**
 * Renders the platform's real route tree at `path` with an in-memory history, so that route guards,
 * redirects and navigation run exactly as they do in the browser. Tests replace the Better Auth
 * client and the API client, which are the platform's only network boundaries.
 */
export async function renderApp(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  await router.load();
  render(<RouterProvider router={router} />);

  return router;
}
