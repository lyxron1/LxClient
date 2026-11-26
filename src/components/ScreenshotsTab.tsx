import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Image as ImageIcon,
  FolderOpen,
  RefreshCw,
  X,
  Copy,
  Check,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Maximize2,
} from 'lucide-react';
import { ActionResult, ScreenshotItem } from '../types';

interface ScreenshotsTabProps {
  onOpenFolder: (folderType: string) => void;
}

type SortOrder = 'newest' | 'oldest';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface ScreenshotCardProps {
  item: ScreenshotItem;
  index: number;
  onOpen: (index: number) => void;
  onThumbLoaded: (path: string, dataUri: string) => void;
  onQuickCopy: (path: string) => void;
  onQuickShow: (path: string) => void;
}

const ScreenshotCard = memo<ScreenshotCardProps>(
  ({ item, index, onOpen, onThumbLoaded, onQuickCopy, onQuickShow }) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [loadingThumb, setLoadingThumb] = useState(false);
    const requestedRef = useRef(false);

    useEffect(() => {
      if (item.thumbnail || requestedRef.current) return;
      const el = cardRef.current;
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !requestedRef.current) {
            requestedRef.current = true;
            setLoadingThumb(true);
            invoke<string | null>('get_screenshot_thumbnail', { filePath: item.path })
              .then((uri) => {
                if (uri) onThumbLoaded(item.path, uri);
              })
              .catch(() => {})
              .finally(() => setLoadingThumb(false));
            observer.disconnect();
          }
        },
        { rootMargin: '250px' }
      );

      observer.observe(el);
      return () => observer.disconnect();
    }, [item.path, item.thumbnail, onThumbLoaded]);

    const aspect =
      item.width > 0 && item.height > 0 ? `${item.width} / ${item.height}` : '16 / 9';

    return (
      <div
        ref={cardRef}
        onClick={() => onOpen(index)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(index);
          }
        }}
        className="group rounded-2xl overflow-hidden lx-card lx-card-interactive text-left cursor-pointer flex flex-col focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        <div
          style={{ aspectRatio: aspect }}
          className="relative w-full bg-black/50 overflow-hidden"
        >
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt={item.name}
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300 ease-out lx-fade-in"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 lx-skeleton">
              <ImageIcon className={`w-7 h-7 ${loadingThumb ? 'animate-pulse' : ''}`} />
            </div>
          )}

          {/* Hover Overlay Actions */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-between p-2.5">
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-black/60 text-zinc-200 border border-white/10">
              {item.width}×{item.height}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="Panoya Kopyala"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickCopy(item.path);
                }}
                className="w-7 h-7 rounded-lg bg-black/65 hover:bg-black/90 text-zinc-200 hover:text-white border border-white/15 flex items-center justify-center cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Klasörde Göster"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickShow(item.path);
                }}
                className="w-7 h-7 rounded-lg bg-black/65 hover:bg-black/90 text-zinc-200 hover:text-white border border-white/15 flex items-center justify-center cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <span className="w-7 h-7 rounded-lg lx-btn-primary flex items-center justify-center">
                <Maximize2 className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        </div>

        <div className="p-3">
          <div className="text-xs font-medium text-zinc-200 truncate">{item.name}</div>
          <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-0.5">
            <span>{item.dateStr}</span>
            <span>{formatBytes(item.size)}</span>
          </div>
        </div>
      </div>
    );
  }
);

ScreenshotCard.displayName = 'ScreenshotCard';

