import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  cn,
} from "@leren/ui";
import { Link, Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  HouseIcon,
  InfoIcon,
  LogOutIcon,
  MenuIcon,
  SlidersHorizontalIcon,
  UserIcon,
} from "lucide-react";
import { useState } from "react";

import { authClient } from "../modules/auth/auth-client";
import { Logo } from "../modules/layout/components/logo";

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: HouseIcon },
  { to: "/auto-reply-rules", label: "Rules", icon: SlidersHorizontalIcon },
  { to: "/profile", label: "Profile", icon: UserIcon },
  { to: "/about", label: "About", icon: InfoIcon },
] as const;

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

/**
 * The dashboard shell from the design system. The sidebar is expanded from 1024px, a rail of icons
 * from 768px, and a sheet behind a menu button below that. The sidebar and the content scroll
 * independently, so the page itself never scrolls. Labels in the rail stay in the accessibility
 * tree because they are visually hidden, not removed.
 */
function AuthedLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside
        aria-label="Sidebar"
        className="hidden w-sidebar-rail flex-none md:flex lg:w-sidebar max-lg:[&_[data-label]]:sr-only"
      >
        <SidebarContent />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-header flex-none items-center gap-3 border-b bg-surface px-4 md:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <MenuIcon strokeWidth={1.75} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-sidebar p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Navigate the dashboard</SheetDescription>
              <SidebarContent onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <BrandName />
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-280">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function BrandName() {
  return (
    <div className="flex items-center gap-2.5 px-1.5 text-title-sm font-semibold">
      <Logo />
      <span data-label>Leren</span>
    </div>
  );
}

interface SidebarContentProps {
  onNavigate?: () => void;
}

/**
 * The brand, the navigation and the account row. The account row is pinned to the bottom.
 * Elements that carry a `data-label` attribute are the ones the rail hides.
 */
function SidebarContent({ onNavigate }: SidebarContentProps) {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const displayName = user.name || user.email;

  async function handleSignOut() {
    await authClient.signOut();
    await navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-r bg-sidebar">
      <div className="px-3 pt-4 pb-2 max-lg:md:flex max-lg:md:justify-center">
        <BrandName />
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-0.5 px-3 py-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            onClick={onNavigate}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-ink-muted outline-none",
              "hover:bg-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "aria-[current=page]:bg-brand-soft aria-[current=page]:text-brand",
              "max-lg:md:justify-center",
            )}
          >
            <Icon className="size-4.5 flex-none" strokeWidth={1.75} aria-hidden="true" />
            <span data-label>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-auto flex items-center gap-2.5 border-t p-3 max-lg:md:flex-col">
        <span
          className="grid size-8 flex-none place-items-center rounded-full bg-sand text-xs font-semibold text-ink"
          aria-hidden="true"
        >
          {displayName.slice(0, 2).toUpperCase()}
        </span>
        <div data-label className="min-w-0 flex-1 text-body-sm">
          <div className="truncate font-semibold">{displayName}</div>
          {user.name && <div className="truncate text-ink-muted">{user.email}</div>}
        </div>
        <Button variant="ghost" size="icon" aria-label="Sign out" onClick={handleSignOut}>
          <LogOutIcon strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}
