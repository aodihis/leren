import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * The router scrolls to the top after each navigation, and jsdom reports that `scrollTo` is not
 * implemented. Replacing it with a no-op keeps the test output free of that noise.
 */
vi.stubGlobal("scrollTo", vi.fn());

/**
 * The one-time-code input probes the page with `elementFromPoint` to detect password-manager
 * badges, and jsdom does not implement it. Reporting that no element is at the point is what a
 * browser without such a badge reports.
 */
document.elementFromPoint = () => null;

/**
 * Radix measures a switch with a `ResizeObserver`, and jsdom does not implement it. This observer
 * never reports a size, which is what a browser reports for an element that has no layout.
 */
vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

/**
 * Unmounts the components that a test rendered, so that the next test starts with an empty
 * document. Testing Library registers this itself only when the runner exposes global hooks, and
 * this repository's Vitest configuration does not.
 */
afterEach(() => {
  cleanup();
});
