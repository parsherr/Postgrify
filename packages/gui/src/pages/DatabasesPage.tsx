/**
 * Veritabanları listesi sayfası — oluştur, sil, boyut görüntüle.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Database, Trash2, AlertCircle } from "lucide-react";
import {
  useDatabases,
  useCreateDatabase,
  useDeleteDatabase,
} from "../hooks/useDatabases.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function DatabasesPage() {
  const { data: databases, isLoading } = useDatabases();
  const createDb = useCreateDatabase();
  const deleteDb = useDeleteDatabase();

  const [showCreate, setShowCreate] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const [createError, setCreateError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    try {
      await createDb.mutateAsync(newDbName.trim());
      setNewDbName("");
      setShowCreate(false);
      setCreateError("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Oluşturulamadı");
    }
  };

  const handleDelete = async (name: string) => {
    if (confirmDelete !== name) {
      setConfirmDelete(name);
      return;
    }
    try {
      await deleteDb.mutateAsync(name);
      setConfirmDelete(null);
    } catch {
      setConfirmDelete(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Veritabanları</h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Veritabanı
        </button>
      </div>

      {/* Oluşturma formu */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="border border-blue-200 rounded-xl p-4 bg-blue-50 flex gap-3 items-start"
        >
          <div className="flex-1">
            <input
              autoFocus
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              placeholder="veritabani_adi"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {createError && (
              <p className="text-xs text-red-600 mt-1">{createError}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={!newDbName.trim() || createDb.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {createDb.isPending ? "Oluşturuluyor..." : "Oluştur"}
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(false); setNewDbName(""); setCreateError(""); }}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            İptal
          </button>
        </form>
      )}

      {/* Silme onay uyarısı */}
      {confirmDelete && (
        <div className="flex items-start gap-3 border border-red-200 rounded-xl p-4 bg-red-50">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">
              <strong>{confirmDelete}</strong> veritabanını silmek istediğinden emin misin?
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Bu işlem geri alınamaz. Tüm tablolar ve veriler silinir.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleDelete(confirmDelete)}
              disabled={deleteDb.isPending}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {deleteDb.isPending ? "Siliniyor..." : "Evet, Sil"}
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs hover:bg-gray-50"
            >
              İptal
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Yükleniyor...</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Veritabanı</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Tablolar</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Boyut</th>
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {databases?.map((db) => (
                <tr key={db.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/databases/${db.name}`}
                      className="flex items-center gap-2 font-medium text-blue-600 hover:text-blue-700"
                    >
                      <Database className="w-4 h-4" />
                      {db.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {db.table_count}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {formatBytes(db.size_bytes)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(db.name)}
                      className={`p-1.5 rounded transition-colors ${
                        confirmDelete === db.name
                          ? "bg-red-100 text-red-600"
                          : "text-gray-400 hover:text-red-500"
                      }`}
                      title="Sil"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {databases?.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">
              Henüz veritabanı yok. Yeni bir tane oluşturun.
            </p>
          )}
        </div>
      )}
    </div>
  );
}