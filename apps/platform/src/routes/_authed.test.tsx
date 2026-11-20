import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../modules/auth/auth-client", () => ({ authClient }));

import { renderApp } from "../testing";

function sessionFor(user: { name: string; email: string }) {
  return {
    data: { user: { id: "u1", firstName: "Ada", lastName: "Lovelace", ...user } },
    error: null,
  };
}

describe("authenticated layout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("redirects a visitor without a session to the login page", async () => {
    authClient.getSession.mockResolvedValue({ data: null, error: { status: 401 } });

    const router = await renderApp("/about");

    expect(router.state.location.pathname).toBe("/login");
  });

  it("reports an unreachable server instead of redirecting to the login page", async () => {
    authClient.getSession.mockResolvedValue({ data: null, error: { status: 500 } });

    const router = await renderApp("/about");

    expect(router.state.location.pathname).toBe("/about");
    expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();
  });

  it.each([
    ["name", "Ada Lovelace", "Ada Lovelace"],
    ["email when the user has no name", "", "ada@example.com"],
  ])("shows the user's %s next to the navigation", async (_, name, label) => {
    authClient.getSession.mockResolvedValue(sessionFor({ name, email: "ada@example.com" }));

    await renderApp("/about");

    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "About" })).toBeTruthy();
  });

  it("signs the user out and opens the login page", async () => {
    authClient.getSession.mockResolvedValue(
      sessionFor({ name: "Ada Lovelace", email: "ada@example.com" }),
    );
    authClient.signOut.mockImplementation(async () => {
      authClient.getSession.mockResolvedValue({ data: null, error: { status: 401 } });
    });
    const user = userEvent.setup();
    const router = await renderApp("/about");

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Sign in to Leren")).toBeTruthy();
    expect(authClient.signOut).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe("/login");
  });
});
