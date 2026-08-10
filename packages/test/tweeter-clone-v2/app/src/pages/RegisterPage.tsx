/**
 * RegisterPage — yeni hesap oluşturma
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

  // Step 2 — userId signup sonrası doldurulur
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAccount(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Şifreler eşleşmiyor"); return; }
    if (password.length < 8)  { setError("Şifre en az 8 karakter olmalı"); return; }
    setLoading(true);
    setError("");
    try {
      await signUp(email, password);
      // signUp içinde signIn yapılır — user state güncellenir ama React batching nedeniyle
      // henüz render edilmemiş olabilir; auth.getUser ile doğrudan al
      const { data: u } = await auth.getUser();
      setUserId(u?.id ?? "");
      setStep("profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kayıt başarısız");
    } finally {
      setLoading(false);
    }
  }

  async function handleProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!username.match(/^[a-z0-9_]{3,20}$/)) {
      setError("Kullanıcı adı: 3-20 karakter, a-z0-9_ içerebilir");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Username benzersizlik kontrolü
      const existing = await fetchProfileByUsername(username).catch(() => null);
      if (existing) { setError("Bu kullanıcı adı alınmış"); setLoading(false); return; }

      const authId = userId || user?.id || "";
      if (!authId) { setError("Kullanıcı kimliği alınamadı, lütfen tekrar giriş yapın"); setLoading(false); return; }

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
      setError(err instanceof Error ? err.message : "Profil oluşturulamadı");
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
            <h1 className="text-3xl font-bold text-white text-center mb-2">Hesap Oluştur</h1>
            <p className="text-gray-500 text-center mb-8">1 / 2 — Hesap bilgileri</p>

            <form onSubmit={handleAccount} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E-posta adresi"
                required
                className="input"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Şifre (min. 8 karakter)"
                required
                className="input"
              />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Şifre tekrar"
                required
                className="input"
              />
              {error && <p className="text-red-400 text-sm bg-red-950/40 rounded-lg p-3">{error}</p>}
              <button
                type="submit"
                disabled={loading || !email || !password || !confirm}
                className="btn-primary w-full py-3 disabled:opacity-50"
              >
                {loading ? "Kayıt olunuyor..." : "Devam Et"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-white text-center mb-2">Profilini Oluştur</h1>
            <p className="text-gray-500 text-center mb-8">2 / 2 — Profil bilgileri</p>

            <form onSubmit={handleProfile} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="Kullanıcı adı (örn: ali_yilmaz)"
                  required
                  className="input"
                />
                <p className="text-gray-600 text-xs mt-1 ml-1">3-20 karakter, harf/rakam/alt çizgi</p>
              </div>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Görünen isim"
                className="input"
              />
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Biyografi (opsiyonel)"
                rows={3}
                className="input resize-none"
              />
              {error && <p className="text-red-400 text-sm bg-red-950/40 rounded-lg p-3">{error}</p>}
              <button
                type="submit"
                disabled={loading || !username}
                className="btn-primary w-full py-3 disabled:opacity-50"
              >
                {loading ? "Kaydediliyor..." : "Tweeter'a Katıl"}
              </button>
            </form>
          </>
        )}

        <p className="text-center text-gray-500 mt-6">
          Zaten hesabın var mı?{" "}
          <Link to="/login" className="text-sky-400 hover:underline font-medium">
            Giriş Yap
          </Link>
        </p>
      </div>
    </div>
  );
}