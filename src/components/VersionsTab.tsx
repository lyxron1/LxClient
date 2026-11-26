import React, { useState, useMemo } from 'react';
import { Search, Check, Download, Play, X, Layers } from 'lucide-react';
import { InstalledVersion, MojangVersion } from '../types';

interface VersionsTabProps {
  installedVersions: InstalledVersion[];
  mojangVersions: MojangVersion[];
  selectedVersion: string;
  onSelectVersion: (ver: string) => void;
  onLaunchVersion: (ver: string) => void;
  launchState: 'idle' | 'preparing' | 'running';
}

type FilterType = 'all' | 'installed' | 'fabric' | 'forge' | 'vanilla';

export const VersionsTab: React.FC<VersionsTabProps> = ({
  installedVersions,
  mojangVersions,
  selectedVersion,
  onSelectVersion,
  onLaunchVersion,
  launchState,
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [includeSnapshots, setIncludeSnapshots] = useState(false);

  const items = useMemo(() => {
    const installedMap = new Map(installedVersions.map((v) => [v.id, v]));
    const combined: {
      id: string;
      kind: string;
      isInstalled: boolean;
      inheritsFrom?: string | null;
    }[] = installedVersions.map((v) => ({
      id: v.id,
      kind: v.kind,
      isInstalled: true,
      inheritsFrom: v.inheritsFrom,
    }));

    for (const m of mojangVersions) {
      if (!includeSnapshots && m.type !== 'release') continue;
      if (!installedMap.has(m.id)) {
        combined.push({
          id: m.id,
          kind: 'vanilla',
          isInstalled: false,
        });
      }
    }

    const q = query.trim().toLowerCase();
    return combined.filter((item) => {
      if (q && !item.id.toLowerCase().includes(q)) return false;
      if (filter === 'installed') return item.isInstalled;
      if (filter === 'fabric') return item.kind === 'fabric' || item.kind === 'quilt';
      if (filter === 'forge') return item.kind === 'forge' || item.kind === 'neoforge';
      if (filter === 'vanilla') return item.kind === 'vanilla';
      return true;
    });
  }, [installedVersions, mojangVersions, query, filter, includeSnapshots]);

  const filterPills: { id: FilterType; label: string }[] = [
    { id: 'all', label: 'Tümü' },
    { id: 'installed', label: 'Yüklü' },
    { id: 'fabric', label: 'Fabric' },
    { id: 'forge', label: 'Forge / NeoForge' },
    { id: 'vanilla', label: 'Vanilla' },
  ];

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white">Sürümler</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full lx-accent-badge">
              {items.length} Sürüm
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Mojang resmi sürümleri ve yerel Fabric / Forge profilleri
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none px-3 py-2 rounded-xl lx-card">
          <input
            type="checkbox"
            checked={includeSnapshots}
            onChange={(e) => setIncludeSnapshots(e.target.checked)}
            className="rounded border-white/20 bg-zinc-900 accent-[var(--accent)]"
          />
          <span>Snapshotları Göster</span>
        </label>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sürüm ara (ör. 1.20.4, fabric, forge)..."
            className="w-full h-10 pl-10 pr-9 rounded-xl lx-input text-sm text-zinc-100 placeholder-zinc-500"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Aramayı temizle"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {filterPills.map((pill) => (
            <button
              key={pill.id}
              onClick={() => setFilter(pill.id)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                filter === pill.id
                  ? 'lx-accent-badge'
                  : 'lx-card text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Version List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 pb-2">
        {items.length === 0 ? (
          <div className="py-16 rounded-2xl lx-card flex flex-col items-center justify-center text-center">
            <Layers className="w-10 h-10 text-zinc-600 mb-2" />
            <p className="text-sm font-medium text-zinc-300">Sürüm bulunamadı</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Arama veya filtre kriterlerinizi değiştirmeyi deneyin.
            </p>
          </div>
        ) : (
          items.map((item) => {
            const isSelected = item.id === selectedVersion;
            return (
              <div
                key={item.id}
                onClick={() => onSelectVersion(item.id)}
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-4 transition-all cursor-pointer ${
                  isSelected
                    ? 'lx-accent-badge'
                    : 'lx-card lx-card-interactive'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      item.isInstalled
                        ? 'lx-accent-badge'
                        : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    }`}
                  >
                    {item.isInstalled ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100 truncate">
                        {item.id}
                      </span>
                      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 border border-white/[0.08]">
                        {item.kind}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {item.isInstalled
                        ? item.inheritsFrom
                          ? `Yerel Profil (Temel: ${item.inheritsFrom})`
                          : 'Yerel Cihazda Yüklü'
                        : 'Mojang Resmi Sürümü • Başlatıldığında indirilir'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isSelected && (
                    <span className="text-[11px] font-semibold lx-accent-text px-2.5 py-1 rounded-lg bg-black/25">
                      Seçili
                    </span>
                  )}
                  <button
                    disabled={launchState !== 'idle'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectVersion(item.id);
                      onLaunchVersion(item.id);
                    }}
                    className="px-3.5 py-2 rounded-xl lx-btn-primary text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Oyna</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