export const ScreenshotsTab: React.FC<ScreenshotsTabProps> = ({ onOpenFolder }) => {
  const [items, setItems] = useState<ScreenshotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [visibleCount, setVisibleCount] = useState(36);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [fullImageSrc, setFullImageSrc] = useState<string>('');
  const [loadingFull, setLoadingFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadScreenshots = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke<ScreenshotItem[]>('get_screenshots');
      setItems(res);
      setVisibleCount(36);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScreenshots();
  }, [loadScreenshots]);

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => (sortOrder === 'newest' ? b.mtime - a.mtime : a.mtime - b.mtime));
    return copy;
  }, [items, sortOrder]);

  const visibleItems = useMemo(
    () => sortedItems.slice(0, visibleCount),
    [sortedItems, visibleCount]
  );

  // Progressive load-more sentinel for huge galleries (500+ images)
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= sortedItems.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(sortedItems.length, c + 24));
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, sortedItems.length]);

  const handleThumbLoaded = useCallback((path: string, dataUri: string) => {
    setItems((prev) =>
      prev.map((it) => (it.path === path ? { ...it, thumbnail: dataUri } : it))
    );
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const activeItem = activeIndex !== null ? sortedItems[activeIndex] ?? null : null;

  const openLightbox = useCallback(
    async (index: number) => {
      const target = sortedItems[index];
      if (!target) return;
      setActiveIndex(index);
      setFullImageSrc(target.thumbnail || '');
      setLoadingFull(true);
      setCopied(false);
      try {
        const full = await invoke<string | null>('get_screenshot_full', {
          filePath: target.path,
        });
        if (full) setFullImageSrc(full);
      } catch {
        // fallback to thumbnail
      } finally {
        setLoadingFull(false);
      }
    },
    [sortedItems]
  );

  const goPrev = useCallback(() => {
    if (activeIndex === null || sortedItems.length === 0) return;
    const nextIdx = (activeIndex - 1 + sortedItems.length) % sortedItems.length;
    openLightbox(nextIdx);
  }, [activeIndex, sortedItems.length, openLightbox]);

  const goNext = useCallback(() => {
    if (activeIndex === null || sortedItems.length === 0) return;
    const nextIdx = (activeIndex + 1) % sortedItems.length;
    openLightbox(nextIdx);
  }, [activeIndex, sortedItems.length, openLightbox]);

  useEffect(() => {
    if (activeIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveIndex(null);
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeIndex, goPrev, goNext]);

  const handleCopy = useCallback(
    async (filePath: string) => {
      const res = await invoke<ActionResult>('copy_screenshot_to_clipboard', { filePath });
      if (res.success) {
        setCopied(true);
        showToast('Panoya kopyalandı');
        setTimeout(() => setCopied(false), 2000);
      } else {
        showToast('Kopyalanamadı');
      }
    },
    [showToast]
  );

  const handleShowInFolder = useCallback(async (filePath: string) => {
    await invoke<ActionResult>('show_item_in_folder', { filePath });
  }, []);

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white">Ekran Görüntüleri</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full lx-accent-badge">
              {items.length} Görsel
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Oyun içi ekran görüntüleriniz disk önbelleğiyle anında yüklenir
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSortOrder((s) => (s === 'newest' ? 'oldest' : 'newest'))}
            className="px-3 py-2 rounded-xl lx-card hover:bg-white/[0.06] text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5 lx-accent-text" />
            <span>{sortOrder === 'newest' ? 'En Yeni' : 'En Eski'}</span>
          </button>

          <button
            onClick={loadScreenshots}
            className="px-3 py-2 rounded-xl lx-card hover:bg-white/[0.06] text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Yenile</span>
          </button>

          <button
            onClick={() => onOpenFolder('screenshots')}
            className="px-3.5 py-2 rounded-xl lx-btn-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Klasörü Aç</span>
          </button>
        </div>
      </div>

      {/* Gallery Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
          Ekran görüntüleri hazırlanıyor...
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 rounded-2xl lx-card">
          <ImageIcon className="w-12 h-12 text-zinc-600 mb-3" />
          <p className="text-sm font-medium text-zinc-300">Henüz ekran görüntüsü yok</p>
          <p className="text-xs text-zinc-500 mt-1">
            Oyun içinde F2 tuşuna basarak aldığınız ekran görüntüleri burada listelenir.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-1 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
            {visibleItems.map((item, idx) => (
              <ScreenshotCard
                key={item.path}
                item={item}
                index={idx}
                onOpen={openLightbox}
                onThumbLoaded={handleThumbLoaded}
                onQuickCopy={handleCopy}
                onQuickShow={handleShowInFolder}
              />
            ))}
          </div>
          {visibleCount < sortedItems.length && (
            <div ref={sentinelRef} className="h-12 flex items-center justify-center text-xs text-zinc-500 mt-2">
              Daha fazla görsel yükleniyor...
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 px-3.5 py-2 rounded-xl lx-accent-badge text-xs font-semibold shadow-xl backdrop-blur-md lx-toast-enter">
          {toast}
        </div>
      )}

      {/* Lightbox Modal */}
      {activeItem && activeIndex !== null && (
        <div
          onClick={() => setActiveIndex(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-5 lx-modal-backdrop"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            className="max-w-6xl w-full max-h-full flex flex-col rounded-2xl border overflow-hidden shadow-2xl lx-modal-panel"
          >
            {/* Lightbox Header */}
            <div className="px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-semibold text-white truncate">
                    {activeItem.name}
                  </span>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-md lx-accent-badge">
                    {activeItem.width} × {activeItem.height}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {activeIndex + 1} / {sortedItems.length}
                  </span>
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {activeItem.dateStr} • {formatBytes(activeItem.size)}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleCopy(activeItem.path)}
                  className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Kopyalandı</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Panoya Kopyala</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleShowInFolder(activeItem.path)}
                  className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Klasörde Göster</span>
                </button>
                <button
                  onClick={() => setActiveIndex(null)}
                  title="Kapat (ESC)"
                  className="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-rose-500/80 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Lightbox Viewer + Prev/Next */}
            <div className="relative p-4 bg-black/60 flex items-center justify-center overflow-hidden min-h-[300px] max-h-[78vh]">
              {sortedItems.length > 1 && (
                <button
                  onClick={goPrev}
                  title="Önceki (Sol Ok)"
                  className="absolute left-4 z-10 w-10 h-10 rounded-full bg-black/70 hover:bg-black/90 border border-white/15 text-white flex items-center justify-center transition-all cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}

              <img
                key={activeItem.path}
                src={fullImageSrc}
                alt={activeItem.name}
                className={`max-w-full max-h-[72vh] rounded-xl object-contain transition-opacity duration-200 lx-fade-in ${
                  loadingFull ? 'opacity-80' : 'opacity-100'
                }`}
              />

              {sortedItems.length > 1 && (
                <button
                  onClick={goNext}
                  title="Sonraki (Sağ Ok)"
                  className="absolute right-4 z-10 w-10 h-10 rounded-full bg-black/70 hover:bg-black/90 border border-white/15 text-white flex items-center justify-center transition-all cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
