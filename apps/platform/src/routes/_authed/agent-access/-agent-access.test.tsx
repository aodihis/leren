import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const mcpApi = vi.hoisted(() => ({
  tokens: { $get: vi.fn(), $post: vi.fn() },
  sessions: { ":id": { $delete: vi.fn() } },
}));

const playbooksApi = vi.hoisted(() => ({ $get: vi.fn() }));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: { api: { mcp: mcpApi, playbooks: playbooksApi } },
}));

import { renderApp } from "../../../testing";

const existing = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Claude Desktop",
  access: "read",
  createdAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2027-02-01T00:00:00.000Z",
};

describe("agent access route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    playbooksApi.$get.mockImplementation(async () => Response.json({ playbooks: [] }));
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
  });

  it("lists the active tokens", async () => {
    mcpApi.tokens.$get.mockImplementation(async () => Response.json({ tokens: [existing] }));

    await renderApp("/agent-access");

    expect(await screen.findByText("Claude Desktop")).toBeTruthy();
    expect(screen.getAllByText("Read only")).toHaveLength(2);
  });

  it("creates a token and shows its secret once", async () => {
    mcpApi.tokens.$get.mockImplementation(async () => Response.json({ tokens: [] }));
    mcpApi.tokens.$post.mockResolvedValue(
      Response.json({ token: "secret-token-value", accessToken: existing }, { status: 201 }),
    );

    await renderApp("/agent-access");

    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "Cursor");
    await user.selectOptions(screen.getByLabelText("Access"), "write");
    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(await screen.findByText("secret-token-value")).toBeTruthy();
    expect(mcpApi.tokens.$post).toHaveBeenCalledWith({
      json: { name: "Cursor", access: "write", expiresInDays: 90 },
    });
  });

  it("shows the name error from the API", async () => {
    mcpApi.tokens.$get.mockImplementation(async () => Response.json({ tokens: [] }));
    mcpApi.tokens.$post.mockResolvedValue(
      Response.json({ fieldErrors: { name: ["Enter a name"] } }, { status: 400 }),
    );

    await renderApp("/agent-access");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Create token" }));

    expect(await screen.findByText("Enter a name")).toBeTruthy();
  });

  it("revokes a token", async () => {
    mcpApi.tokens.$get.mockImplementation(async () => Response.json({ tokens: [existing] }));
    mcpApi.sessions[":id"].$delete.mockResolvedValue(new Response(null, { status: 204 }));

    await renderApp("/agent-access");

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Revoke Claude Desktop" }));

    expect(mcpApi.sessions[":id"].$delete).toHaveBeenCalledWith({ param: { id: existing.id } });
  });
});
