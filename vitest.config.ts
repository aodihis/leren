import { defineConfig } from "vitest/config";

/**
 * Runs the unit tests of every app and package from the repository root.
 *
 * Coverage thresholds apply to the combined source of all projects. `packages/agents`, `packages/assistant-agent` and `packages/reply-agent` are excluded
 * because agents are evaluated with evals, and generated or vendored files are excluded because
 * they are not written by hand.
 */
export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "packages/agents/**",
        "packages/assistant-agent/**",
        "packages/reply-agent/**",
        "apps/platform/src/routeTree.gen.ts",
        "packages/ui/src/components/ui/**",
        "packages/ui/src/hooks/**",
        "packages/ui/src/lib/utils.ts",
        "packages/ui/src/styles/**",
      ],
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
