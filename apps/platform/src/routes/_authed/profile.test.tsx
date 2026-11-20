import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const patchProfile = vi.hoisted(() => vi.fn());

vi.mock("../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../modules/api/api-client", () => ({ api: { api: { me: { $patch: patchProfile } } } }));

import { renderApp } from "../../testing";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("profile route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: {
        user: {
          id: "u1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          firstName: "Ada",
          lastName: null,
        },
      },
      error: null,
    });
  });

  it("shows the user's email and current name", async () => {
    await renderApp("/profile");

    expect(
      await screen.findByText("ada@example.com", { selector: "[data-slot=card-description]" }),
    ).toBeTruthy();
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Ada");
    expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe("");
  });

  it("saves the edited name and opens the home page", async () => {
    patchProfile.mockResolvedValue(jsonResponse({ user: {} }, 200));
    const user = userEvent.setup();
    const router = await renderApp("/profile");

    await user.type(await screen.findByLabelText("Last name"), "Lovelace");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Welcome to Leren")).toBeTruthy();
    expect(patchProfile).toHaveBeenCalledExactlyOnceWith({
      json: { firstName: "Ada", lastName: "Lovelace" },
    });
    expect(router.state.location.pathname).toBe("/");
  });

  it("shows the API's field errors next to the fields it rejects", async () => {
    patchProfile.mockResolvedValue(
      jsonResponse({ fieldErrors: { firstName: ["First name is required"] } }, 400),
    );
    const user = userEvent.setup();
    const router = await renderApp("/profile");

    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByText("First name is required")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/profile");
  });

  it("shows a general error when the save fails for another reason", async () => {
    patchProfile.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    const user = userEvent.setup();
    const router = await renderApp("/profile");

    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByText("Could not save your profile")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/profile");
  });
});
