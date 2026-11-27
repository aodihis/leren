import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const connectorsApi = vi.hoisted(() => ({
  $get: vi.fn(),
  ":connector": { $delete: vi.fn(), connect: { $post: vi.fn() } },
}));

const playbooksApi = vi.hoisted(() => ({ $get: vi.fn() }));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: { api: { connectors: connectorsApi, playbooks: playbooksApi } },
}));

import { renderApp } from "../../../testing";

const notion = { id: "notion", displayName: "Notion" };
const docs = { id: "google_docs", displayName: "Google Docs" };

const notionConnection = {
  id: "22222222-2222-4222-8222-222222222222",
  connector: "notion",
  label: "Ada's workspace",
  status: "active",
};

function serve(overview: { available: object[]; connections: object[] }) {
  connectorsApi.$get.mockImplementation(async () => Response.json(overview));
}

describe("connectors route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    playbooksApi.$get.mockImplementation(async () => Response.json({ playbooks: [] }));
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
  });

  it("shows each enabled connector with the state of its connection", async () => {
    serve({
      available: [notion, docs],
      connections: [
        notionConnection,
        { ...notionConnection, connector: "google_docs", status: "revoked" },
      ],
    });

    await renderApp("/connectors");

    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.getByText("Reconnect needed")).toBeTruthy();
    expect(screen.getAllByText("Ada's workspace")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Reconnect Notion" })).toBeTruthy();
  });

  it("says so when no connector is enabled", async () => {
    serve({ available: [], connections: [] });

    await renderApp("/connectors");

    expect(await screen.findByText("No connectors are enabled on this server.")).toBeTruthy();
  });

  it.each([
    ["denied", "Access was not granted, so nothing was connected."],
    ["something_else", "Could not connect. Try again."],
  ])("explains the error %s that the tool returned with", async (error, message) => {
    serve({ available: [notion], connections: [] });

    await renderApp(`/connectors?error=${error}`);

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("confirms a connection that the tool returned with", async () => {
    serve({ available: [notion], connections: [notionConnection] });

    await renderApp("/connectors?connected=notion");

    expect(await screen.findByText("The connector is connected.")).toBeTruthy();
  });

  it("asks the API to start connecting the chosen connector", async () => {
    serve({ available: [notion], connections: [] });
    connectorsApi[":connector"].connect.$post.mockResolvedValue(
      Response.json({ url: "#authorize" }),
    );

    await renderApp("/connectors");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Connect Notion" }));

    expect(connectorsApi[":connector"].connect.$post).toHaveBeenCalledExactlyOnceWith({
      param: { connector: "notion" },
    });
  });

  it("shows an error when connecting is refused", async () => {
    serve({ available: [notion], connections: [] });
    connectorsApi[":connector"].connect.$post.mockResolvedValue(
      Response.json({ error: "Not enabled" }, { status: 404 }),
    );

    await renderApp("/connectors");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Connect Notion" }));

    expect(await screen.findByText("Could not connect. Try again.")).toBeTruthy();
  });

  it("disconnects a connector and loads the list again", async () => {
    serve({ available: [notion], connections: [notionConnection] });
    connectorsApi[":connector"].$delete.mockResolvedValue(new Response(null, { status: 204 }));

    await renderApp("/connectors");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Disconnect Notion" }));

    expect(connectorsApi[":connector"].$delete).toHaveBeenCalledExactlyOnceWith({
      param: { connector: "notion" },
    });
    await vi.waitFor(() => expect(connectorsApi.$get).toHaveBeenCalledTimes(2));
  });

  it("shows an error when disconnecting fails", async () => {
    serve({ available: [notion], connections: [notionConnection] });
    connectorsApi[":connector"].$delete.mockResolvedValue(
      Response.json({ error: "Not found" }, { status: 404 }),
    );

    await renderApp("/connectors");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Disconnect Notion" }));

    expect(await screen.findByText("Could not disconnect.")).toBeTruthy();
    expect(connectorsApi.$get).toHaveBeenCalledOnce();
  });
});
