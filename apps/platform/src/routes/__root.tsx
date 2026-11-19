import { Link, Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="flex gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <Link to="/" className="[&.active]:font-bold">
          Home
        </Link>
        <Link to="/about" className="[&.active]:font-bold">
          About
        </Link>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  ),
});
