/**
 * ComposeBox — yeni tweet yazma kutusu
 */

import { useState, useRef } from "react";
import { Feather } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { createTweet } from "../lib/api";

interface ComposeBoxProps {
  onTweeted?: () => void;
}

export function ComposeBox({ onTweeted }: ComposeBoxProps) {
  const { user, profile } = useAuth();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const MAX = 280;
  const remaining = MAX - content.length;
  const canTweet = content.trim().length > 0 && remaining >= 0 && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canTweet || !user) return;
    setLoading(true);
    setError("");
    try {
      await createTweet(content.trim(), profile?.auth_id ?? user.id ?? "");
      setContent("");
      onTweeted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tweet gönderilemedi");
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  return (
    <form onSubmit={handleSubmit} className="p-4 border-b border-gray-800">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-sky-700 flex items-center justify-center shrink-0">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" />
          ) : (
            <span className="text-white font-bold">
              {(profile?.display_name ?? user.email ?? "?")[0].toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Ne düşünüyorsun?"
            rows={3}
            className="w-full bg-transparent text-white text-lg placeholder:text-gray-600
                       resize-none focus:outline-none border-b border-gray-800 pb-3 mb-3"
          />

          {error && <p className="text-red-400 text-sm mb-2">{error}</p>}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Feather className="w-5 h-5 text-sky-500" />
            </div>
            <div className="flex items-center gap-3">
              {content.length > 0 && (
                <span
                  className={remaining < 20 ? "text-red-400 text-sm" : "text-gray-500 text-sm"}
                >
                  {remaining}
                </span>
              )}
              <button
                type="submit"
                disabled={!canTweet}
                className="btn-primary py-1.5 px-5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Gönderiliyor..." : "Tweet At"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}