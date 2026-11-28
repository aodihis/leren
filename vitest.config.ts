import { defineConfig } from "vitest/config";

/**
 * Runs the unit tests of every app and package from the repository root.
 *
 * `apps/platform` is its own project because its component tests need a DOM. Coverage thresholds
 * apply to the combined source. The agent packages are excluded because agents are evaluated with
 * evals, and generated or vendored files are excluded.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    clearMocks: true,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["apps/!(platform)/src/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "platform",
          include: ["apps/platform/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["apps/platform/vitest.setup.ts"],
        },
      },
    ],
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
