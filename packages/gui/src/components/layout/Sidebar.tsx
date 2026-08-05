/**
 * Sol navigasyon paneli.
 */

import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  Terminal,
  Key,
  LogOut,
} from "lucide-react";
import { useDatabases } from "../../hooks/useDatabases.js";
import { useLogout } from "../../hooks/useAuth.js";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/databases", label: "Veritabanları", icon: Database, end: false },
  { to: "/query", label: "SQL Editörü", icon: Terminal, end: true },
  { to: "/api-keys", label: "API Keys", icon: Key, end: true },
];

export default function Sidebar() {
  const { data: databases } = useDatabases();
  const logout = useLogout();

  return (
    <aside className="w-56 flex flex-col border-r border-gray-200 bg-white h-screen">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-bold text-gray-900 tracking-tight">
          Postgrify
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {/* Ana menü */}
        <ul className="space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  }`
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>

        {/* DB listesi */}
        {databases && databases.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Veritabanları
            </p>
            <ul className="space-y-0.5">
              {databases.map((db) => (
                <li key={db.name}>
                  <NavLink
                    to={`/databases/${db.name}`}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors truncate ${
                        isActive
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-gray-600 hover:bg-gray-100"
                      }`
                    }
                  >
                    <Database className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                    <span className="truncate">{db.name}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {/* Logout */}
      <div className="p-2 border-t border-gray-100">
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 hover:text-red-500 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Çıkış
        </button>
      </div>
    </aside>
  );
}