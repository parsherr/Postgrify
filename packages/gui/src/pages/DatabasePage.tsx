/**
 * Tek bir veritabanının tablo listesi — tablo oluştur, sil, boyut gör.
 */

import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Plus, Table2, Trash2, ArrowLeft } from "lucide-react";
import { useTables, useDropTable } from "../hooks/useTables.js";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.js";

export default function DatabasePage() {
  const { db } = useParams<{ db: string }>();
  const navigate = useNavigate();
  const { data: tables, isLoading } = useTables(db!);
  const dropTable = useDropTable();

  const [confirmTable, setConfirmTable] = useState<string | null>(null);

  const handleDropConfirm = async () => {
    if (!confirmTable) return;
    try {
      await dropTable.mutateAsync({ db: db!, table: confirmTable });
    } finally {
      setConfirmTable(null);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/databases")}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-xl font-semibold text-gray-900">{db}</h1>
        </div>
        <Link
          to={`/databases/${db}/new-table`}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Tablo
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Yükleniyor...</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tablo</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Tahmini Satır</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Boyut</th>
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tables?.map((t) => (
                <tr key={t.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/databases/${db}/tables/${t.name}`}
                      className="flex items-center gap-2 font-medium text-blue-600 hover:text-blue-700"
                    >
                      <Table2 className="w-4 h-4" />
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {t.estimated_row_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{t.size}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setConfirmTable(t.name)}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      title="Tabloyu sil"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tables?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Table2 className="w-8 h-8 mb-2" />
              <p className="text-sm">Henüz tablo yok</p>
              <Link
                to={`/databases/${db}/new-table`}
                className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
              >
                <Plus className="w-4 h-4" />
                Tablo oluştur
              </Link>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmTable}
        title={`"${confirmTable}" tablosunu sil`}
        description="Bu işlem geri alınamaz. Tablodaki tüm veriler kalıcı olarak silinir."
        confirmLabel="Evet, Sil"
        onConfirm={handleDropConfirm}
        onCancel={() => setConfirmTable(null)}
        danger
      />
    </div>
  );
}