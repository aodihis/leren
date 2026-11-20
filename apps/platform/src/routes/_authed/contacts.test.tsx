import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const contactsApi = vi.hoisted(() => ({
  $get: vi.fn(),
  $post: vi.fn(),
  ":id": { $put: vi.fn(), $delete: vi.fn() },
}));

vi.mock("../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../modules/api/api-client", () => ({ api: { api: { contacts: contactsApi } } }));

import { renderApp } from "../../testing";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const dewi = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Dewi",
  email: "dewi@example.com",
  role: "Project lead",
};

describe("contacts route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    contactsApi.$get.mockImplementation(() => jsonResponse({ contacts: [] }, 200));
  });

  it("lists the contacts", async () => {
    contactsApi.$get.mockImplementation(() => jsonResponse({ contacts: [dewi] }, 200));
    await renderApp("/contacts");

    expect(await screen.findByText("dewi@example.com")).toBeTruthy();
    expect(screen.getByText("Project lead")).toBeTruthy();
  });

  it("adds a contact, clears the form and reloads the list", async () => {
    contactsApi.$post.mockImplementation(() => jsonResponse({ contact: dewi }, 201));
    contactsApi.$get
      .mockImplementationOnce(() => jsonResponse({ contacts: [] }, 200))
      .mockImplementation(() => jsonResponse({ contacts: [dewi] }, 200));
    const user = userEvent.setup();

    await renderApp("/contacts");
    await user.type(await screen.findByLabelText("Name"), "Dewi");
    await user.type(screen.getByLabelText("Email"), "dewi@example.com");
    await user.type(screen.getByLabelText("Role"), "Project lead");
    await user.click(screen.getByRole("button", { name: "Add contact" }));

    expect(await screen.findByRole("cell", { name: "dewi@example.com" })).toBeTruthy();
    expect(contactsApi.$post).toHaveBeenCalledExactlyOnceWith({
      json: { name: "Dewi", email: "dewi@example.com", role: "Project lead" },
    });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });

  it("shows the error of the API when the address is already used", async () => {
    contactsApi.$post.mockResolvedValue(
      jsonResponse(
        { fieldErrors: { email: ["You already have a contact with this address"] } },
        400,
      ),
    );
    const user = userEvent.setup();

    await renderApp("/contacts");
    await user.type(await screen.findByLabelText("Name"), "Dewi");
    await user.type(screen.getByLabelText("Email"), "dewi@example.com");
    await user.click(screen.getByRole("button", { name: "Add contact" }));

    expect(await screen.findByText("You already have a contact with this address")).toBeTruthy();
  });

  it("edits a contact with the form", async () => {
    contactsApi.$get.mockImplementation(() => jsonResponse({ contacts: [dewi] }, 200));
    contactsApi[":id"].$put.mockImplementation(() => jsonResponse({ contact: dewi }, 200));
    const user = userEvent.setup();

    await renderApp("/contacts");
    await user.click(await screen.findByRole("button", { name: "Edit Dewi" }));
    await user.clear(screen.getByLabelText("Role"));
    await user.type(screen.getByLabelText("Role"), "Director");
    await user.click(screen.getByRole("button", { name: "Save contact" }));

    expect(contactsApi[":id"].$put).toHaveBeenCalledExactlyOnceWith({
      param: { id: dewi.id },
      json: { name: "Dewi", email: "dewi@example.com", role: "Director" },
    });
  });

  it("tells the user when a contact could not be deleted", async () => {
    contactsApi.$get.mockImplementation(() => jsonResponse({ contacts: [dewi] }, 200));
    contactsApi[":id"].$delete.mockImplementation(() => jsonResponse({ error: "boom" }, 500));
    const user = userEvent.setup();

    await renderApp("/contacts");
    await user.click(await screen.findByRole("button", { name: "Delete Dewi" }));

    expect(await screen.findByText("Could not delete the contact")).toBeTruthy();
  });
});
