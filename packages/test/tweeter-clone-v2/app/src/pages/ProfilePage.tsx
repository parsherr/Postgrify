/**
 * ProfilePage — user profile
 *
 * URL: /profile/:username
 * Own profile: shows edit button
 * Other profiles: shows follow/unfollow button
 */

import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Calendar, MapPin } from "lucide-react";
import { Layout } from "../components/Layout";
import { TweetCard } from "../components/TweetCard";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchProfileByUsername,
  fetchUserTweets,
  followUser,
  unfollowUser,
  isFollowing,
  likeTweet,
  unlikeTweet,
  fetchUserLikes,
  deleteTweet,
  type UserProfile,
  type Tweet,
} from "../lib/api";

export function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { user, profile: myProfile } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [error, setError] = useState("");

  const isOwnProfile = myProfile?.username === username;

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setError("");

    Promise.all([
      fetchProfileByUsername(username),
    ]).then(async ([p]) => {
      setProfile(p);
      if (!p) { setLoading(false); return; }

      const tweetData = await fetchUserTweets(p.auth_id, 30).catch(() => []);
      // Attach profile info to each tweet
      const enriched = tweetData.map((t) => ({
        ...t,
        username:     p.username,
        display_name: p.display_name,
        avatar_url:   p.avatar_url,
      }));
      setTweets(enriched);

      // Follow status
      if (user && myProfile && !isOwnProfile) {
        const f = await isFollowing(myProfile.auth_id, p.auth_id).catch(() => false);
        setFollowing(f);
      }

      // Likes
      if (user && myProfile) {
        const likes = await fetchUserLikes(myProfile.auth_id).catch(() => []);
        setLikedIds(new Set(likes));
      }

      setLoading(false);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load profile");
      setLoading(false);
    });
  }, [username, user, myProfile, isOwnProfile]);

  async function handleFollow() {
    if (!myProfile || !profile) return;
    setFollowLoading(true);
    try {
      if (following) {
        await unfollowUser(myProfile.auth_id, profile.auth_id);
        setFollowing(false);
      } else {
        await followUser(myProfile.auth_id, profile.auth_id);
        setFollowing(true);
      }
    } catch { /* silently ignore */ }
    setFollowLoading(false);
  }

  async function handleLike(tweetId: string, liked: boolean) {
    if (!myProfile) return;
    try {
      if (liked) {
        await likeTweet(myProfile.auth_id, tweetId);
        setLikedIds((s) => new Set([...s, tweetId]));
      } else {
        await unlikeTweet(myProfile.auth_id, tweetId);
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

  const joinDate = profile
    ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  return (
    <Layout>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error || !profile ? (
        <div className="p-8 text-center text-gray-500">
          <p className="text-lg font-medium">Profile not found</p>
          <p className="text-sm mt-1">@{username} does not exist.</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="sticky top-0 bg-black/80 backdrop-blur-md border-b border-gray-800 px-4 py-3 z-10">
            <h1 className="text-xl font-bold text-white">{profile.display_name}</h1>
            <p className="text-sm text-gray-500">{tweets.length} Tweets</p>
          </header>

          {/* Banner */}
          <div className="h-48 bg-gradient-to-br from-sky-900 to-sky-700" />

          {/* Profile info */}
          <div className="px-4 pb-4">
            <div className="flex justify-between items-start -mt-16 mb-4">
              {/* Avatar */}
              <div className="w-32 h-32 rounded-full border-4 border-black bg-sky-700 flex items-center justify-center">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} className="w-32 h-32 rounded-full object-cover" alt="" />
                ) : (
                  <span className="text-white text-4xl font-bold">
                    {profile.display_name[0]?.toUpperCase()}
                  </span>
                )}
              </div>

              {/* Button */}
              {user && !isOwnProfile && (
                <button
                  onClick={handleFollow}
                  disabled={followLoading}
                  className={following ? "btn-outline mt-16" : "btn-primary mt-16"}
                >
                  {followLoading ? "..." : following ? "Unfollow" : "Follow"}
                </button>
              )}
              {isOwnProfile && (
                <button className="btn-outline mt-16" disabled>
                  Edit Profile
                </button>
              )}
            </div>

            <h2 className="text-2xl font-bold text-white">{profile.display_name}</h2>
            <p className="text-gray-500">@{profile.username}</p>

            {profile.bio && (
              <p className="text-white mt-3 whitespace-pre-wrap">{profile.bio}</p>
            )}

            <div className="flex items-center gap-4 mt-3 text-gray-500 text-sm">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                Joined {joinDate}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                Postgrify
              </span>
            </div>
          </div>

          {/* Tab header */}
          <div className="border-b border-gray-800 px-4 py-3">
            <span className="text-white font-bold border-b-2 border-sky-500 pb-3">
              Tweets
            </span>
          </div>

          {/* Tweets */}
          {tweets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No tweets yet</p>
            </div>
          ) : (
            tweets.map((tweet) => (
              <TweetCard
                key={tweet.id}
                tweet={tweet}
                likedByMe={likedIds.has(tweet.id)}
                onLike={handleLike}
                onDelete={handleDelete}
              />
            ))
          )}
        </>
      )}
    </Layout>
  );
}