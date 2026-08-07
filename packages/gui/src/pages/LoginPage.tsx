/**
 * LoginPage — iki kolonlu tasarım.
 * Sol: form paneli  |  Sağ: GrainGradient + OS icon grid (new-login-design.md)
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { GrainGradient } from "@paper-design/shaders-react";
import { AuthContext } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

// ── İkon bileşenleri (new-login-design.md'den birebir) ────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" fill="#EB4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.03-3.02 2.47-4.47 2.58-4.54-1.41-2.06-3.6-2.34-4.38-2.37-1.86-.19-3.64 1.1-4.58 1.1-.95 0-2.42-1.07-3.98-1.04-2.05.03-3.94 1.19-4.99 3.02-2.13 3.69-.54 9.16 1.53 12.15 1.01 1.46 2.22 3.1 3.81 3.04 1.53-.06 2.11-.99 3.96-.99s2.37.99 3.99.96c1.65-.03 2.69-1.49 3.69-2.96 1.16-1.69 1.64-3.33 1.66-3.41-.04-.02-3.2-1.23-3.24-4.87ZM14.03 3.66c.84-1.02 1.41-2.43 1.25-3.84-1.21.05-2.68.81-3.55 1.83-.78.9-1.46 2.34-1.28 3.72 1.35.1 2.73-.69 3.58-1.71Z" />
    </svg>
  );
}

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M3 4.7 10.7 3.6v7.7H3V4.7Zm8.8-1.25L21 2.1v9.2h-9.2V3.45ZM3 12.7h7.7v7.7L3 19.3v-6.6Zm8.8 0H21v9.2l-9.2-1.3v-7.9Z" />
    </svg>
  );
}

// ── Ana bileşen ───────────────────────────────────────────────────────────────

export default function LoginPage() {
  const navigate  = useNavigate();
  const auth      = React.useContext(AuthContext);
  const login     = auth!.login;

  const [email,    setEmail]    = useState("admin@postgrify.local");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // First-run setup
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupEmail, setSetupEmail] = useState("");
  const [setupPw,    setSetupPw]    = useState("");
  const [setupPw2,   setSetupPw2]   = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Giriş başarısız";
      if (msg.includes("setup") || msg.includes("404")) {
        setNeedsSetup(true);
      } else {
        setError(msg);
      }
    } finally {
      setIsPending(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (setupPw !== setupPw2) { setError("Şifreler eşleşmiyor"); return; }
    setIsPending(true);
    try {
      await api.post("/setup", { email: setupEmail, password: setupPw });
      await login(setupEmail, setupPw);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Kurulum başarısız");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section className="min-h-screen bg-white p-3 text-black antialiased dark:bg-[#050505] dark:text-white">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">

        {/* ── Sol panel — form ──────────────────────────────────────────── */}
        <div className="flex min-h-[760px] items-start rounded-md border border-black/20 bg-white px-6 py-12 sm:px-10 dark:border-white/10 dark:bg-[#0a0a0a] lg:min-h-0 lg:px-14 lg:py-28 xl:px-20">
          <div className="mx-auto w-full max-w-[590px]">

            {/* Başlık */}
            <div>
              <h1 className="whitespace-nowrap text-3xl font-medium tracking-[-0.04em] sm:text-4xl lg:text-[42px] lg:leading-[1.05] xl:text-[50px]">
                {needsSetup ? "İlk kurulum" : "Tekrar hoş geldiniz"}
              </h1>
              <p className="mt-3 text-lg leading-snug text-black/60 dark:text-white/55 sm:text-xl lg:text-2xl xl:text-3xl">
                {needsSetup ? "Admin hesabı oluştur" : "PostgreSQL Gateway"}
              </p>
            </div>

            {!needsSetup ? (
              <>
                {/* Sosyal butonlar (dekoratif) */}
                <div className="mt-12 grid gap-5 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled
                    className="flex h-12 items-center justify-center gap-3 rounded-[10px] border border-black/15 bg-white text-sm font-medium text-black/70 dark:border-white/10 dark:bg-white/5 dark:text-white/70 opacity-40 cursor-not-allowed"
                  >
                    <GoogleIcon />
                    Google ile giriş
                  </button>
                  <button
                    type="button"
                    disabled
                    className="flex h-12 items-center justify-center gap-3 rounded-[10px] border border-black/15 bg-white text-sm font-medium text-black/70 dark:border-white/10 dark:bg-white/5 dark:text-white/70 opacity-40 cursor-not-allowed"
                  >
                    <AppleIcon />
                    Apple ile giriş
                  </button>
                </div>

                <div className="my-10 text-center text-xl font-medium text-black/60 dark:text-white/50">
                  veya
                </div>

                {/* Login formu */}
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-black/60 dark:text-white/55">
                      E-posta
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      className="h-12 w-full rounded-[10px] border border-black/15 bg-transparent px-4 text-sm text-black outline-none transition-colors placeholder:text-black/30 focus:border-black/40 dark:border-white/10 dark:text-white dark:placeholder:text-white/30 dark:focus:border-white/30"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-black/60 dark:text-white/55">
                      Şifre
                    </label>
                    <div className="relative">
                      <input
                        type={showPw ? "text" : "password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                        className="h-12 w-full rounded-[10px] border border-black/15 bg-transparent px-4 pr-11 text-sm text-black outline-none transition-colors focus:border-black/40 dark:border-white/10 dark:text-white dark:focus:border-white/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70 transition-colors"
                        tabIndex={-1}
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-500">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isPending}
                    className="mt-9 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-b-[3px] border-black bg-black text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50 dark:border-white dark:bg-white dark:text-black"
                  >
                    {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Giriş Yap
                  </button>
                </form>
              </>
            ) : (
              /* Setup formu */
              <form onSubmit={handleSetup} className="mt-12 space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-black/60 dark:text-white/55">E-posta</label>
                  <input
                    type="email"
                    value={setupEmail}
                    onChange={e => setSetupEmail(e.target.value)}
                    required
                    placeholder="admin@ornek.com"
                    className="h-12 w-full rounded-[10px] border border-black/15 bg-transparent px-4 text-sm outline-none transition-colors focus:border-black/40 dark:border-white/10 dark:text-white dark:focus:border-white/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-black/60 dark:text-white/55">Şifre</label>
                  <input
                    type="password"
                    value={setupPw}
                    onChange={e => setSetupPw(e.target.value)}
                    required
                    className="h-12 w-full rounded-[10px] border border-black/15 bg-transparent px-4 text-sm outline-none transition-colors focus:border-black/40 dark:border-white/10 dark:text-white dark:focus:border-white/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-black/60 dark:text-white/55">Şifre tekrar</label>
                  <input
                    type="password"
                    value={setupPw2}
                    onChange={e => setSetupPw2(e.target.value)}
                    required
                    className="h-12 w-full rounded-[10px] border border-black/15 bg-transparent px-4 text-sm outline-none transition-colors focus:border-black/40 dark:border-white/10 dark:text-white dark:focus:border-white/30"
                  />
                </div>
                {error && (
                  <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-500">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isPending}
                  className="mt-9 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-b-[3px] border-black bg-black text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50 dark:border-white dark:bg-white dark:text-black"
                >
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Hesabı Oluştur
                </button>
              </form>
            )}

            <p className="mt-10 text-center text-[11px] text-black/25 dark:text-white/25 tracking-wide">
              Argon2id · JWT · Redis session
            </p>
          </div>
        </div>

        {/* ── Sağ panel — GrainGradient + icon grid (birebir tasarımdan) ── */}
        <div className="relative hidden overflow-hidden rounded-md lg:block">
          {/* Grain gradient arka plan */}
          <GrainGradient
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            colors={["#1a0533", "#0d1a40", "#0a2a1a", "#1a1a2e"]}
            speed={0.4}
            noise={0.55}
          />

          {/* OS icon grid — tasarımdan birebir */}
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-8">
            {/* 5×2 grid — her cell bir OS ikonu */}
            <div className="grid grid-cols-5 gap-3 opacity-20">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/20 bg-white/5"
                >
                  {i % 3 === 0 ? (
                    <WindowsIcon className="h-6 w-6 text-white" />
                  ) : i % 3 === 1 ? (
                    <AppleIcon />
                  ) : (
                    <GoogleIcon />
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-3 opacity-10">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-white/3"
                >
                  {i % 3 === 0 ? (
                    <GoogleIcon />
                  ) : i % 3 === 1 ? (
                    <WindowsIcon className="h-6 w-6 text-white" />
                  ) : (
                    <AppleIcon />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Alt: büyük Postgrify yazısı */}
          <div className="absolute bottom-0 left-0 right-0 z-10 p-10">
            <p className="text-[64px] font-bold leading-none tracking-[-0.04em] text-white/10 select-none">
              Postgrify
            </p>
            <p className="mt-2 text-sm text-white/30">PostgreSQL Gateway · Multi-database management</p>
          </div>
        </div>

      </div>
    </section>
  );
}