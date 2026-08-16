/**
 * Sidebar — tree-nav ile DB/tablo navigasyonu.
 * VSCode tarzı alt panel (slide-up mini SQL editörü) ve version satırı içerir.
 */

import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  LayoutDashboard,
  Code2,
  KeyRound,
  Database,
  Plus,
  LogOut,
  ExternalLink,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDatabases } from "@/hooks/useDatabases";
import { useAuthContext } from "@/hooks/useAuthContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

interface SidebarProps {
  collapsed: boolean;
}

const VERSION = (import.meta as unknown as { env: { VITE_APP_VERSION?: string } }).env.VITE_APP_VERSION ?? "0.1.0";

const navItems = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Veritabanları", to: "/databases", icon: Database },
  { label: "SQL Editörü", to: "/query", icon: Code2 },
  { label: "API Keys", to: "/api-keys", icon: KeyRound },
];

/** Tek bir veritabanının sidebar satırını gösterir */
function DbTreeNode({
  dbName,
  collapsed,
}: {
  dbName: string;
  collapsed: boolean;
}) {
  const params = useParams<{ db?: string }>();
  const isActiveDb = params.db === dbName;
  const dbPath = `/databases/${dbName}`;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={dbPath}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
              isActiveDb
                ? "border-l-2 border-zinc-400 bg-zinc-800 pl-1.5 text-foreground"
                : "border-l-2 border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-foreground",
              collapsed && "justify-center px-0"
            )}
          >
            {collapsed ? (
              <Database className="h-3.5 w-3.5 mx-auto" />
            ) : (
              <>
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate font-mono text-xs">{dbName}</span>
              </>
            )}
          </Link>
        </TooltipTrigger>
        {collapsed && (
          <TooltipContent side="right" className="font-mono text-xs">
            {dbName}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

export function Sidebar({ collapsed }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: databases } = useDatabases();
  const { logout } = useAuthContext();

  async function handleLogout() {
    await logout();
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
                          ? "bg-zinc-800 text-foreground"
                          : "text-zinc-400 hover:bg-zinc-800 hover:text-foreground",
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
            <span className="text-2xs font-semibold uppercase tracking-widest text-zinc-500">
              Databases
            </span>
          </div>
        )}

        <div className="space-y-0.5 px-2">
          {databases?.map((db) => (
            <DbTreeNode
              key={db.name}
              dbName={db.name}
              collapsed={collapsed}
            />
          ))}

          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/databases"
                  className={cn(
                    "flex items-center gap-2 rounded-sm px-2 py-1.5 text-zinc-600 transition-colors hover:text-zinc-400",
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
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300",
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

        {/* Changes */}
        <div className="px-2 py-0.5">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/changelog"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <ScrollText className="h-3.5 w-3.5 shrink-0" />
                  {!collapsed && <span>Changes</span>}
                </Link>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">Changes</TooltipContent>
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
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300",
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
          <div className="flex items-center justify-between border-t border-zinc-800 px-3 py-1.5">
            <span className="font-mono text-2xs text-zinc-600">
              v{VERSION}
            </span>
            <img src="/black-white-logo.png" alt="" className="h-5 w-5 object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}