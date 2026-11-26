import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  Package,
  Search,
  RefreshCw,
  Upload,
  FolderOpen,
  ExternalLink,
  Trash2,
  X,
  Check,
  AlertCircle,
  FileUp,
  Loader2,
} from 'lucide-react';
import { ActionResult, ModItem } from '../types';

interface ModsTabProps {
  onOpenFolder: (folderType: string) => void;
}

type StatusFilter = 'all' | 'enabled' | 'disabled';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getLoaderBadge(loader?: string | null) {
  switch (loader) {
    case 'fabric':
      return { label: 'Fabric', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
    case 'forge':
      return { label: 'Forge', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' };
    case 'neoforge':
      return { label: 'NeoForge', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' };
    case 'quilt':
      return { label: 'Quilt', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' };
    default:
      return null;
  }
}

export const ModsTab: React.FC<ModsTabProps> = ({ onOpenFolder }) => {
  const [mods, setMods] = useState<ModItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModItem | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [installingProgress, setInstallingProgress] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);

  const showToast = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadMods = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<ModItem[]>('get_mods');
      setMods(list);
    } catch (err) {
      showToast(`Modlar yüklenemedi: ${String(err)}`, true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadMods();
  }, [loadMods]);

  // Tauri native drag-and-drop for .jar mod files
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setIsDraggingOver(true);
        } else if (event.payload.type === 'leave') {
          setIsDraggingOver(false);
        } else if (event.payload.type === 'drop') {
          setIsDraggingOver(false);
          const jarPaths = event.payload.paths.filter((p) =>
            p.toLowerCase().endsWith('.jar')
          );
          if (jarPaths.length === 0) {
            showToast('Yalnızca .jar uzantılı mod dosyaları yüklenebilir.', true);
            return;
          }
          setInstallingProgress(35);
          try {
            const res = await invoke<ActionResult>('install_mods_from_paths', {
              paths: jarPaths,
            });
            setInstallingProgress(100);
            if (res.success) {
              showToast(res.message || 'Modlar yüklendi');
              await loadMods();
            } else {
              showToast(res.error || 'Modlar yüklenemedi', true);
            }
          } catch (err) {
            showToast(`Yükleme hatası: ${String(err)}`, true);
          } finally {
            setTimeout(() => setInstallingProgress(null), 350);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadMods, showToast]);

  useEffect(() => {
    if (!deleteTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDeleteTarget(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget]);

  const counts = useMemo(() => {
    const enabled = mods.filter((m) => m.enabled).length;
    return {
      total: mods.length,
      enabled,
      disabled: mods.length - enabled,
    };
  }, [mods]);

  const filteredMods = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mods.filter((m) => {
      if (statusFilter === 'enabled' && !m.enabled) return false;
      if (statusFilter === 'disabled' && m.enabled) return false;
      if (q) {
        const hay = `${m.name} ${m.fileName} ${m.id} ${m.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [mods, query, statusFilter]);

  const handleToggle = async (mod: ModItem) => {
    if (busyFile) return;
    setBusyFile(mod.fileName);
    try {
      const targetEnable = !mod.enabled;
      const res = await invoke<ActionResult>('toggle_mod', {
        fileName: mod.fileName,
        enable: targetEnable,
      });
      if (res.success) {
        setMods((prev) =>
          prev.map((m) =>
            m.fileName === mod.fileName && m.enabled === mod.enabled
              ? { ...m, enabled: targetEnable, path: res.message || m.path }
              : m
          )
        );
        showToast(
          targetEnable
            ? `${mod.name} etkinleştirildi`
            : `${mod.name} devre dışı bırakıldı`
        );
      } else {
        showToast(res.error || 'Mod durumu değiştirilemedi', true);
      }
    } catch (err) {
      showToast(`Hata: ${String(err)}`, true);
    } finally {
      setBusyFile(null);
    }
  };

  const handleInstallMods = async () => {
    setInstallingProgress(25);
    try {
      const res = await invoke<ActionResult>('select_and_install_mods');
      if (res.success) {
        setInstallingProgress(100);
        showToast(res.message || 'Modlar yüklendi');
        await loadMods();
      } else if (res.error) {
        showToast(res.error, true);
      }
    } catch (err) {
      showToast(`Yükleme hatası: ${String(err)}`, true);
    } finally {
      setTimeout(() => setInstallingProgress(null), 350);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const mod = deleteTarget;
    setDeleteTarget(null);
    setBusyFile(mod.fileName);
    try {
      const res = await invoke<ActionResult>('delete_mod', {
        fileName: mod.fileName,
        enabled: mod.enabled,
      });
      if (res.success) {
        setMods((prev) => prev.filter((m) => m.path !== mod.path));
        showToast(`${mod.name} silindi`);
      } else {
        showToast(res.error || 'Mod silinemedi', true);
      }
    } catch (err) {
      showToast(`Silme hatası: ${String(err)}`, true);
    } finally {
      setBusyFile(null);
    }
  };

  const handleShowInFolder = async (filePath: string) => {
    await invoke<ActionResult>('show_item_in_folder', { filePath });
  };

  return (
    <div className="relative flex flex-col h-full space-y-4">
      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div
          style={{ borderColor: 'var(--accent)' }}
          className="absolute inset-0 z-40 rounded-2xl border-2 border-dashed bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 lx-fade-in pointer-events-none"
        >
          <div className="w-16 h-16 rounded-2xl lx-accent-badge flex items-center justify-center scale-110 transition-transform">
            <FileUp className="w-8 h-8" />
          </div>
          <p className="text-base font-bold text-white">Mod Dosyalarını Buraya Bırakın</p>
          <p className="text-xs text-zinc-400">Seçili .jar dosyaları mods klasörüne eklenecek</p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Package className="w-5 h-5 lx-accent-text" />
              <span>Modlar</span>
            </h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full lx-accent-badge">
              {counts.total} Toplam
            </span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
              {counts.enabled} Aktif
            </span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-zinc-500/15 text-zinc-400 border border-white/10">
              {counts.disabled} Devre Dışı
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Devre dışı bırakılan modlar disabled-mods klasörüne taşınır • .jar dosyalarını sürükleyip bırakabilirsiniz
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadMods}
            className="px-3 py-2 rounded-xl lx-card lx-btn-subtle hover:bg-white/[0.06] text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Yenile</span>
          </button>
          <button
            onClick={() => onOpenFolder('mods')}
            className="px-3 py-2 rounded-xl lx-card lx-btn-subtle hover:bg-white/[0.06] text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 lx-accent-text" />
            <span>Klasörü Aç</span>
          </button>
          <button
            onClick={handleInstallMods}
            className="px-3.5 py-2 rounded-xl lx-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Mod Yükle</span>
          </button>
        </div>
      </div>

      {/* Upload Progress Bar */}
      {installingProgress !== null && (
        <div className="rounded-xl lx-card p-3 space-y-1.5 lx-fade-in">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin lx-accent-text" />
              <span>Mod dosyaları yükleniyor...</span>
            </span>
            <span className="font-semibold lx-accent-text">%{installingProgress}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
            <div
              className="h-full rounded-full lx-progress-fill"
              style={{ width: `${installingProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Search & Status Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Mod adı, dosya adı veya açıklama ara..."
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

        <div className="flex items-center gap-1.5">
          {(
            [
              { id: 'all', label: 'Tümü' },
              { id: 'enabled', label: 'Aktif' },
              { id: 'disabled', label: 'Devre Dışı' },
            ] as { id: StatusFilter; label: string }[]
          ).map((pill) => (
            <button
              key={pill.id}
              onClick={() => setStatusFilter(pill.id)}
              className={`px-3 py-2 rounded-xl text-xs font-medium lx-btn-subtle cursor-pointer ${
                statusFilter === pill.id
                  ? 'lx-accent-badge'
                  : 'lx-card text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mod List */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin lx-accent-text" />
          <span>Modlar taranıyor...</span>
        </div>
      ) : filteredMods.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 rounded-2xl lx-card lx-fade-in">
          <Package className="w-12 h-12 text-zinc-600 mb-3" />
          <p className="text-sm font-medium text-zinc-300">
            {mods.length === 0 ? 'Henüz yüklü mod yok' : 'Eşleşen mod bulunamadı'}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {mods.length === 0
              ? 'Sağ üstteki "Mod Yükle" butonunu kullanabilir veya .jar dosyalarını buraya sürükleyebilirsiniz.'
              : 'Arama veya durum filtresini değiştirmeyi deneyin.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
          {filteredMods.map((mod, idx) => {
            const loaderBadge = getLoaderBadge(mod.loader);
            const isBusy = busyFile === mod.fileName;

            return (
              <div
                key={mod.path}
                style={
                  idx < 10
                    ? {
                        animation: `lxCardEnter 220ms cubic-bezier(0.22, 1, 0.36, 1) ${idx * 28}ms both`,
                      }
                    : undefined
                }
                className={`p-4 rounded-2xl lx-card lx-card-interactive flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  !mod.enabled ? 'opacity-70' : ''
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-colors duration-200 ${
                      mod.enabled
                        ? 'lx-accent-badge'
                        : 'bg-white/[0.04] text-zinc-500 border border-white/[0.08]'
                    }`}
                  >
                    <Package className="w-5 h-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white truncate">
                        {mod.name}
                      </span>
                      {mod.version && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 border border-white/[0.08]">
                          v{mod.version}
                        </span>
                      )}
                      {loaderBadge && (
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${loaderBadge.cls}`}
                        >
                          {loaderBadge.label}
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors duration-200 ${
                          mod.enabled
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-zinc-600/20 text-zinc-400'
                        }`}
                      >
                        {mod.enabled ? 'Aktif' : 'Devre Dışı'}
                      </span>
                    </div>

                    <div className="text-xs text-zinc-400 mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-zinc-400 truncate max-w-md">
                        {mod.fileName}
                      </span>
                      <span className="text-zinc-600">•</span>
                      <span className="text-zinc-500">{formatBytes(mod.size)}</span>
                    </div>

                    {mod.description && (
                      <p className="text-xs text-zinc-500 mt-1 line-clamp-1">
                        {mod.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions: Open Location, Delete, Enable/Disable Switch */}
                <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleShowInFolder(mod.path)}
                    title="Dosya Konumunu Aç"
                    className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.07] text-zinc-300 hover:text-white flex items-center justify-center lx-btn-subtle cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setDeleteTarget(mod)}
                    title="Modu Sil"
                    className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-rose-500/15 border border-white/[0.07] hover:border-rose-500/30 text-zinc-300 hover:text-rose-300 flex items-center justify-center lx-btn-subtle cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={mod.enabled}
                    disabled={isBusy}
                    onClick={() => handleToggle(mod)}
                    title={mod.enabled ? 'Devre Dışı Bırak' : 'Etkinleştir'}
                    className={`w-12 h-6 rounded-full transition-colors duration-200 p-0.5 cursor-pointer disabled:opacity-50 ${
                      mod.enabled ? 'lx-progress-fill' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 ease-out ${
                        mod.enabled ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          onClick={() => setDeleteTarget(null)}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 lx-modal-backdrop"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            className="w-full max-w-md rounded-2xl border p-6 shadow-2xl space-y-4 lx-modal-panel"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">Modu Silmek İstiyor musunuz?</h3>
                <p className="text-xs text-zinc-400 mt-1 break-all">
                  <span className="font-semibold text-zinc-200">{deleteTarget.name}</span> (
                  {deleteTarget.fileName}) kalıcı olarak silinecektir.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl lx-card lx-btn-subtle hover:bg-white/[0.06] text-xs font-medium text-zinc-200 cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold flex items-center gap-1.5 lx-btn-subtle cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Evet, Sil</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xl backdrop-blur-md flex items-center gap-2 border lx-toast-enter ${
            toast.isError
              ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
              : 'lx-accent-badge'
          }`}
        >
          {toast.isError ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
};
