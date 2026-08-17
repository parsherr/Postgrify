/**
 * TopBar — breadcrumb, active DB badge, user menu.
 * New version of Header.tsx.
 */

import { useLocation, useParams, Link, useNavigate } from "react-router-dom";
import { ChevronRight, Code2, Database, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDatabases } from "@/hooks/useDatabases";
import { useAuthContext } from "@/hooks/useAuthContext";

function useBreadcrumbs() {
  const location = useLocation();
  const { db, table } = useParams<{ db?: string; table?: string }>();
  const parts = location.pathname.split("/").filter(Boolean);
  const crumbs: { label: string; to: string }[] = [];

  if (parts.length === 0) {
    crumbs.push({ label: "Dashboard", to: "/" });
  } else if (parts[0] === "databases") {
    crumbs.push({ label: "Databases", to: "/databases" });
    if (db) {
      crumbs.push({ label: db, to: `/databases/${db}` });
      if (table) crumbs.push({ label: table, to: `/databases/${db}/tables/${table}` });
      if (parts.includes("new-table")) crumbs.push({ label: "New Table", to: `/databases/${db}/new-table` });
    }
  } else if (parts[0] === "query") {
    crumbs.push({ label: "SQL Editor", to: "/query" });
  } else if (parts[0] === "api-keys") {
    crumbs.push({ label: "API Keys", to: "/api-keys" });
  }

  return crumbs;
}

export function TopBar() {
  const crumbs = useBreadcrumbs();
  const navigate = useNavigate();
  const { db: activeDb } = useParams<{ db?: string }>();
  const { data: databases } = useDatabases();
  const { logout } = useAuthContext();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm">
        <Link
          to="/"
          className="flex items-center gap-1.5 font-semibold text-white"
        >
          <img src="/black-white-logo.png" alt="Postgrify" className="h-7 w-7 object-contain" />
          <span className="hidden text-sm sm:block">Postgrify</span>
        </Link>

        {crumbs.map((crumb, i) => (
          <span key={crumb.to} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-zinc-700" />
            {i === crumbs.length - 1 ? (
              <span className="font-mono text-xs text-white">{crumb.label}</span>
            ) : (
              <Link
                to={crumb.to}
                className="font-mono text-xs text-zinc-400 transition-colors hover:text-white"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Active DB switcher */}
        {databases && databases.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white">
                <Database className="h-3 w-3" />
                {activeDb ?? "Select DB"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuSeparator />
              {databases.map((d) => (
                <DropdownMenuItem
                  key={d.name}
                  onClick={() => navigate(`/databases/${d.name}`)}
                  className={cn(
                    "font-mono text-xs",
                    d.name === activeDb && "bg-zinc-800"
                  )}
                >
                  <Database className="mr-2 h-3 w-3" />
                  {d.name}
                  {d.name === activeDb && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate("/query")}
                className="text-xs"
              >
                <Code2 className="mr-2 h-3 w-3" />
                SQL Editor
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
          title="Logout"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}