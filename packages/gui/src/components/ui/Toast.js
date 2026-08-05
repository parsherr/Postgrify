import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Basit toast bildirimi bileşeni.
 * Kullanım: useToast hook'u ile tetiklenir.
 */
import { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";
const ToastContext = createContext(null);
let nextId = 0;
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const remove = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);
    const add = useCallback((type, message) => {
        const id = ++nextId;
        setToasts((prev) => [...prev, { id, type, message }]);
        setTimeout(() => remove(id), 4000);
    }, [remove]);
    return (_jsxs(ToastContext.Provider, { value: {
            success: (msg) => add("success", msg),
            error: (msg) => add("error", msg),
        }, children: [children, _jsx("div", { className: "fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none", children: toasts.map((toast) => (_jsxs("div", { className: `flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm pointer-events-auto transition-all
              ${toast.type === "success"
                        ? "bg-green-50 border border-green-200 text-green-800"
                        : "bg-red-50 border border-red-200 text-red-800"}`, children: [toast.type === "success" ? (_jsx(CheckCircle2, { className: "w-4 h-4 text-green-500 flex-shrink-0" })) : (_jsx(XCircle, { className: "w-4 h-4 text-red-500 flex-shrink-0" })), _jsx("span", { children: toast.message }), _jsx("button", { onClick: () => remove(toast.id), className: "ml-2 text-current opacity-50 hover:opacity-100 transition-opacity", children: _jsx(X, { className: "w-3.5 h-3.5" }) })] }, toast.id))) })] }));
}
export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx)
        throw new Error("useToast must be used within ToastProvider");
    return ctx;
}
