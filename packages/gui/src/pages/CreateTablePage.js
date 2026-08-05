import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Yeni tablo oluşturma sayfası.
 * Kolon ekle/sil, tip seç, primary key / unique / nullable ayarla.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { useCreateTable } from "../hooks/useTables.js";
const PG_TYPES = [
    "serial", "bigserial",
    "integer", "bigint", "smallint",
    "numeric", "real", "double precision",
    "text", "varchar(255)", "char(1)",
    "boolean",
    "timestamptz", "timestamp", "date", "time",
    "uuid", "jsonb", "json",
    "bytea",
];
const defaultCol = () => ({
    name: "",
    type: "text",
    nullable: true,
    primaryKey: false,
    unique: false,
    default: "",
});
export default function CreateTablePage() {
    const { db } = useParams();
    const navigate = useNavigate();
    const createTable = useCreateTable();
    const [tableName, setTableName] = useState("");
    const [columns, setColumns] = useState([
        { name: "id", type: "serial", nullable: false, primaryKey: true, unique: false, default: "" },
        defaultCol(),
    ]);
    const [error, setError] = useState("");
    const addColumn = () => setColumns((c) => [...c, defaultCol()]);
    const removeColumn = (i) => setColumns((c) => c.filter((_, idx) => idx !== i));
    const updateColumn = (i, patch) => setColumns((c) => c.map((col, idx) => (idx === i ? { ...col, ...patch } : col)));
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        if (!tableName.trim())
            return setError("Tablo adı gerekli");
        if (columns.some((c) => !c.name.trim()))
            return setError("Tüm kolonların adı olmalı");
        try {
            await createTable.mutateAsync({
                db: db,
                name: tableName,
                columns: columns.map((c) => ({
                    name: c.name,
                    type: c.type,
                    nullable: c.nullable,
                    primaryKey: c.primaryKey,
                    unique: c.unique,
                    ...(c.default ? { default: c.default } : {}),
                })),
            });
            navigate(`/databases/${db}`);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Tablo oluşturulamadı");
        }
    };
    return (_jsxs("div", { className: "p-6 max-w-3xl", children: [_jsxs("button", { onClick: () => navigate(`/databases/${db}`), className: "flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4", children: [_jsx(ArrowLeft, { className: "w-4 h-4" }), " ", db] }), _jsx("h1", { className: "text-xl font-semibold text-gray-900 mb-6", children: "Yeni Tablo" }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Tablo Ad\u0131" }), _jsx("input", { value: tableName, onChange: (e) => setTableName(e.target.value), placeholder: "users", className: "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" })] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("label", { className: "text-sm font-medium text-gray-700", children: "Kolonlar" }), _jsxs("button", { type: "button", onClick: addColumn, className: "flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700", children: [_jsx(Plus, { className: "w-4 h-4" }), " Kolon Ekle"] })] }), _jsx("div", { className: "space-y-2", children: columns.map((col, i) => (_jsxs("div", { className: "grid grid-cols-12 gap-2 items-start p-3 border border-gray-200 rounded-lg bg-gray-50", children: [_jsx("input", { value: col.name, onChange: (e) => updateColumn(i, { name: e.target.value }), placeholder: "kolon_adi", className: "col-span-3 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" }), _jsx("select", { value: col.type, onChange: (e) => updateColumn(i, { type: e.target.value }), className: "col-span-3 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white", children: PG_TYPES.map((t) => (_jsx("option", { value: t, children: t }, t))) }), _jsx("input", { value: col.default, onChange: (e) => updateColumn(i, { default: e.target.value }), placeholder: "default", className: "col-span-2 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" }), _jsxs("div", { className: "col-span-3 flex gap-3 items-center pt-1.5 text-xs text-gray-600", children: [_jsxs("label", { className: "flex items-center gap-1 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: col.primaryKey, onChange: (e) => updateColumn(i, { primaryKey: e.target.checked, nullable: e.target.checked ? false : col.nullable }), className: "rounded" }), "PK"] }), _jsxs("label", { className: "flex items-center gap-1 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: col.unique, onChange: (e) => updateColumn(i, { unique: e.target.checked }), className: "rounded" }), "Unique"] }), _jsxs("label", { className: "flex items-center gap-1 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: col.nullable, disabled: col.primaryKey, onChange: (e) => updateColumn(i, { nullable: e.target.checked }), className: "rounded" }), "Null"] })] }), _jsx("div", { className: "col-span-1 flex justify-end", children: _jsx("button", { type: "button", onClick: () => removeColumn(i), disabled: columns.length <= 1, className: "p-1 text-gray-400 hover:text-red-500 disabled:opacity-30 transition-colors", children: _jsx(Trash2, { className: "w-4 h-4" }) }) })] }, i))) })] }), error && (_jsx("p", { className: "text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2", children: error })), _jsxs("div", { className: "flex gap-3", children: [_jsx("button", { type: "submit", disabled: createTable.isPending, className: "px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors", children: createTable.isPending ? "Oluşturuluyor..." : "Tabloyu Oluştur" }), _jsx("button", { type: "button", onClick: () => navigate(`/databases/${db}`), className: "px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors", children: "\u0130ptal" })] })] })] }));
}
