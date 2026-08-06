/**
 * SetupPage — ilk kurulum sihirbazı.
 *
 * 3 adım:
 *  1. Admin hesabı (email + şifre)
 *  2. PostgreSQL bağlantısı
 *  3. Özet + Tamamla
 *
 * POST /setup başarılı olursa /login'e yönlendirir.
 * API yeniden başlatılması gerektiği kullanıcıya bildirilir.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { postSetup, type SetupPayload } from "../lib/api";

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: "Admin Hesabı",
  2: "PostgreSQL Bağlantısı",
  3: "Özet",
};

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {([1, 2, 3] as Step[]).map((step, idx) => (
        <div key={step} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={[
                "h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                current === step
                  ? "bg-foreground text-background"
                  : current > step
                  ? "bg-foreground/30 text-foreground"
                  : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {current > step ? (
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                </svg>
              ) : (
                step
              )}
            </div>
            <span className="mt-1 text-xs text-muted-foreground whitespace-nowrap">
              {STEP_LABELS[step]}
            </span>
          </div>
          {idx < 2 && (
            <div
              className={[
                "h-px w-16 mx-2 mb-5 transition-colors",
                current > step ? "bg-foreground/30" : "bg-border",
              ].join(" ")}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  id,
  type = "text",
  value,
  onChange,
  error,
  placeholder,
  autoComplete,
}: {
  label: string;
  id: string;
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={[
          "h-9 rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-shadow",
          error ? "border-destructive focus:ring-destructive" : "border-border",
        ].join(" ")}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Step 1 state
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [step1Errors, setStep1Errors] = useState<Record<string, string>>({});

  // Step 2 state
  const [pgHost, setPgHost] = useState("localhost");
  const [pgPort, setPgPort] = useState("5432");
  const [pgUser, setPgUser] = useState("postgres");
  const [pgPassword, setPgPassword] = useState("");
  const [step2Errors, setStep2Errors] = useState<Record<string, string>>({});

  // ── Validation ────────────────────────────────────────────────
  function validateStep1(): boolean {
    const errs: Record<string, string> = {};
    if (!adminEmail.trim()) errs.adminEmail = "Email gerekli";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))
      errs.adminEmail = "Geçerli bir email girin";
    if (!adminPassword) errs.adminPassword = "Şifre gerekli";
    else if (adminPassword.length < 8)
      errs.adminPassword = "Şifre en az 8 karakter olmalı";
    if (adminPassword !== adminPasswordConfirm)
      errs.adminPasswordConfirm = "Şifreler eşleşmiyor";
    setStep1Errors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    const errs: Record<string, string> = {};
    if (!pgHost.trim()) errs.pgHost = "Host gerekli";
    const portNum = Number(pgPort);
    if (!pgPort || isNaN(portNum) || portNum < 1 || portNum > 65535)
      errs.pgPort = "Geçerli bir port girin (1-65535)";
    if (!pgUser.trim()) errs.pgUser = "Kullanıcı adı gerekli";
    setStep2Errors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Step handlers ─────────────────────────────────────────────
  function handleNext() {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
  }

  function handleBack() {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }

  async function handleSubmit() {
    setGlobalError(null);
    setSubmitting(true);
    try {
      const payload: SetupPayload = {
        adminEmail: adminEmail.trim(),
        adminPassword,
        pgHost: pgHost.trim(),
        pgPort: Number(pgPort),
        pgUser: pgUser.trim(),
        pgPassword,
      };
      await postSetup(payload);
      setDone(true);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Kurulum başarısız");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Done screen ───────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-foreground/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6 text-foreground">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Kurulum Tamamlandı</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Ayarlar <code className="bg-muted px-1 rounded text-xs">.env</code> dosyasına kaydedildi.
            Değişikliklerin geçerli olması için API sunucusunu yeniden başlatın.
          </p>
          <div className="rounded-md bg-muted/50 border border-border p-3 mb-6 text-left">
            <p className="text-xs font-mono text-muted-foreground">
              docker compose restart api
            </p>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              # veya: npm run dev (packages/api)
            </p>
          </div>
          <button
            onClick={() => navigate("/login")}
            className="w-full h-9 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Giriş Yap
          </button>
        </div>
      </div>
    );
  }

  // ── Main wizard ───────────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground">Postgrify Kurulum</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            İlk kullanım için temel ayarları yapılandırın
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <StepIndicator current={step} />

          {/* Step 1 — Admin hesabı */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Field
                label="Admin Email"
                id="adminEmail"
                type="email"
                value={adminEmail}
                onChange={setAdminEmail}
                error={step1Errors.adminEmail}
                placeholder="admin@example.com"
                autoComplete="email"
              />
              <Field
                label="Şifre"
                id="adminPassword"
                type="password"
                value={adminPassword}
                onChange={setAdminPassword}
                error={step1Errors.adminPassword}
                placeholder="En az 8 karakter"
                autoComplete="new-password"
              />
              <Field
                label="Şifre Tekrar"
                id="adminPasswordConfirm"
                type="password"
                value={adminPasswordConfirm}
                onChange={setAdminPasswordConfirm}
                error={step1Errors.adminPasswordConfirm}
                placeholder="Şifreyi tekrar girin"
                autoComplete="new-password"
              />
            </div>
          )}

          {/* Step 2 — PostgreSQL */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field
                    label="Host"
                    id="pgHost"
                    value={pgHost}
                    onChange={setPgHost}
                    error={step2Errors.pgHost}
                    placeholder="localhost"
                  />
                </div>
                <Field
                  label="Port"
                  id="pgPort"
                  type="number"
                  value={pgPort}
                  onChange={setPgPort}
                  error={step2Errors.pgPort}
                  placeholder="5432"
                />
              </div>
              <Field
                label="Kullanıcı Adı"
                id="pgUser"
                value={pgUser}
                onChange={setPgUser}
                error={step2Errors.pgUser}
                placeholder="postgres"
                autoComplete="username"
              />
              <Field
                label="Şifre"
                id="pgPassword"
                type="password"
                value={pgPassword}
                onChange={setPgPassword}
                placeholder="PostgreSQL şifresi"
                autoComplete="current-password"
              />
            </div>
          )}

          {/* Step 3 — Özet */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md bg-muted/50 border border-border p-4 text-sm space-y-2">
                <p className="font-medium text-foreground mb-3">Kurulum Özeti</p>
                <div className="flex justify-between text-muted-foreground">
                  <span>Admin Email</span>
                  <span className="font-mono text-foreground">{adminEmail}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Şifre</span>
                  <span className="font-mono text-foreground">{"•".repeat(Math.min(adminPassword.length, 8))}</span>
                </div>
                <hr className="border-border" />
                <div className="flex justify-between text-muted-foreground">
                  <span>PG Host</span>
                  <span className="font-mono text-foreground">{pgHost}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>PG Port</span>
                  <span className="font-mono text-foreground">{pgPort}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>PG Kullanıcı</span>
                  <span className="font-mono text-foreground">{pgUser}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>PG Şifre</span>
                  <span className="font-mono text-foreground">
                    {pgPassword ? "•".repeat(Math.min(pgPassword.length, 8)) : "(boş)"}
                  </span>
                </div>
              </div>
              {globalError && (
                <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                  {globalError}
                </p>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="mt-6 flex justify-between gap-3">
            {step > 1 ? (
              <button
                onClick={handleBack}
                disabled={submitting}
                className="h-9 px-4 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Geri
              </button>
            ) : (
              <div />
            )}

            {step < 3 ? (
              <button
                onClick={handleNext}
                className="h-9 px-6 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
              >
                İleri
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="h-9 px-6 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {submitting && (
                  <span className="h-3 w-3 rounded-full border-2 border-background/40 border-t-background animate-spin" />
                )}
                Kurulumu Tamamla
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}