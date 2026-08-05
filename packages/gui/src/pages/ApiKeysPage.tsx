/**
 * API Keys sayfası — DB token üret, scope seç, kopyala.
 */

import { useState } from "react";
import { Copy, Check, Key, ChevronDown } from "lucide-react";
import { useDatabases } from "../hooks/useDatabases.js";
import { useDbToken } from "../hooks/useAuth.js";

const ALL_SCOPES = ["read", "write", "delete", "schema", "query"] as const;
type Scope = typeof ALL_SCOPES[number];

const SCOPE_DESC: Record<Scope, string> = {
  read: "GET — satır ve tablo okuma",
  write: "POST, PUT, PATCH — satır ekleme/güncelleme",
  delete: "DELETE — satır silme",
  schema: "Tablo oluşturma/silme, şema değişikliği",
  query: "Ham SQL çalıştırma",
};

export default function ApiKeysPage() {
  const { data: databases } = useDatabases();
  const getToken = useDbToken();

  const [selectedDb, setSelectedDb] = useState("");
  const [secret, setSecret] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read", "write"]);
  const [expiresIn, setExpiresIn] = useState("24h");
  const [generatedToken, setGeneratedToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const toggleScope = (scope: Scope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setGeneratedToken("");

    if (!selectedDb) return setError("Veritabanı seçin");
    if (!secret.trim()) return setError("Secret gerekli");
    if (scopes.length === 0) return setError("En az bir scope seçin");

    try {
      const data = await getToken.mutateAsync({
        database: selectedDb,
        secret: secret.trim(),
        scope: scopes,
      });
      setGeneratedToken(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token üretilemedi");
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(generatedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">API Keys</h1>
        <p className="text-sm text-gray-500 mt-1">
          DB bazlı JWT token üret. Token, yalnızca seçilen veritabanına erişim sağlar.
        </p>
      </div>

      <form onSubmit={handleGenerate} className="space-y-4">
        {/* DB seç */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Veritabanı
          </label>
          <div className="relative">
            <select
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              className="w-full appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Seçin...</option>
              {databases?.map((db) => (
                <option key={db.name} value={db.name}>{db.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Secret */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            DB Secret
          </label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="DB_SECRET_MYDB (veya ADMIN_SECRET)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Scope'lar */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            İzinler (Scope)
          </label>
          <div className="space-y-2">
            {ALL_SCOPES.map((scope) => (
              <label
                key={scope}
                className="flex items-start gap-3 p-2.5 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="mt-0.5 rounded"
                />
                <div>
                  <span className="text-sm font-medium text-gray-800">{scope}</span>
                  <span className="ml-2 text-xs text-gray-500">{SCOPE_DESC[scope]}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Süre */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Geçerlilik Süresi
          </label>
          <div className="relative w-40">
            <select
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              className="w-full appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1h">1 saat</option>
              <option value="24h">24 saat</option>
              <option value="7d">7 gün</option>
              <option value="30d">30 gün</option>
              <option value="365d">1 yıl</option>
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={getToken.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Key className="w-4 h-4" />
          {getToken.isPending ? "Üretiliyor..." : "Token Üret"}
        </button>
      </form>

      {/* Üretilen token */}
      {generatedToken && (
        <div className="border border-green-200 rounded-xl p-4 bg-green-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-green-800">Token üretildi</span>
            <button
              onClick={copyToken}
              className="flex items-center gap-1.5 text-xs text-green-700 hover:text-green-900 transition-colors"
            >
              {copied ? (
                <><Check className="w-3.5 h-3.5" /> Kopyalandı</>
              ) : (
                <><Copy className="w-3.5 h-3.5" /> Kopyala</>
              )}
            </button>
          </div>
          <p className="font-mono text-xs text-green-900 break-all bg-white border border-green-200 rounded-lg p-2">
            {generatedToken}
          </p>
          <p className="text-xs text-green-600 mt-2">
            Bu token yalnızca <strong>{selectedDb}</strong> veritabanına erişim sağlar.
            Güvenli bir yerde sakla — bir daha gösterilmez.
          </p>
        </div>
      )}
    </div>
  );
}