/**
 * Main layout — left sidebar + content + right panel
 * Mimics Twitter's 3-column layout.
 */

import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Home,
  Search,
  Bell,
  User,
  LogOut,
  Feather,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import clsx from "clsx";

interface LayoutProps {
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
}

const NAV = [
  { to: "/",        icon: Home,   label: "Home"          },
  { to: "/explore", icon: Search, label: "Explore"       },
  { to: "/alerts",  icon: Bell,   label: "Notifications" },
];

export function Layout({ children, rightPanel }: LayoutProps) {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex justify-center bg-black">
      <div className="flex w-full max-w-[1280px]">
        {/* ── Left Sidebar ───────────────────────────────────────── */}
        <aside className="sticky top-0 h-screen w-[72px] xl:w-[275px] flex flex-col pt-2 px-2 xl:px-4 shrink-0">
          {/* Logo */}
          <Link to="/" className="p-3 hover:bg-white/10 rounded-full w-fit mb-1">
            <Feather className="w-8 h-8 text-sky-400" />
          </Link>

          {/* Nav */}
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-4 px-3 py-3 rounded-full hover:bg-white/10 transition-colors text-xl font-medium",
                    isActive ? "text-white" : "text-gray-300"
                  )
                }
              >
                <Icon className="w-7 h-7 shrink-0" />
                <span className="hidden xl:block">{label}</span>
              </NavLink>
            ))}

            {profile && (
              <NavLink
                to={`/profile/${profile.username}`}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-4 px-3 py-3 rounded-full hover:bg-white/10 transition-colors text-xl font-medium",
                    isActive ? "text-white" : "text-gray-300"
                  )
                }
              >
                <User className="w-7 h-7 shrink-0" />
                <span className="hidden xl:block">Profile</span>
              </NavLink>
            )}
          </nav>

          {/* Tweet button */}
          <button
            onClick={() => navigate("/?compose=true")}
            className="mt-4 btn-primary py-3 px-4 hidden xl:flex"
          >
            Tweet
          </button>
          <button
            onClick={() => navigate("/?compose=true")}
            className="mt-4 p-3 bg-sky-500 hover:bg-sky-600 rounded-full w-fit xl:hidden"
          >
            <Feather className="w-5 h-5 text-white" />
          </button>

          {/* User info */}
          {user && (
            <div className="mt-auto mb-4 flex items-center gap-3 p-3 rounded-full hover:bg-white/10 cursor-pointer">
              <div className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center shrink-0">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" />
                ) : (
                  <span className="text-white font-bold">
                    {(profile?.display_name ?? user.email ?? "?")[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div className="hidden xl:block min-w-0">
                <p className="text-sm font-bold text-white truncate">{profile?.display_name ?? "User"}</p>
                <p className="text-sm text-gray-500 truncate">@{profile?.username ?? user.email}</p>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="ml-auto hidden xl:block text-gray-400 hover:text-red-400"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </aside>

        {/* ── Main Content ─────────────────────────────────────────── */}
        <main className="flex-1 border-x border-gray-800 min-h-screen max-w-[600px]">
          {children}
        </main>

        {/* ── Right Panel ─────────────────────────────────────────── */}
        {rightPanel && (
          <aside className="hidden lg:block w-[350px] pl-8 pt-4 shrink-0">
            {rightPanel}
          </aside>
        )}
      </div>
    </div>
  );
}