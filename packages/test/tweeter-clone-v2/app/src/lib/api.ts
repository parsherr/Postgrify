/**
 * Postgrify REST API yardımcı fonksiyonları.
 *
 * DataClient tüm CRUD işlemlerini karşılamıyor olabilir — o durumda
 * doğrudan fetch ile API'ye istek atılır.
 */

import { API_URL, DB_NAME } from "./postgrify";

// DB token fallback — login olmadan okuma için (setup.mjs tarafından .env.local'a yazılır)
const VITE_DB_TOKEN = import.meta.env.VITE_DB_TOKEN ?? "";

// Aktif DB user access token — auth state değişiminde güncellenir
let _accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getAccessToken() {
  return _accessToken || VITE_DB_TOKEN || null;
}

/** Geçerli token: önce user token, yoksa DB read token */
function getEffectiveToken(): string | null {
  return _accessToken || VITE_DB_TOKEN || null;
}

async function apiFetch(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getEffectiveToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }

  if (!res.ok) {
    const err = json as { error?: string; message?: string };
    throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
  }
  return json;
}

// ── Tweet CRUD ───────────────────────────────────────────────────────────────

export interface Tweet {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  reply_to: string | null;
  like_count: number;
  retweet_count: number;
  created_at: string;
  // join ile gelen alanlar
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  liked_by_me?: boolean;
}

export async function fetchTimeline(limit = 20, offset = 0): Promise<{ rows: Tweet[]; total: number }> {
  // API order formatı: "column.direction" (tek parametre, nokta ile)
  const res = await apiFetch(
    "GET",
    `/db/${DB_NAME}/tweets?limit=${limit}&offset=${offset}&order=created_at.desc`
  ) as { rows: Tweet[]; total: number };
  return res;
}

export async function createTweet(content: string, userId: string): Promise<Tweet> {
  const res = await apiFetch("POST", `/db/${DB_NAME}/tweets`, {
    user_id: userId,
    content,
  }) as { inserted: Tweet[] };
  return res.inserted[0];
}

export async function deleteTweet(id: string): Promise<void> {
  await apiFetch("DELETE", `/db/${DB_NAME}/tweets/${id}`);
}

// ── Likes ────────────────────────────────────────────────────────────────────

export async function likeTweet(userId: string, tweetId: string): Promise<void> {
  await apiFetch("POST", `/db/${DB_NAME}/likes`, { user_id: userId, tweet_id: tweetId });
  // like_count increment
  await apiFetch("PATCH", `/db/${DB_NAME}/tweets/${tweetId}`, {
    like_count: undefined, // query ile yapılacak
  }).catch(() => {});
}

export async function unlikeTweet(userId: string, tweetId: string): Promise<void> {
  // likes tablosunda where ile sil
  const res = await apiFetch(
    "GET",
    `/db/${DB_NAME}/likes?where=user_id.eq.${userId}&where=tweet_id.eq.${tweetId}`
  ) as { rows: { id: string }[] };
  const like = res.rows?.[0];
  if (like) await apiFetch("DELETE", `/db/${DB_NAME}/likes/${like.id}`);
}

export async function fetchUserLikes(userId: string): Promise<string[]> {
  const res = await apiFetch(
    "GET",
    `/db/${DB_NAME}/likes?where=user_id.eq.${userId}&limit=200`
  ) as { rows: { tweet_id: string }[] };
  return res.rows?.map((r) => r.tweet_id) ?? [];
}

// ── Follows ──────────────────────────────────────────────────────────────────

export async function followUser(followerId: string, followingId: string): Promise<void> {
  await apiFetch("POST", `/db/${DB_NAME}/follows`, {
    follower_id: followerId,
    following_id: followingId,
  });
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const res = await apiFetch(
    "GET",
    `/db/${DB_NAME}/follows?where=follower_id.eq.${followerId}&where=following_id.eq.${followingId}`
  ) as { rows: { id: string }[] };
  const follow = res.rows?.[0];
  if (follow) await apiFetch("DELETE", `/db/${DB_NAME}/follows/${follow.id}`);
}

export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const res = await apiFetch(
    "GET",
    `/db/${DB_NAME}/follows?where=follower_id.eq.${followerId}&where=following_id.eq.${followingId}&limit=1`
  ) as { rows: unknown[] };
  return (res.rows?.length ?? 0) > 0;
}

// ── User Profile ─────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  auth_id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

export async function fetchProfile(authId: string): Promise<UserProfile | null> {
  const res = await apiFetch(
    "GET",
    `/db/${DB_NAME}/users_profile?where=auth_id.eq.${authId}&limit=1`
  ) as { rows: UserProfile[] };
  return res.rows?.[0] ?? null;
}

export async function fetchProfileByUsername(username: string): Promise<UserProfile | null> {
  const res = await apiFetch(
    "GET",
    `/db/${DB_NAME}/users_profile?where=username.eq.${username}&limit=1`
  ) as { rows: UserProfile[] };
  return res.rows?.[0] ?? null;
}

export async function createProfile(profile: Omit<UserProfile, "id" | "created_at">): Promise<UserProfile> {
  const res = await apiFetch("POST", `/db/${DB_NAME}/users_profile`, profile) as { inserted: UserProfile[] };
  return res.inserted[0];
}

export async function updateProfile(
  id: string,
  updates: Partial<Pick<UserProfile, "display_name" | "bio" | "avatar_url">>
): Promise<void> {
  await apiFetch("PUT", `/db/${DB_NAME}/users_profile/${id}`, updates);
}

export async function fetchUserTweets(userId: string, limit = 20): Promise<Tweet[]> {
  const res = await apiFetch(
    "GET",
    `/db/${DB_NAME}/tweets?where=user_id.eq.${userId}&limit=${limit}&order=created_at.desc`
  ) as { rows: Tweet[] };
  return res.rows ?? [];
}