/**
 * SetupPage — first-run setup wizard.
 *
 * Visual language matches LoginPage: black background, GrainGradient right panel,
 * floating-label inputs. Slide+fade animation between 3 steps.
 *
 * Steps:
 *  1 — Admin account (email + password + confirm)
 *  2 — PostgreSQL connection (host + port + user + password)
 *  3 — Summary + finish
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { GrainGradient } from "@paper-design/shaders-react";
import { postSetup } from "../lib/api";
import { useAuthContext } from "../hooks/useAuthContext";

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
        className="peer h-16 w-full rounded-[10px] border border-zinc-700 bg-zinc-900 px-5 pt-6 pb-2 text-base text-white outline-none transition-colors placeholder:text-transparent focus:border-zinc-500"
      />
      <label
        className={`pointer-events-none absolute left-5 text-zinc-400 transition-all duration-150 ${
          lifted ? "top-2 text-[11px]" : "top-1/2 -translate-y-1/2 text-base"
        }`}
      >
        {label}
      </label>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEP_LABELS = ["Admin Account", "Database", "Summary"];

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
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-all duration-300 ${
                  active
                    ? "bg-white text-black"
                    : done
                    ? "bg-zinc-700 text-white"
                    : "bg-zinc-800 text-zinc-500"
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
              <span className={`mt-1.5 text-[10px] tracking-wide transition-colors duration-300 ${active ? "text-zinc-300" : "text-zinc-600"}`}>
                {label}
              </span>
            </div>

            {/* Connection line */}
            {i < STEP_LABELS.length - 1 && (
              <div className={`mb-5 h-px w-12 transition-colors duration-300 ${done ? "bg-zinc-600" : "bg-zinc-800"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step headings ────────────────────────────────────────────────────────────

const STEP_HEADINGS: Record<number, { title: string; sub: string }> = {
  1: { title: "Create admin\naccount", sub: "The account you will use to log in to the system." },
  2: { title: "Connect your\ndatabase", sub: "Enter your PostgreSQL connection details." },
  3: { title: "Everything\nis ready", sub: "Review your settings and finish." },
};

// ── Main component ────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { login, loginWithTokens } = useAuthContext();

  // Step state
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  // Step 1 — Admin account
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // Step 2 — PostgreSQL
  const [pgHost, setPgHost] = useState("localhost");
  const [pgPort, setPgPort] = useState("5432");
  const [pgUser, setPgUser] = useState("postgres");
  const [pgPassword, setPgPassword] = useState("");

  // UI durumu
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  // ── Validasyon ──────────────────────────────────────────────────────────────

  function validateStep1(): string {
    if (!email.includes("@")) return "Enter a valid email address.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== passwordConfirm) return "Passwords do not match.";
    return "";
  }

  function validateStep2(): string {
    const port = Number(pgPort);
    if (!pgHost.trim()) return "Host cannot be empty.";
    if (!pgUser.trim()) return "Username cannot be empty.";
    if (!pgPassword.trim()) return "Password cannot be empty.";
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "Port must be between 1–65535.";
    return "";
  }

  // ── Step transitions ──────────────────────────────────────────────────────────

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
      const result = await postSetup({
        adminEmail: email,
        adminPassword: password,
        pgHost,
        pgPort: Number(pgPort),
        pgUser,
        pgPassword,
      });

      // Update cache — SetupGuard will now see configured=true
      queryClient.setQueryData(["setup-status"], { configured: true });

      // API setup response'unda token varsa direkt kullan (container modunda
      // /auth/admin/login returns 503 because env vars are not yet updated).
      // Token yoksa klasik login dene.
      if (result.accessToken) {
        loginWithTokens(result.accessToken, result.refreshToken ?? null, result.email ?? email);
      } else {
        await login(email, password);
      }

      // Redirect to dashboard
      navigate("/", { replace: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Setup failed.";
      setError(msg);
    } finally {
      setIsPending(false);
    }
  }

  // ── Right panel slogan ───────────────────────────────────────────────────────

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

          <>
              {/* Step indicator */}
              <div className="mb-8">
                <StepIndicator current={step} />
              </div>

              {/* Step heading */}
              <div key={`heading-${step}`} className={slideClass}>
                <h1 className="whitespace-pre-line text-5xl font-medium tracking-[-0.05em] text-white sm:text-6xl lg:text-[64px] lg:leading-[0.98]">
                  {heading.title}
                </h1>
                <p className="mt-2 text-sm text-zinc-400">{heading.sub}</p>
              </div>

              {/* Form fields */}
              <div key={`form-${step}`} className={`mt-8 space-y-5 ${slideClass}`}>

                {step === 1 && (
                  <>
                    <FieldBox label="E-posta" value={email} onChange={e => setEmail(e.target.value)} type="email" required />
                    <FieldBox label="Password" value={password} onChange={e => setPassword(e.target.value)} type="password" required />
                    <FieldBox label="Confirm password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} type="password" required />
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
                        <FieldBox label="Username" value={pgUser} onChange={e => setPgUser(e.target.value)} required />
                      </div>
                    </div>
                    <FieldBox label="Password" value={pgPassword} onChange={e => setPgPassword(e.target.value)} type="password" required />
                  </>
                )}

                {step === 3 && (
                  <div className="space-y-2 rounded-[10px] border border-zinc-800 bg-zinc-900 p-5 text-sm">
                    <SummaryRow label="E-posta" value={email} />
                    <SummaryRow label="Password" value="••••••••" />
                    <div className="my-3 h-px bg-zinc-800" />
                    <SummaryRow label="Host" value={pgHost} />
                    <SummaryRow label="Port" value={pgPort} />
                    <SummaryRow label="Username" value={pgUser} />
                    <SummaryRow label="DB Password" value="••••••••" />
                  </div>
                )}

              </div>

              {/* Error message */}
              {error && (
                <p className="mt-3 text-sm text-red-400">{error}</p>
              )}

              {/* Butonlar */}
              <div className="mt-8 flex items-center gap-3">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex h-[52px] items-center justify-center rounded-[10px] border border-zinc-700 bg-zinc-900 px-6 text-base font-medium text-white transition-colors hover:bg-zinc-800"
                  >
                    Geri
                  </button>
                )}

                {step < 3 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex h-[52px] flex-1 items-center justify-center rounded-[10px] border border-zinc-600 bg-white text-base font-medium text-black transition-colors hover:bg-zinc-100"
                  >
                    Devam Et
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending}
                    className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-zinc-600 bg-white text-base font-medium text-black transition-colors hover:bg-zinc-100 disabled:opacity-50"
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

              <p className="mt-10 text-center text-[11px] tracking-wide text-zinc-600">
                Argon2id · JWT · Redis session
              </p>
            </>
        </div>

        {/* ── Right panel — GrainGradient ─────────────────────────────────── */}
        <div className="relative hidden overflow-hidden rounded-md bg-black text-white lg:block">
          {/* Yellow grain gradient — flowing from corners effect */}
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

          {/* Content */}
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

// ── Helper: summary row ─────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200">{value}</span>
    </div>
  );
}