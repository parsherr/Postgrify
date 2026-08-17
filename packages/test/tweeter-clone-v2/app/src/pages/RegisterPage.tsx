/**
 * RegisterPage — create a new account
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Feather } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { createProfile, fetchProfileByUsername } from "../lib/api";
import { auth } from "../lib/postgrify";

export function RegisterPage() {
  const { signUp, user, setProfile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"account" | "profile">("account");

  // Step 1
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Step 2 — userId is set after signup
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAccount(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    setError("");
    try {
      await signUp(email, password);
      // signUp calls signIn internally — user state updates, but due to React batching
      // it may not have rendered yet; get it directly via auth.getUser
      const { data: u } = await auth.getUser();
      setUserId(u?.id ?? "");
      setStep("profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!username.match(/^[a-z0-9_]{3,20}$/)) {
      setError("Username: 3-20 characters, letters/numbers/underscores only");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Check username uniqueness
      const existing = await fetchProfileByUsername(username).catch(() => null);
      if (existing) { setError("That username is already taken"); setLoading(false); return; }

      const authId = userId || user?.id || "";
      if (!authId) { setError("Could not retrieve user ID, please sign in again"); setLoading(false); return; }

      const profile = await createProfile({
        auth_id:      authId,
        username,
        display_name: displayName || username,
        bio:          bio || null,
        avatar_url:   null,
      });
      setProfile(profile);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Feather className="w-10 h-10 text-sky-400" />
        </div>

        {step === "account" ? (
          <>
            <h1 className="text-3xl font-bold text-white text-center mb-2">Create Account</h1>
            <p className="text-gray-500 text-center mb-8">1 / 2 — Account details</p>

            <form onSubmit={handleAccount} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                required
                className="input"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min. 8 characters)"
                required
                className="input"
              />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm password"
                required
                className="input"
              />
              {error && <p className="text-red-400 text-sm bg-red-950/40 rounded-lg p-3">{error}</p>}
              <button
                type="submit"
                disabled={loading || !email || !password || !confirm}
                className="btn-primary w-full py-3 disabled:opacity-50"
              >
                {loading ? "Creating account..." : "Continue"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-white text-center mb-2">Create Your Profile</h1>
            <p className="text-gray-500 text-center mb-8">2 / 2 — Profile details</p>

            <form onSubmit={handleProfile} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="Username (e.g. john_doe)"
                  required
                  className="input"
                />
                <p className="text-gray-600 text-xs mt-1 ml-1">3-20 characters, letters/numbers/underscores</p>
              </div>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                className="input"
              />
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Bio (optional)"
                rows={3}
                className="input resize-none"
              />
              {error && <p className="text-red-400 text-sm bg-red-950/40 rounded-lg p-3">{error}</p>}
              <button
                type="submit"
                disabled={loading || !username}
                className="btn-primary w-full py-3 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Join Tweeter"}
              </button>
            </form>
          </>
        )}

        <p className="text-center text-gray-500 mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-sky-400 hover:underline font-medium">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}