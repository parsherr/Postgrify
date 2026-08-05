/**
 * Sidebar — tree-nav ile DB/tablo navigasyonu.
 * VSCode tarzı alt panel (slide-up mini SQL editörü) ve version satırı içerir.
 */

import React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  LayoutDashboard,
  Terminal,
  KeyRound,
  Database,
  Table2,
  Plus,
  LogOut,
  ChevronDown,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDatabases } from "@/hooks/useDatabases";
import { useTables } from "@/hooks/useTables";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

interface SidebarProps {
  collapsed: boolean;
}

const VERSION = (import.meta as unknown as { env: { VITE_APP_VERSION?: string } }).env.VITE_APP_VERSION ?? "0.1.0";

const navItems = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Veritabanları", to: "/databases", icon: Database },
  { label: "SQL Editörü", to: "/query", icon: Terminal },
  { label: "API Keys", to: "/api-keys", icon: KeyRound },
];

/** Tek bir veritabanının tablo listesini gösterir (lazy load) */
function DbTreeNode({ dbName, collapsed }: { dbName: string; collapsed: boolean }) {
  const location = useLocation();
  const params = useParams<{ db?: string; table?: string }>();
  const isActiveDb = params.db === dbName;

  const [open, setOpen] = React.useState(isActiveDb);
  const { data: tables, isLoading } = useTables(open ? dbName : "");

  const dbPath = `/databases/${dbName}`;

  return (
    <div>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setOpen((o) => !o)}
              className={cn(
                "group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                isActiveDb
                  ? "border-l-2 border-zinc-400 bg-zinc-800/60 pl-1.5 text-foreground"
                  : "border-l-2 border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              {!collapsed && (
                <ChevronDown
                  className={cn(
                    "h-3 w-3 shrink-0 transition-transform",
                    open ? "rotate-0" : "-rotate-90"
                  )}
                />
              )}
              <Database className={cn("h-3.5 w-3.5 shrink-0", collapsed && "mx-auto")} />
              {!collapsed && (
                <span className="flex-1 truncate font-mono text-xs">{dbName}</span>
              )}
              {!collapsed && isActiveDb && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
              )}
            </button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right" className="font-mono text-xs">
              {dbName}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {/* Tablo listesi */}
      {!collapsed && open && (
        <div className="ml-4 mt-0.5 border-l border-border/50">
          {isLoading && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Yükleniyor…
            </div>
          )}
          {tables?.map((tbl) => {
            const tablePath = `/databases/${dbName}/tables/${tbl.name}`;
            const isActive = location.pathname === tablePath;
            return (
              <Link
                key={tbl.name}
                to={tablePath}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 text-xs transition-colors",
                  isActive
                    ? "bg-zinc-800 text-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                )}
              >
                <Table2 className="h-3 w-3 shrink-0" />
                <span className="truncate font-mono">{tbl.name}</span>
              </Link>
            );
          })}
          {/* DB ana sayfasına link */}
          <Link
            to={dbPath}
            className={cn(
              "flex items-center gap-2 px-3 py-1 text-xs italic transition-colors",
              location.pathname === dbPath
                ? "text-foreground"
                : "text-muted-foreground/60 hover:text-muted-foreground"
            )}
          >
            Tüm tablolar →
          </Link>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: databases } = useDatabases();

  function handleLogout() {
    localStorage.removeItem("postgrify_token");
    navigate("/login");
  }

  return (
    <div className="flex h-full flex-col text-sm">
      {/* Navigasyon */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* Üst nav */}
        <nav className="space-y-0.5 px-2">
          {navItems.map(({ label, to, icon: Icon }) => {
            const active =
              to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
            return (
              <TooltipProvider key={to} delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={to}
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors",
                        active
                          ? "bg-accent/60 text-foreground"
                          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                        collapsed && "justify-center px-0"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{label}</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">{label}</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </nav>

        <Separator className="my-2" />

        {/* DB section */}
        {!collapsed && (
          <div className="mb-1 px-3">
            <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/60">
              Databases
            </span>
          </div>
        )}

        <div className="space-y-0.5 px-2">
          {databases?.map((db) => (
            <DbTreeNode key={db.name} dbName={db.name} collapsed={collapsed} />
          ))}

          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/databases"
                  className={cn(
                    "flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  {!collapsed && <span className="text-xs">Veritabanı Ekle</span>}
                </Link>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">Veritabanı Ekle</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Alt alan — version */}
      <div className="flex flex-col">
        <Separator />

        {/* API Docs — harici link */}
        <div className="px-2 py-0.5">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="http://localhost:3000/api-docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {!collapsed && <span>API Docs</span>}
                </a>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">API Docs</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Logout */}
        <div className="px-2 py-1.5">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleLogout}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0" />
                  {!collapsed && <span>Çıkış</span>}
                </button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">Çıkış</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Version satırı */}
        {!collapsed && (
          <div className="flex items-center justify-between border-t border-border/50 px-3 py-1.5">
            <span className="font-mono text-2xs text-muted-foreground/40">
              v{VERSION}
            </span>
            <img src="/logo.png" alt="" className="h-3 w-3 object-contain opacity-30" />
          </div>
        )}
      </div>
    </div>
  );
}