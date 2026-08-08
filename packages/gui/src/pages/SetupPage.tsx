/**
 * SetupPage — ilk çalıştırma sihirbazı.
 *
 * Görsel dil LoginPage ile aynı: siyah zemin, GrainGradient sağ panel,
 * floating-label input'lar. 3 adım arası slide+fade animasyonu.
 *
 * Adımlar:
 *  1 — Admin hesabı (e-posta + şifre + tekrar)
 *  2 — PostgreSQL bağlantısı (host + port + kullanıcı + şifre)
 *  3 — Özet + tamamla
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GrainGradient } from "@paper-design/shaders-react";
import { postSetup } from "../lib/api";

// ── Floating-label input ──────────────────────────────────────────────────────

interface FieldBoxProps {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}

function FieldBox({ label, value, onChange, type = "text", required, placeholder }: FieldBoxProps) {
  const [focused, setFocused] = useState(false);
  const lifted = focused || value.length > 0;

  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        required={required}
        placeholder={placeholder ?? ""}
        className="peer h-14 w-full rounded-[10px] border border-white/20 bg-white/5 px-4 pt-5 pb-2 text-base text-white outline-none transition-colors placeholder:text-transparent focus:border-white/50"
      />
      <label
        className={`pointer-events-none absolute left-4 text-white/50 transition-all duration-150 ${
          lifted ? "top-2 text-[11px]" : "top-1/2 -translate-y-1/2 text-base"
        }`}
      >
        {label}
      </label>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEP_LABELS = ["Admin Hesabı", "Veritabanı", "Özet"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEP_LABELS.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;

        return (
          <div key={idx} className="flex items-center">
            {/* Daire */}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-all duration-300 ${
                  active
                    ? "bg-white text-black"
                    : done
                    ? "bg-white/20 text-white"
                    : "bg-white/10 text-white/40"
                }`}
              >
                {done ? (
                  // Tik ikonu
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  idx
                )}
              </div>
              <span className={`mt-1.5 text-[10px] tracking-wide transition-colors duration-300 ${active ? "text-white/70" : "text-white/30"}`}>
                {label}
              </span>
            </div>

            {/* Bağlantı çizgisi */}
            {i < STEP_LABELS.length - 1 && (
              <div className={`mb-5 h-px w-10 transition-colors duration-300 ${done ? "bg-white/30" : "bg-white/10"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Adım başlıkları ────────────────────────────────────────────────────────────

const STEP_HEADINGS: Record<number, { title: string; sub: string }> = {
  1: { title: "Admin hesabını\noluştur", sub: "Sisteme giriş için kullanacağın hesap." },
  2: { title: "Veritabanını\nbağla", sub: "PostgreSQL bağlantı bilgilerini gir." },
  3: { title: "Her şey\nhazır", sub: "Ayarları gözden geçir ve tamamla." },
};

// ── Ana bileşen ────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const navigate = useNavigate();

  // Adım durumu
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  // Adım 1 — Admin hesabı
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // Adım 2 — PostgreSQL
  const [pgHost, setPgHost] = useState("localhost");
  const [pgPort, setPgPort] = useState("5432");
  const [pgUser, setPgUser] = useState("postgres");
  const [pgPassword, setPgPassword] = useState("");

  // UI durumu
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [done, setDone] = useState(false);

  // ── Validasyon ──────────────────────────────────────────────────────────────

  function validateStep1(): string {
    if (!email.includes("@")) return "Geçerli bir e-posta gir.";
    if (password.length < 8) return "Şifre en az 8 karakter olmalı.";
    if (password !== passwordConfirm) return "Şifreler eşleşmiyor.";
    return "";
  }

  function validateStep2(): string {
    const port = Number(pgPort);
    if (!pgHost.trim()) return "Host alanı boş olamaz.";
    if (!pgUser.trim()) return "Kullanıcı adı boş olamaz.";
    if (!pgPassword.trim()) return "Şifre boş olamaz.";
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "Port 1–65535 arasında olmalı.";
    return "";
  }

  // ── Adım geçişleri ──────────────────────────────────────────────────────────

  function goNext() {
    setError("");
    const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : "";
    if (err) { setError(err); return; }
    setDirection("forward");
    setStep(s => s + 1);
  }

  function goBack() {
    setError("");
    setDirection("back");
    setStep(s => s - 1);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setError("");
    setIsPending(true);
    try {
      await postSetup({
        adminEmail: email,
        adminPassword: password,
        pgHost,
        pgPort: Number(pgPort),
        pgUser,
        pgPassword,
      });
      setDone(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Kurulum başarısız.";
      setError(msg);
    } finally {
      setIsPending(false);
    }
  }

  // ── Sağ panel sloganı ───────────────────────────────────────────────────────

  const heading = STEP_HEADINGS[step];
  const slideClass = direction === "forward"
    ? "animate-in fade-in slide-in-from-right-4 duration-300"
    : "animate-in fade-in slide-in-from-left-4 duration-300";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className="min-h-screen bg-black p-3 text-white antialiased [font-synthesis:none]">
      <div className="grid min-h-[calc(100vh-1.5rem)] rounded-md lg:grid-cols-2 lg:gap-3">

        {/* ── Sol panel — form ──────────────────────────────────────────── */}
        <div className="flex flex-col justify-center px-8 sm:px-16 lg:px-20">

          {/* Logo */}
          <div className="mb-10">
            <img src="/black-white-logo.png" alt="Postgrify" className="h-8 w-8 object-contain invert" />
          </div>

          {done ? (
            /* ── Tamamlandı ekranı ───────────────────────────── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M5 14L11 20L23 8" stroke="#EFFF12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h1 className="text-4xl font-medium tracking-[-0.04em] text-white">
                Kurulum tamamlandı!
              </h1>
              <p className="mt-3 text-base text-white/50">
                API sunucusunu yeniden başlat, ardından giriş yapabilirsin.
              </p>
              <p className="mt-6 text-[11px] tracking-wide text-white/25">
                Giriş sayfasına yönlendiriliyorsun…
              </p>
            </div>
          ) : (
            <>
              {/* Step indicator */}
              <div className="mb-8">
                <StepIndicator current={step} />
              </div>

              {/* Adım başlığı */}
              <div key={`heading-${step}`} className={slideClass}>
                <h1 className="whitespace-pre-line text-4xl font-medium tracking-[-0.04em] text-white sm:text-5xl">
                  {heading.title}
                </h1>
                <p className="mt-2 text-sm text-white/50">{heading.sub}</p>
              </div>

              {/* Form alanları */}
              <div key={`form-${step}`} className={`mt-8 space-y-4 ${slideClass}`}>

                {step === 1 && (
                  <>
                    <FieldBox label="E-posta" value={email} onChange={e => setEmail(e.target.value)} type="email" required />
                    <FieldBox label="Şifre" value={password} onChange={e => setPassword(e.target.value)} type="password" required />
                    <FieldBox label="Şifre tekrar" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} type="password" required />
                  </>
                )}

                {step === 2 && (
                  <>
                    <FieldBox label="Host" value={pgHost} onChange={e => setPgHost(e.target.value)} required />
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-1">
                        <FieldBox label="Port" value={pgPort} onChange={e => setPgPort(e.target.value)} required />
                      </div>
                      <div className="col-span-2">
                        <FieldBox label="Kullanıcı" value={pgUser} onChange={e => setPgUser(e.target.value)} required />
                      </div>
                    </div>
                    <FieldBox label="Şifre" value={pgPassword} onChange={e => setPgPassword(e.target.value)} type="password" required />
                  </>
                )}

                {step === 3 && (
                  <div className="space-y-2 rounded-[10px] border border-white/10 bg-white/5 p-5 text-sm">
                    <SummaryRow label="E-posta" value={email} />
                    <SummaryRow label="Şifre" value="••••••••" />
                    <div className="my-3 h-px bg-white/10" />
                    <SummaryRow label="Host" value={pgHost} />
                    <SummaryRow label="Port" value={pgPort} />
                    <SummaryRow label="Kullanıcı" value={pgUser} />
                    <SummaryRow label="DB Şifresi" value="••••••••" />
                  </div>
                )}

              </div>

              {/* Hata mesajı */}
              {error && (
                <p className="mt-3 text-sm text-red-400">{error}</p>
              )}

              {/* Butonlar */}
              <div className="mt-8 flex items-center gap-3">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex h-12 items-center justify-center rounded-[10px] border border-white/20 bg-white/5 px-6 text-base font-medium text-white transition-colors hover:bg-white/10"
                  >
                    Geri
                  </button>
                )}

                {step < 3 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex h-12 flex-1 items-center justify-center rounded-[10px] border border-white/40 bg-white text-base font-medium text-black transition-colors hover:bg-white/85"
                  >
                    Devam Et
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[10px] border border-white/40 bg-white text-base font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
                  >
                    {isPending && (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    )}
                    Kurulumu Tamamla
                  </button>
                )}
              </div>

              <p className="mt-10 text-center text-[11px] tracking-wide text-white/25">
                Argon2id · JWT · Redis session
              </p>
            </>
          )}
        </div>

        {/* ── Sağ panel — GrainGradient ─────────────────────────────────── */}
        <div className="relative hidden overflow-hidden rounded-md bg-black text-white lg:block">
          {/* Sarı grain gradient — köşelerden akan efekt */}
          <GrainGradient
            speed={0.3}
            scale={1}
            rotation={0}
            offsetX={0}
            offsetY={0}
            softness={0.5}
            intensity={0.5}
            noise={0.25}
            shape="corners"
            frame={2854.5}
            colors={["#FFFFFF", "#EFFF12", "#EFFF12", "#FFFFFF"]}
            colorBack="#00000000"
            className="absolute inset-0 bg-black"
          />

          {/* İçerik */}
          <div className="relative z-10 flex h-full w-full flex-col justify-between p-8 sm:p-12">
            <h2 className="max-w-[520px] pt-0 text-5xl font-medium tracking-[-0.05em] text-white sm:text-6xl lg:pt-16 lg:text-[64px] lg:leading-[0.98] xl:text-[70px]">
              Setup fast,
              <br />
              Scale faster
            </h2>
          </div>
        </div>

      </div>
    </section>
  );
}

// ── Yardımcı: özet satırı ─────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/40">{label}</span>
      <span className="text-white/80">{value}</span>
    </div>
  );
}