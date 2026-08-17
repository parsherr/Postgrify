/**
 * FeedPage — main timeline
 *
 * Lists all tweets newest-first.
 * Profile info is fetched separately from users_profile (no JOIN due to API constraint).
 */

import { useState, useEffect, useCallback } from "react";
import { Layout } from "../components/Layout";
import { ComposeBox } from "../components/ComposeBox";
import { TweetCard } from "../components/TweetCard";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchTimeline,
  fetchProfile,
  likeTweet,
  unlikeTweet,
  fetchUserLikes,
  deleteTweet,
  type Tweet,
} from "../lib/api";

export function FeedPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTweets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { rows } = await fetchTimeline(30, 0);

      // Enrich each tweet with profile info (simple N+1 — sufficient for small data sets)
      const enriched = await Promise.all(
        rows.map(async (t) => {
          const p = await fetchProfile(t.user_id).catch(() => null);
          return {
            ...t,
            username:     p?.username     ?? t.user_id.slice(0, 8),
            display_name: p?.display_name ?? "User",
            avatar_url:   p?.avatar_url   ?? null,
          };
        })
      );
      setTweets(enriched);

      // Fetch the current user's likes
      if (user) {
        const likes = await fetchUserLikes(profile?.auth_id ?? user.id ?? "");
        setLikedIds(new Set(likes));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tweets");
    } finally {
      setLoading(false);
    }
  }, [user, profile]);

  useEffect(() => { loadTweets(); }, [loadTweets]);

  async function handleLike(tweetId: string, liked: boolean) {
    if (!user || !profile) return;
    const userId = profile.auth_id;
    try {
      if (liked) {
        await likeTweet(userId, tweetId);
        setLikedIds((s) => new Set([...s, tweetId]));
      } else {
        await unlikeTweet(userId, tweetId);
        setLikedIds((s) => { const n = new Set(s); n.delete(tweetId); return n; });
      }
    } catch { /* silently ignore */ }
  }

  async function handleDelete(tweetId: string) {
    try {
      await deleteTweet(tweetId);
      setTweets((ts) => ts.filter((t) => t.id !== tweetId));
    } catch { /* silently ignore */ }
  }

  const rightPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-2xl p-4">
        <h2 className="text-xl font-bold text-white mb-4">Welcome to Tweeter</h2>
        <p className="text-gray-400 text-sm">A Twitter clone running on Postgrify.</p>
      </div>
    </div>
  );

  return (
    <Layout rightPanel={rightPanel}>
      {/* Header */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-md border-b border-gray-800 px-4 py-3 z-10">
        <h1 className="text-xl font-bold text-white">Home</h1>
      </header>

      {/* Compose — don't show until auth loading is done */}
      {!authLoading && user && <ComposeBox onTweeted={loadTweets} />}

      {/* Tweet list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-8 text-center text-red-400">{error}</div>
      ) : tweets.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <p className="text-lg font-medium mb-2">No tweets yet</p>
          <p className="text-sm">Be the first to tweet!</p>
        </div>
      ) : (
        <div>
          {tweets.map((tweet) => (
            <TweetCard
              key={tweet.id}
              tweet={tweet}
              likedByMe={likedIds.has(tweet.id)}
              onLike={handleLike}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}