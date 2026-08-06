/**
 * DashboardPage — stat tiles, DB listesi, quick actions.
 */

import { Link, useNavigate } from "react-router-dom";
import { Database, Table2, HardDrive, Terminal, Plus, Activity, Cpu } from "lucide-react";
import { useDatabases, useAdminStats } from "@/hooks/useDatabases";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col gap-3 rounded border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground/50" />
      </div>
      <div>
        <span className="font-mono text-2xl font-semibold tracking-tight text-foreground">
          {value}
        </span>
        {sub && (
          <span className="ml-1.5 text-xs text-muted-foreground">{sub}</span>
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
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      {/* Başlık + Quick actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Dashboard</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Postgrify Gateway — genel bakış
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/query")}
            className="gap-1.5"
          >
            <Terminal className="h-3.5 w-3.5" />
            SQL Editörü
          </Button>
          <Button size="sm" onClick={() => navigate("/databases")} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Yeni DB
          </Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statsLoading || dbLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))
        ) : (
          <>
            <StatTile
              label="Veritabanı"
              value={databases?.length ?? 0}
              icon={Database}
            />
            <StatTile
              label="Toplam Tablo"
              value={totalTables}
              icon={Table2}
            />
            <StatTile
              label="Toplam Boyut"
              value={formatBytes(totalSize)}
              icon={HardDrive}
            />
            <StatTile
              label="Aktif Pool"
              value={stats?.activePools ?? 0}
              icon={Activity}
              sub={`/ ${databases?.length ?? 0} toplam`}
            />
          </>
        )}
      </div>

      {/* DB listesi */}
      <div className="rounded border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-xs font-medium text-foreground">Veritabanları</span>
          <Link
            to="/databases"
            className="text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Tümünü gör →
          </Link>
        </div>

        {dbLoading ? (
          <div className="space-y-px p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {databases?.map((db) => (
              <Link
                key={db.name}
                to={`/databases/${db.name}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/20"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background">
                  <Database className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="flex flex-1 items-center gap-2">
                  <span className="font-mono text-sm text-foreground">{db.name}</span>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${db.pool_active ? "bg-green-500" : "bg-zinc-600"}`}
                    title={db.pool_active ? "Pool aktif" : "Pool kapalı"}
                  />
                  <span
                    className={`rounded px-1.5 py-0.5 text-2xs font-medium ${
                      db.pool_active
                        ? "bg-green-500/10 text-green-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {db.pool_active ? "active" : "offline"}
                  </span>
                </div>
                <div className="flex items-center gap-6 text-2xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Table2 className="h-3 w-3" />
                    {Number(db.table_count)} tablo
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatBytes(db.size_bytes ?? 0)}
                  </span>
                </div>
                <span className="text-2xs text-muted-foreground/50">→</span>
              </Link>
            ))}
            {databases?.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Database className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">Henüz veritabanı yok</p>
                <Button size="sm" onClick={() => navigate("/databases")} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Veritabanı Ekle
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats alt bilgi */}
      {stats && (
        <div className="flex items-center gap-4 text-2xs text-muted-foreground/50">
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            Node {stats.nodeVersion}
          </span>
          <span>
            Uptime: {Math.floor(stats.uptime / 3600)}sa {Math.floor((stats.uptime % 3600) / 60)}dk
          </span>
          {stats.activePoolNames.length > 0 && (
            <span>
              Aktif: {stats.activePoolNames.join(", ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}