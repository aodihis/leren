import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({
  getSession: vi.fn(),
  emailOtp: { sendVerificationOtp: vi.fn() },
  signIn: { emailOtp: vi.fn() },
  signOut: vi.fn(),
}));

vi.mock("../modules/auth/auth-client", () => ({ authClient }));

import { renderApp } from "../testing";

const NO_SESSION = { data: null, error: null };

function sessionFor(user: { firstName: string | null }) {
  return {
    data: { user: { id: "u1", name: "", email: "ada@example.com", ...user } },
    error: null,
  };
}

async function submitEmail(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: "Send code" }));
}

describe("login route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue(NO_SESSION);
  });

  it("redirects a signed-in visitor to the home page", async () => {
    authClient.getSession.mockResolvedValue(sessionFor({ firstName: "Ada" }));

    const router = await renderApp("/login");

    expect(router.state.location.pathname).toBe("/");
    expect(await screen.findByText("Welcome to Leren")).toBeTruthy();
  });

  it("does not send a code for an email without a domain suffix", async () => {
    const user = userEvent.setup();
    await renderApp("/login");

    await submitEmail(user, "ada@example");

    expect(await screen.findByText("Enter a valid email address")).toBeTruthy();
    expect(authClient.emailOtp.sendVerificationOtp).not.toHaveBeenCalled();
  });

  it("sends a sign-in code and asks for it", async () => {
    authClient.emailOtp.sendVerificationOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    await renderApp("/login");

    await submitEmail(user, "ada@example.com");

    expect(await screen.findByText("We sent a 6-digit code to ada@example.com.")).toBeTruthy();
    expect(authClient.emailOtp.sendVerificationOtp).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      type: "sign-in",
    });
  });

  it.each([
    ["the server's message", { message: "Slow down" }, "Slow down"],
    ["a generic message when the server gives none", {}, "Could not send the code"],
  ])(
    "stays on the email step and shows %s when the code cannot be sent",
    async (_, error, text) => {
      authClient.emailOtp.sendVerificationOtp.mockResolvedValue({ error });
      const user = userEvent.setup();
      await renderApp("/login");

      await submitEmail(user, "ada@example.com");

      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByText(/We sent a 6-digit code/)).toBeNull();
    },
  );

  it("returns to the email step when the visitor chooses a different email", async () => {
    authClient.emailOtp.sendVerificationOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    await renderApp("/login");
    await submitEmail(user, "ada@example.com");

    await user.click(await screen.findByRole("button", { name: "Use a different email" }));

    expect(await screen.findByRole("button", { name: "Send code" })).toBeTruthy();
  });

  describe("verifying the code", () => {
    async function reachCodeStep(user: ReturnType<typeof userEvent.setup>) {
      authClient.emailOtp.sendVerificationOtp.mockResolvedValue({ error: null });
      await renderApp("/login");
      await submitEmail(user, "ada@example.com");
      await screen.findByText(/We sent a 6-digit code/);
    }

    it("signs in with the entered code and opens the home page for a named user", async () => {
      authClient.signIn.emailOtp.mockResolvedValue({
        data: { user: { firstName: "Ada" } },
        error: null,
      });
      const user = userEvent.setup();
      await reachCodeStep(user);
      authClient.getSession.mockResolvedValue(sessionFor({ firstName: "Ada" }));

      await user.keyboard("123456");

      expect(await screen.findByText("Welcome to Leren")).toBeTruthy();
      expect(authClient.signIn.emailOtp).toHaveBeenCalledExactlyOnceWith({
        email: "ada@example.com",
        otp: "123456",
      });
    });

    it("opens the profile page for a user without a first name", async () => {
      authClient.signIn.emailOtp.mockResolvedValue({
        data: { user: { firstName: null } },
        error: null,
      });
      const user = userEvent.setup();
      await reachCodeStep(user);
      authClient.getSession.mockResolvedValue(sessionFor({ firstName: null }));

      await user.keyboard("123456");

      expect(await screen.findByText("Your profile")).toBeTruthy();
    });

    it.each([
      ["the server's message", { message: "Wrong code" }, "Wrong code"],
      ["a generic message when the server gives none", {}, "That code did not work"],
    ])("shows %s and clears the code when the code is rejected", async (_, error, text) => {
      authClient.signIn.emailOtp.mockResolvedValue({ data: null, error });
      const user = userEvent.setup();
      await reachCodeStep(user);

      await user.keyboard("123456");

      expect(await screen.findByText(text)).toBeTruthy();
      await waitFor(() => {
        expect((document.querySelector("input") as HTMLInputElement).value).toBe("");
      });
    });

    it("does not sign in with an incomplete code", async () => {
      const user = userEvent.setup();
      await reachCodeStep(user);

      await user.keyboard("123");
      await user.click(screen.getByRole("button", { name: "Verify and continue" }));

      expect(await screen.findByText("Enter the 6-digit code")).toBeTruthy();
      expect(authClient.signIn.emailOtp).not.toHaveBeenCalled();
    });
  });
});
