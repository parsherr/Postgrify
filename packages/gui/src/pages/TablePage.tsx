/**
 * Tablo veri görüntüleme ve düzenleme sayfası.
 * Sayfalı grid, satır silme, şema kolonları.
 */

import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useRows, useDeleteRow } from "../hooks/useRows.js";
import { useTableSchema } from "../hooks/useTables.js";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.js";

const PAGE_SIZE = 50;

export default function TablePage() {
  const { db, table } = useParams<{ db: string; table: string }>();
  const navigate = useNavigate();

  const [offset, setOffset] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: result, isLoading } = useRows(db!, table!, {
    limit: PAGE_SIZE,
    offset,
  });
  const { data: schema } = useTableSchema(db!, table!);
  const deleteRow = useDeleteRow();

  const columns = schema?.columns.map((c) => c.name) ?? (
    result?.rows[0] ? Object.keys(result.rows[0]) : []
  );

  const total = result?.total ?? 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleDelete = async () => {
    if (!confirmId) return;
    await deleteRow.mutateAsync({ db: db!, table: table!, id: confirmId });
    setConfirmId(null);
  };

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/databases/${db}`)}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-xs text-gray-400">{db}</p>
            <h1 className="text-xl font-semibold text-gray-900 leading-tight">{table}</h1>
          </div>
        </div>
        <Link
          to={`/query`}
          className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          SQL ile ekle
        </Link>
      </div>

      {/* Tablo */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Yükleniyor...</p>
      ) : (
        <div className="flex-1 overflow-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="text-left px-4 py-2.5 font-medium text-gray-600 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
                <th className="px-4 py-2.5 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result?.rows.map((row, i) => (
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
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setConfirmId(String(row["id"] ?? i))}
                      className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result?.rows.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">Tablo boş</p>
          )}
        </div>
      )}

      {/* Sayfalama */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total} satır
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId}
        title="Satırı sil"
        description={`ID: ${confirmId} — Bu işlem geri alınamaz.`}
        confirmLabel="Sil"
        onConfirm={handleDelete}
        onCancel={() => setConfirmId(null)}
        danger
      />
    </div>
  );
}