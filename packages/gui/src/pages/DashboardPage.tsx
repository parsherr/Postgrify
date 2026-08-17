/**
 * DashboardPage — stat tiles, database list, quick actions.
 * Design: fully black background, solid zinc colors, large fonts, no opacity.
 */

import { Link, useNavigate } from "react-router-dom";
import { Database, Table2, HardDrive, Code2, Plus, Cpu } from "lucide-react";
import { useDatabases, useAdminStats } from "@/hooks/useDatabases";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/utils";

function StatTile({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-400">{label}</span>
        <Icon className="h-4 w-4 text-zinc-700" />
      </div>
      <div>
        <span className="font-mono text-3xl font-medium tracking-[-0.04em] text-white">
          {value}
        </span>
        {sub && (
          <span className="ml-1.5 text-sm text-zinc-400">{sub}</span>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: databases, isLoading: dbLoading } = useDatabases();
  const { data: stats, isLoading: statsLoading } = useAdminStats();

  const totalSize = databases?.reduce((sum, db) => sum + Number(db.size_bytes ?? 0), 0) ?? 0;
  const totalTables = databases?.reduce((sum, db) => sum + Number(db.table_count ?? 0), 0) ?? 0;

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto p-8">

      {/* Header + Quick actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-[-0.03em] text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Postgrify Gateway — overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/query")}
            className="flex items-center gap-2 rounded-[10px] border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            <Code2 className="h-3.5 w-3.5" />
            SQL Editor
          </button>
          <button
            onClick={() => navigate("/databases")}
            className="flex items-center gap-2 rounded-[10px] border border-zinc-600 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-100"
          >
            <Plus className="h-3.5 w-3.5" />
            New DB
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statsLoading || dbLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded border border-zinc-800 bg-zinc-900" />
          ))
        ) : (
          <>
            <StatTile label="Databases" value={databases?.length ?? 0} icon={Database} />
            <StatTile label="Total Tables" value={totalTables} icon={Table2} />
            <StatTile label="Total Size" value={formatBytes(totalSize)} icon={HardDrive} />
            <StatTile
              label="Average Size"
              value={databases?.length ? formatBytes(totalSize / databases.length) : "—"}
              icon={Cpu}
            />
          </>
        )}
      </div>

      {/* Database list */}
      <div className="rounded border border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <span className="text-sm font-medium text-white">Databases</span>
          <Link
            to="/databases"
            className="text-xs text-zinc-500 transition-colors hover:text-white"
          >
            View all →
          </Link>
        </div>

        {dbLoading ? (
          <div className="space-y-px p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded bg-zinc-900" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {databases?.map((db) => (
              <Link
                key={db.name}
                to={`/databases/${db.name}`}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-zinc-900"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-zinc-950">
                  <Database className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="flex flex-1 items-center gap-2">
                  <span className="font-mono text-base text-white">{db.name}</span>
                </div>
                <div className="flex items-center gap-6 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <Table2 className="h-3 w-3" />
                    {Number(db.table_count)} tables
                  </span>
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="h-3 w-3" />
                    {formatBytes(db.size_bytes ?? 0)}
                  </span>
                </div>
                <span className="text-xs text-zinc-700">→</span>
              </Link>
            ))}
            {databases?.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <Database className="h-8 w-8 text-zinc-700" />
                <p className="text-sm text-zinc-500">No databases yet</p>
                <button
                  onClick={() => navigate("/databases")}
                  className="flex items-center gap-2 rounded-[10px] border border-zinc-600 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Database
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer info */}
      {stats && (
        <div className="flex items-center gap-4 text-xs text-zinc-600">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3 w-3" />
            Node {stats.nodeVersion}
          </span>
          <span>
            Uptime: {Math.floor(stats.uptime / 3600)}h {Math.floor((stats.uptime % 3600) / 60)}m
          </span>
        </div>
      )}

    </div>
  );
}