/**
 * TopBar — breadcrumb, aktif DB badge'i, kullanıcı menüsü.
 * Header.tsx'in yeni versiyonu.
 */

import { useLocation, useParams, Link, useNavigate } from "react-router-dom";
import { ChevronRight, Database, LogOut, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDatabases } from "@/hooks/useDatabases";

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

  function handleLogout() {
    localStorage.removeItem("postgrify_token");
    navigate("/login");
  }

  return (
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm">
        <Link
          to="/"
          className="flex items-center gap-1.5 font-semibold text-foreground"
        >
          <img src="/logo.png" alt="Postgrify" className="h-5 w-5 object-contain" />
          <span className="hidden text-sm sm:block">Postgrify</span>
        </Link>

        {crumbs.map((crumb, i) => (
          <span key={crumb.to} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
            {i === crumbs.length - 1 ? (
              <span className="font-mono text-xs text-foreground">{crumb.label}</span>
            ) : (
              <Link
                to={crumb.to}
                className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* Sağ taraf */}
      <div className="flex items-center gap-2">
        {/* Aktif DB switcher */}
        {databases && databases.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-zinc-600 hover:text-foreground">
                <Database className="h-3 w-3" />
                {activeDb ?? "DB seç"}
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
                    d.name === activeDb && "bg-accent/50"
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
                <Terminal className="mr-2 h-3 w-3" />
                SQL Editörü
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          title="Çıkış"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}
