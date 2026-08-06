import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { postSetup } from "../lib/api";
const STEP_LABELS = {
    1: "Admin Hesabı",
    2: "PostgreSQL Bağlantısı",
    3: "Özet",
};
function StepIndicator({ current }) {
    return (_jsx("div", { className: "flex items-center justify-center gap-0 mb-8", children: [1, 2, 3].map((step, idx) => (_jsxs("div", { className: "flex items-center", children: [_jsxs("div", { className: "flex flex-col items-center", children: [_jsx("div", { className: [
                                "h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                                current === step
                                    ? "bg-foreground text-background"
                                    : current > step
                                        ? "bg-foreground/30 text-foreground"
                                        : "bg-muted text-muted-foreground",
                            ].join(" "), children: current > step ? (_jsx("svg", { viewBox: "0 0 16 16", fill: "currentColor", className: "h-4 w-4", children: _jsx("path", { d: "M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" }) })) : (step) }), _jsx("span", { className: "mt-1 text-xs text-muted-foreground whitespace-nowrap", children: STEP_LABELS[step] })] }), idx < 2 && (_jsx("div", { className: [
                        "h-px w-16 mx-2 mb-5 transition-colors",
                        current > step ? "bg-foreground/30" : "bg-border",
                    ].join(" ") }))] }, step))) }));
}
function Field({ label, id, type = "text", value, onChange, error, placeholder, autoComplete, }) {
    return (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("label", { htmlFor: id, className: "text-sm font-medium text-foreground", children: label }), _jsx("input", { id: id, type: type, value: value, onChange: (e) => onChange(e.target.value), placeholder: placeholder, autoComplete: autoComplete, className: [
                    "h-9 rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-shadow",
                    error ? "border-destructive focus:ring-destructive" : "border-border",
                ].join(" ") }), error && _jsx("p", { className: "text-xs text-destructive", children: error })] }));
}
export default function SetupPage() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [globalError, setGlobalError] = useState(null);
    const [done, setDone] = useState(false);
    // Step 1 state
    const [adminEmail, setAdminEmail] = useState("");
    const [adminPassword, setAdminPassword] = useState("");
    const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
    const [step1Errors, setStep1Errors] = useState({});
    // Step 2 state
    const [pgHost, setPgHost] = useState("localhost");
    const [pgPort, setPgPort] = useState("5432");
    const [pgUser, setPgUser] = useState("postgres");
    const [pgPassword, setPgPassword] = useState("");
    const [step2Errors, setStep2Errors] = useState({});
    // ── Validation ────────────────────────────────────────────────
    function validateStep1() {
        const errs = {};
        if (!adminEmail.trim())
            errs.adminEmail = "Email gerekli";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))
            errs.adminEmail = "Geçerli bir email girin";
        if (!adminPassword)
            errs.adminPassword = "Şifre gerekli";
        else if (adminPassword.length < 8)
            errs.adminPassword = "Şifre en az 8 karakter olmalı";
        if (adminPassword !== adminPasswordConfirm)
            errs.adminPasswordConfirm = "Şifreler eşleşmiyor";
        setStep1Errors(errs);
        return Object.keys(errs).length === 0;
    }
    function validateStep2() {
        const errs = {};
        if (!pgHost.trim())
            errs.pgHost = "Host gerekli";
        const portNum = Number(pgPort);
        if (!pgPort || isNaN(portNum) || portNum < 1 || portNum > 65535)
            errs.pgPort = "Geçerli bir port girin (1-65535)";
        if (!pgUser.trim())
            errs.pgUser = "Kullanıcı adı gerekli";
        setStep2Errors(errs);
        return Object.keys(errs).length === 0;
    }
    // ── Step handlers ─────────────────────────────────────────────
    function handleNext() {
        if (step === 1 && validateStep1())
            setStep(2);
        else if (step === 2 && validateStep2())
            setStep(3);
    }
    function handleBack() {
        if (step === 2)
            setStep(1);
        else if (step === 3)
            setStep(2);
    }
    async function handleSubmit() {
        setGlobalError(null);
        setSubmitting(true);
        try {
            const payload = {
                adminEmail: adminEmail.trim(),
                adminPassword,
                pgHost: pgHost.trim(),
                pgPort: Number(pgPort),
                pgUser: pgUser.trim(),
                pgPassword,
            };
            await postSetup(payload);
            setDone(true);
        }
        catch (err) {
            setGlobalError(err instanceof Error ? err.message : "Kurulum başarısız");
        }
        finally {
            setSubmitting(false);
        }
    }
    // ── Done screen ───────────────────────────────────────────────
    if (done) {
        return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-background px-4", children: _jsxs("div", { className: "w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm text-center", children: [_jsx("div", { className: "mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-foreground/10", children: _jsx("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", className: "h-6 w-6 text-foreground", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M5 13l4 4L19 7" }) }) }), _jsx("h2", { className: "text-xl font-semibold text-foreground mb-2", children: "Kurulum Tamamland\u0131" }), _jsxs("p", { className: "text-sm text-muted-foreground mb-6", children: ["Ayarlar ", _jsx("code", { className: "bg-muted px-1 rounded text-xs", children: ".env" }), " dosyas\u0131na kaydedildi. De\u011Fi\u015Fikliklerin ge\u00E7erli olmas\u0131 i\u00E7in API sunucusunu yeniden ba\u015Flat\u0131n."] }), _jsxs("div", { className: "rounded-md bg-muted/50 border border-border p-3 mb-6 text-left", children: [_jsx("p", { className: "text-xs font-mono text-muted-foreground", children: "docker compose restart api" }), _jsx("p", { className: "text-xs font-mono text-muted-foreground mt-1", children: "# veya: npm run dev (packages/api)" })] }), _jsx("button", { onClick: () => navigate("/login"), className: "w-full h-9 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors", children: "Giri\u015F Yap" })] }) }));
    }
    // ── Main wizard ───────────────────────────────────────────────
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-background px-4", children: _jsxs("div", { className: "w-full max-w-md", children: [_jsxs("div", { className: "mb-8 text-center", children: [_jsx("h1", { className: "text-2xl font-bold text-foreground", children: "Postgrify Kurulum" }), _jsx("p", { className: "mt-1 text-sm text-muted-foreground", children: "\u0130lk kullan\u0131m i\u00E7in temel ayarlar\u0131 yap\u0131land\u0131r\u0131n" })] }), _jsxs("div", { className: "rounded-xl border border-border bg-card p-8 shadow-sm", children: [_jsx(StepIndicator, { current: step }), step === 1 && (_jsxs("div", { className: "flex flex-col gap-4", children: [_jsx(Field, { label: "Admin Email", id: "adminEmail", type: "email", value: adminEmail, onChange: setAdminEmail, error: step1Errors.adminEmail, placeholder: "admin@example.com", autoComplete: "email" }), _jsx(Field, { label: "\u015Eifre", id: "adminPassword", type: "password", value: adminPassword, onChange: setAdminPassword, error: step1Errors.adminPassword, placeholder: "En az 8 karakter", autoComplete: "new-password" }), _jsx(Field, { label: "\u015Eifre Tekrar", id: "adminPasswordConfirm", type: "password", value: adminPasswordConfirm, onChange: setAdminPasswordConfirm, error: step1Errors.adminPasswordConfirm, placeholder: "\u015Eifreyi tekrar girin", autoComplete: "new-password" })] })), step === 2 && (_jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "grid grid-cols-3 gap-3", children: [_jsx("div", { className: "col-span-2", children: _jsx(Field, { label: "Host", id: "pgHost", value: pgHost, onChange: setPgHost, error: step2Errors.pgHost, placeholder: "localhost" }) }), _jsx(Field, { label: "Port", id: "pgPort", type: "number", value: pgPort, onChange: setPgPort, error: step2Errors.pgPort, placeholder: "5432" })] }), _jsx(Field, { label: "Kullan\u0131c\u0131 Ad\u0131", id: "pgUser", value: pgUser, onChange: setPgUser, error: step2Errors.pgUser, placeholder: "postgres", autoComplete: "username" }), _jsx(Field, { label: "\u015Eifre", id: "pgPassword", type: "password", value: pgPassword, onChange: setPgPassword, placeholder: "PostgreSQL \u015Fifresi", autoComplete: "current-password" })] })), step === 3 && (_jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "rounded-md bg-muted/50 border border-border p-4 text-sm space-y-2", children: [_jsx("p", { className: "font-medium text-foreground mb-3", children: "Kurulum \u00D6zeti" }), _jsxs("div", { className: "flex justify-between text-muted-foreground", children: [_jsx("span", { children: "Admin Email" }), _jsx("span", { className: "font-mono text-foreground", children: adminEmail })] }), _jsxs("div", { className: "flex justify-between text-muted-foreground", children: [_jsx("span", { children: "\u015Eifre" }), _jsx("span", { className: "font-mono text-foreground", children: "•".repeat(Math.min(adminPassword.length, 8)) })] }), _jsx("hr", { className: "border-border" }), _jsxs("div", { className: "flex justify-between text-muted-foreground", children: [_jsx("span", { children: "PG Host" }), _jsx("span", { className: "font-mono text-foreground", children: pgHost })] }), _jsxs("div", { className: "flex justify-between text-muted-foreground", children: [_jsx("span", { children: "PG Port" }), _jsx("span", { className: "font-mono text-foreground", children: pgPort })] }), _jsxs("div", { className: "flex justify-between text-muted-foreground", children: [_jsx("span", { children: "PG Kullan\u0131c\u0131" }), _jsx("span", { className: "font-mono text-foreground", children: pgUser })] }), _jsxs("div", { className: "flex justify-between text-muted-foreground", children: [_jsx("span", { children: "PG \u015Eifre" }), _jsx("span", { className: "font-mono text-foreground", children: pgPassword ? "•".repeat(Math.min(pgPassword.length, 8)) : "(boş)" })] })] }), globalError && (_jsx("p", { className: "text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2", children: globalError }))] })), _jsxs("div", { className: "mt-6 flex justify-between gap-3", children: [step > 1 ? (_jsx("button", { onClick: handleBack, disabled: submitting, className: "h-9 px-4 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50", children: "Geri" })) : (_jsx("div", {})), step < 3 ? (_jsx("button", { onClick: handleNext, className: "h-9 px-6 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors", children: "\u0130leri" })) : (_jsxs("button", { onClick: handleSubmit, disabled: submitting, className: "h-9 px-6 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center gap-2", children: [submitting && (_jsx("span", { className: "h-3 w-3 rounded-full border-2 border-background/40 border-t-background animate-spin" })), "Kurulumu Tamamla"] }))] })] })] }) }));
}
