import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ConfirmDialog({ open, title, description, confirmLabel = "Onayla", cancelLabel = "İptal", onConfirm, onCancel, danger = false, }) {
    if (!open)
        return null;
    return (_jsxs("div", { className: "fixed inset-0 z-50 flex items-center justify-center", children: [_jsx("div", { className: "absolute inset-0 bg-black/30 backdrop-blur-sm", onClick: onCancel }), _jsxs("div", { className: "relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4", children: [_jsx("h2", { className: "text-base font-semibold text-gray-900 mb-2", children: title }), _jsx("p", { className: "text-sm text-gray-500 mb-6", children: description }), _jsxs("div", { className: "flex gap-3 justify-end", children: [_jsx("button", { onClick: onCancel, className: "px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors", children: cancelLabel }), _jsx("button", { onClick: onConfirm, className: `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${danger
                                    ? "bg-red-600 text-white hover:bg-red-700"
                                    : "bg-blue-600 text-white hover:bg-blue-700"}`, children: confirmLabel })] })] })] }));
}
