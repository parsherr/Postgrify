/**
 * TweetCard — tek bir tweet'i gösterir
 * Like, silme, profil link'i içerir.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Trash2, MessageCircle } from "lucide-react";
import clsx from "clsx";
import type { Tweet } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

interface TweetCardProps {
  tweet: Tweet;
  likedByMe?: boolean;
  onLike?: (id: string, liked: boolean) => void;
  onDelete?: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}d`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}s`;
  return new Date(dateStr).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export function TweetCard({ tweet, likedByMe = false, onLike, onDelete }: TweetCardProps) {
  const { user, profile } = useAuth();
  const [liked, setLiked] = useState(likedByMe);
  const [likeCount, setLikeCount] = useState(tweet.like_count ?? 0);

  const isOwner = user && tweet.user_id === profile?.auth_id;
  const username = tweet.username ?? "kullanici";
  const displayName = tweet.display_name ?? username;

  function handleLike() {
    const newLiked = !liked;
    setLiked(newLiked);
    setLikeCount((c) => c + (newLiked ? 1 : -1));
    onLike?.(tweet.id, newLiked);
  }

  return (
    <article className="card">
      <div className="flex gap-3">
        {/* Avatar */}
        <Link to={`/profile/${username}`} className="shrink-0">
          <div className="w-10 h-10 rounded-full bg-sky-700 flex items-center justify-center">
            {tweet.avatar_url ? (
              <img src={tweet.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" />
            ) : (
              <span className="text-white font-bold text-sm">
                {displayName[0]?.toUpperCase() ?? "?"}
              </span>
            )}
          </div>
        </Link>

        {/* İçerik */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/profile/${username}`}
              className="font-bold text-white hover:underline truncate"
            >
              {displayName}
            </Link>
            <span className="text-gray-500 text-sm truncate">@{username}</span>
            <span className="text-gray-500 text-sm">·</span>
            <span className="text-gray-500 text-sm">{timeAgo(tweet.created_at)}</span>
          </div>

          <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
            {tweet.content}
          </p>

          {tweet.image_url && (
            <img
              src={tweet.image_url}
              alt=""
              className="mt-3 rounded-2xl max-h-80 object-cover w-full border border-gray-800"
            />
          )}

          {/* Aksiyonlar */}
          <div className="flex items-center gap-6 mt-3 text-gray-500">
            <button className="flex items-center gap-1.5 hover:text-sky-400 transition-colors group">
              <MessageCircle className="w-4 h-4 group-hover:bg-sky-500/10 rounded-full" />
              <span className="text-xs">0</span>
            </button>

            <button
              onClick={handleLike}
              className={clsx(
                "flex items-center gap-1.5 transition-colors group",
                liked ? "text-pink-500" : "hover:text-pink-400"
              )}
            >
              <Heart
                className={clsx("w-4 h-4", liked && "fill-current")}
              />
              <span className="text-xs">{likeCount}</span>
            </button>

            {isOwner && (
              <button
                onClick={() => onDelete?.(tweet.id)}
                className="flex items-center gap-1.5 hover:text-red-400 transition-colors ml-auto"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}