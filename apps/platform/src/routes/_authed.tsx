import { Button } from "@leren/ui";
import { Link, Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { authClient } from "../modules/auth/auth-client";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const { data, error } = await authClient.getSession({ query: { disableCookieCache: true } });

    if (error && error.status !== 401) {
      throw new Error("Could not reach the server. Try again in a moment.");
    }

    if (!data) {
      throw redirect({ to: "/login" });
    }

    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  async function handleSignOut() {
    await authClient.signOut();
    await navigate({ to: "/login" });
  }

  return (
    <>
      <nav className="flex items-center gap-4 border-b bg-card px-6 py-3">
        <Link to="/" className="[&.active]:font-bold">
          Home
        </Link>
        <Link to="/profile" className="[&.active]:font-bold">
          Profile
        </Link>
        <Link to="/about" className="[&.active]:font-bold">
          About
        </Link>
        <span className="ml-auto text-sm text-muted-foreground">{user.name || user.email}</span>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </>
  );
}
