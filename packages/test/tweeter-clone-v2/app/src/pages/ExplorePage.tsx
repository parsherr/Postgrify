/**
 * ExplorePage — discover all users
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { getAccessToken } from "../lib/api";
import { API_URL, DB_NAME } from "../lib/postgrify";
import type { UserProfile } from "../lib/api";

async function fetchAllProfiles(): Promise<UserProfile[]> {
  const token = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(
    `${API_URL}/db/${DB_NAME}/users_profile?limit=50&order=created_at.desc`,
    { headers }
  );
  const j = await res.json();
  return j.rows ?? [];
}

export function ExplorePage() {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout>
      <header className="sticky top-0 bg-black/80 backdrop-blur-md border-b border-gray-800 px-4 py-3 z-10">
        <h1 className="text-xl font-bold text-white">Explore</h1>
      </header>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="p-8 text-center text-gray-500">No users yet</div>
      ) : (
        <div>
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="text-lg font-bold text-white">Users ({profiles.length})</h2>
          </div>
          {profiles.map((p) => (
            <Link
              key={p.id}
              to={`/profile/${p.username}`}
              className="card flex items-center gap-3"
            >
              <div className="w-12 h-12 rounded-full bg-sky-700 flex items-center justify-center shrink-0">
                {p.avatar_url ? (
                  <img src={p.avatar_url} className="w-12 h-12 rounded-full object-cover" alt="" />
                ) : (
                  <span className="text-white font-bold text-lg">
                    {p.display_name[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <p className="font-bold text-white">{p.display_name}</p>
                <p className="text-gray-500 text-sm">@{p.username}</p>
                {p.bio && <p className="text-gray-400 text-sm mt-0.5 line-clamp-1">{p.bio}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}