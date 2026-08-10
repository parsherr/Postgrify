/**
 * ProfilePage — kullanıcı profili
 *
 * URL: /profile/:username
 * Kendi profilinde: düzenleme butonu
 * Başka profillerde: follow/unfollow butonu
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
      // Tweet'lere profil bilgisi ekle
      const enriched = tweetData.map((t) => ({
        ...t,
        username:     p.username,
        display_name: p.display_name,
        avatar_url:   p.avatar_url,
      }));
      setTweets(enriched);

      // Follow durumu
      if (user && myProfile && !isOwnProfile) {
        const f = await isFollowing(myProfile.auth_id, p.auth_id).catch(() => false);
        setFollowing(f);
      }

      // Beğeniler
      if (user && myProfile) {
        const likes = await fetchUserLikes(myProfile.auth_id).catch(() => []);
        setLikedIds(new Set(likes));
      }

      setLoading(false);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Profil yüklenemedi");
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
    } catch { /* sessizce geç */ }
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
    } catch { /* sessizce geç */ }
  }

  async function handleDelete(tweetId: string) {
    try {
      await deleteTweet(tweetId);
      setTweets((ts) => ts.filter((t) => t.id !== tweetId));
    } catch { /* sessizce geç */ }
  }

  const joinDate = profile
    ? new Date(profile.created_at).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })
    : "";

  return (
    <Layout>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error || !profile ? (
        <div className="p-8 text-center text-gray-500">
          <p className="text-lg font-medium">Profil bulunamadı</p>
          <p className="text-sm mt-1">@{username} adlı kullanıcı mevcut değil.</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="sticky top-0 bg-black/80 backdrop-blur-md border-b border-gray-800 px-4 py-3 z-10">
            <h1 className="text-xl font-bold text-white">{profile.display_name}</h1>
            <p className="text-sm text-gray-500">{tweets.length} Tweet</p>
          </header>

          {/* Banner */}
          <div className="h-48 bg-gradient-to-br from-sky-900 to-sky-700" />

          {/* Profil bilgileri */}
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

              {/* Buton */}
              {user && !isOwnProfile && (
                <button
                  onClick={handleFollow}
                  disabled={followLoading}
                  className={following ? "btn-outline mt-16" : "btn-primary mt-16"}
                >
                  {followLoading ? "..." : following ? "Takibi Bırak" : "Takip Et"}
                </button>
              )}
              {isOwnProfile && (
                <button className="btn-outline mt-16" disabled>
                  Profili Düzenle
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
                {joinDate} tarihinde katıldı
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                Postgrify
              </span>
            </div>
          </div>

          {/* Sekme başlığı */}
          <div className="border-b border-gray-800 px-4 py-3">
            <span className="text-white font-bold border-b-2 border-sky-500 pb-3">
              Tweetler
            </span>
          </div>

          {/* Tweet'ler */}
          {tweets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>Henüz tweet yok</p>
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