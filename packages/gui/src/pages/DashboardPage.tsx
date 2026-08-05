/**
 * Dashboard — istatistik kartları ve hızlı erişim linkleri.
 */

import { Link } from "react-router-dom";
import { Database, Layers, Activity, Plus } from "lucide-react";
import { useDatabases, useAdminStats } from "../hooks/useDatabases.js";
import type { Database as DbInfo } from "../types/index.js";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className={`inline-flex p-2.5 rounded-xl ${color} mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { data: databases, isLoading } = useDatabases();
  const { data: stats } = useAdminStats();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <Link
          to="/databases"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Veritabanı
        </Link>
      </div>

      {/* İstatistik kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Database}
          label="Veritabanı"
          value={databases?.length ?? "—"}
          color="bg-blue-50 text-blue-600"
        />
        <StatCard
          icon={Activity}
          label="Aktif Bağlantı"
          value={stats?.activePools ?? "—"}
          color="bg-green-50 text-green-600"
        />
        <StatCard
          icon={Layers}
          label="Toplam Boyut"
          value={stats?.totalSizeBytes ? formatBytes(stats.totalSizeBytes) : "—"}
          color="bg-purple-50 text-purple-600"
        />
      </div>

      {/* DB listesi */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-3">Veritabanları</h2>
        {isLoading ? (
          <p className="text-sm text-gray-400">Yükleniyor...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {databases?.map((db: DbInfo) => (
              <Link
                key={db.name}
                to={`/databases/${db.name}`}
                className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <Database className="w-5 h-5 text-blue-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{db.name}</p>
                  <p className="text-xs text-gray-400">
                    {db.table_count} tablo · {formatBytes(db.size_bytes)}
                  </p>
                </div>
              </Link>
            ))}
            {databases?.length === 0 && (
              <Link
                to="/databases"
                className="flex items-center gap-2 p-4 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
              >
                <Plus className="w-4 h-4" />
                İlk veritabanını oluştur
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}