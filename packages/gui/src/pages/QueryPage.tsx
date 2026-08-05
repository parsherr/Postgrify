/**
 * SQL Editörü sayfası — DB seç, sorgu yaz, çalıştır, sonuçları gör.
 * Sadece SELECT sorguları (scope: query gerektirir).
 */

import { useState } from "react";
import { Play, ChevronDown } from "lucide-react";
import { useDatabases } from "../hooks/useDatabases.js";
import { api } from "../lib/api.js";

interface QueryResult {
  rows: Record<string, unknown>[];
  count: number;
  durationMs?: number;
}

export default function QueryPage() {
  const { data: databases } = useDatabases();
  const [selectedDb, setSelectedDb] = useState("");
  const [sql, setSql] = useState("SELECT * FROM ");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const runQuery = async () => {
    if (!selectedDb) return setError("Veritabanı seçin");
    if (!sql.trim()) return setError("Sorgu boş olamaz");

    setError("");
    setResult(null);
    setLoading(true);

    const start = Date.now();
    try {
      const data = await api.post<QueryResult>(`/db/${selectedDb}/query`, {
        sql: sql.trim(),
        params: [],
      });
      setResult({ ...data, durationMs: Date.now() - start });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sorgu başarısız");
    } finally {
      setLoading(false);
    }
  };

  const columns = result?.rows[0] ? Object.keys(result.rows[0]) : [];

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      <h1 className="text-xl font-semibold text-gray-900">SQL Editörü</h1>

      {/* DB seç + Çalıştır */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={selectedDb}
            onChange={(e) => setSelectedDb(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Veritabanı seç...</option>
            {databases?.map((db) => (
              <option key={db.name} value={db.name}>{db.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        <button
          onClick={runQuery}
          disabled={loading || !selectedDb}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Play className="w-4 h-4" />
          {loading ? "Çalışıyor..." : "Çalıştır"}
        </button>

        <span className="text-xs text-gray-400">Ctrl+Enter ile de çalıştırabilirsin</span>
      </div>

      {/* Editör */}
      <div className="relative">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              runQuery();
            }
          }}
          rows={8}
          spellCheck={false}
          className="w-full px-4 py-3 border border-gray-300 rounded-xl font-mono text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          placeholder="SELECT * FROM users LIMIT 10;"
        />
      </div>

      {/* Hata */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Sonuçlar */}
      {result && (
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>{result.count} satır döndü</span>
            {result.durationMs != null && <span>{result.durationMs}ms</span>}
          </div>

          {result.count === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center border border-gray-200 rounded-xl">
              Sonuç yok
            </p>
          ) : (
            <div className="overflow-auto border border-gray-200 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col}
                        className="text-left px-4 py-2.5 font-medium text-gray-600 whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {columns.map((col) => (
                        <td
                          key={col}
                          className="px-4 py-2 text-gray-700 max-w-xs truncate font-mono text-xs"
                        >
                          {row[col] == null ? (
                            <span className="text-gray-300 italic font-sans">null</span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}