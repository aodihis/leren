import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/** Stubs scrollTo, which jsdom does not implement. */
vi.stubGlobal("scrollTo", vi.fn());

/** Stubs elementFromPoint, which jsdom lacks. */
document.elementFromPoint = () => null;

/** Stubs ResizeObserver, which jsdom lacks. */
vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

/** Unmounts rendered components after each test. */
afterEach(() => {
  cleanup();
});
