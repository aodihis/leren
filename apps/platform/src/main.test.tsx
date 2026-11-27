import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ render: vi.fn(), createRoot: vi.fn() }));

vi.mock("react-dom/client", () => ({ createRoot: mocks.createRoot }));

vi.mock("./index.css", () => ({}));

vi.mock("./routeTree.gen", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");

  return { routeTree: createRootRoute() };
});

/** Loads the entry point of the web application, as the browser does. */
async function boot() {
  vi.resetModules();
  await import("./main");
}

describe("web application entry point", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders the router into the root element", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    mocks.createRoot.mockReturnValue({ render: mocks.render });

    await boot();

    expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(mocks.render).toHaveBeenCalledOnce();
  });

  it("refuses to start without the root element", async () => {
    await expect(boot()).rejects.toThrow("The root element is missing");
    expect(mocks.createRoot).not.toHaveBeenCalled();
  });
});
