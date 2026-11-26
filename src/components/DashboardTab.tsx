import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  Play,
  Loader2,
  Gamepad2,
  ChevronDown,
  FolderOpen,
  Package,
  Sparkles,
  Check,
  Zap,
  Terminal,
  SlidersHorizontal,
  Bell,
  Info,
  CheckCircle2,
  Cpu,
  HardDrive,
  Monitor,
  Coffee,
  Calendar,
  Megaphone,
  Box,
} from 'lucide-react';
import {
  InstalledVersion,
  JavaInfo,
  LauncherSettings,
  MojangVersion,
  RuntimeStats,
  TabId,
} from '../types';

interface DashboardTabProps {
  username: string;
  selectedVersion: string;
  onSelectVersion: (ver: string) => void;
  installedVersions: InstalledVersion[];
  mojangVersions: MojangVersion[];
  settings: LauncherSettings;
  systemJava: JavaInfo | null;
  launchState: 'idle' | 'preparing' | 'running';
  progressPercent: number;
  progressMessage: string;
  onLaunch: (overrideVersion?: string) => void;
  onOpenFolder: (folderType: string) => void;
  onNavigate: (tab: TabId) => void;
}

const ANNOUNCEMENTS = [
  {
    title: 'LxClient v2.0 Yayında!',
    desc: 'Rust + Tauri v2 altyapısı ile daha hızlı başlatma, akıcı galeri ve tema desteği.',
    date: '26 Kasım 2026',
  },
  {
    title: 'Forge & Fabric Tam Desteği',
    desc: 'Modern Forge 1.17+ ve eski 1.12.2 profilleri için otomatik Java seçimi aktif.',
    date: '26 Kasım 2026',
  },
  {
    title: 'Performans İpucu: Aikar’s Flags',
    desc: 'Ayarlar > Gelişmiş bölümünden G1GC performans bayraklarını etkinleştirebilirsiniz.',
    date: 'Sistem İpucu',
  },
];

function getKindBadge(kind: string) {
  switch (kind) {
    case 'fabric':
      return { label: 'Fabric', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
    case 'forge':
      return { label: 'Forge', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' };
    case 'neoforge':
      return { label: 'NeoForge', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' };
    case 'quilt':
      return { label: 'Quilt', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' };
    default:
      return { label: 'Vanilla', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  }
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  username,
  selectedVersion,
  onSelectVersion,
  installedVersions,
  mojangVersions,
  settings,
  systemJava,
  launchState,
  progressPercent,
  progressMessage,
  onLaunch,
  onOpenFolder,
  onNavigate,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [stats, setStats] = useState<RuntimeStats>({
    cpuUsage: 0,
    ramUsage: 0,
    usedRamMb: 0,
    totalRamMb: 8192,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const portalMenuRef = useRef<HTMLDivElement>(null);

  const updateDropdownPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const margin = 12;
    const top = rect.bottom + gap;
    const width = Math.min(rect.width, window.innerWidth - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const maxHeight = Math.min(300, Math.max(160, window.innerHeight - top - margin));
    setDropdownPos({ top, left, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;
    updateDropdownPosition();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        portalMenuRef.current?.contains(target)
      ) {
        return;
      }
      setDropdownOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleScrollOrResize = () => {
      updateDropdownPosition();
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [dropdownOpen, updateDropdownPosition]);

  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      try {
        const res = await invoke<RuntimeStats>('get_runtime_stats');
        if (active) setStats(res);
      } catch {
        // ignore
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const installedIds = new Set(installedVersions.map((v) => v.id));
  const selectedInstalled = installedVersions.find((v) => v.id === selectedVersion);
  const releaseIds = mojangVersions
    .filter((v) => v.type === 'release' && !installedIds.has(v.id))
    .slice(0, 20)
    .map((v) => v.id);

  const quickProfiles = installedVersions.slice(0, 4);
  const activeAnnouncement = ANNOUNCEMENTS[slideIdx];

  return (
    <div className="space-y-4 pb-4">
      {/* Hero Banner */}
      <section
        style={{
          backgroundColor: 'var(--bg-card)',
          backgroundImage: 'var(--hero-ambient)',
          borderColor: 'var(--border-subtle)',
        }}
        className="relative rounded-2xl border overflow-visible p-6 shadow-xl lx-stagger-1"
      >
        {/* Top Row: Badge + Quick Icon Actions */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full lx-accent-badge text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>LxClient Başlatıcı</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSlideIdx((i) => (i + 1) % ANNOUNCEMENTS.length)}
              title="Sonraki Duyuru"
              className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] flex items-center justify-center text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate('settings')}
              title="Ayarlar"
              className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] flex items-center justify-center text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate('console')}
              title="Canlı Konsol"
              className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] flex items-center justify-center text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Welcome Text */}
        <div className="mb-5">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
            Hoş Geldin,{' '}
            <span className="lx-accent-text">{username.trim() || 'Oyuncu'}!</span>
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Vanilla, Fabric ve Forge profillerini tek tıkla hazırla ve oyuna katıl.
          </p>
        </div>

        {/* Controls Row: Version Picker + Play Button + Quick Settings */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Version Selector Dropdown */}
          <div className="relative flex-1">
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              disabled={launchState !== 'idle'}
              onClick={() => setDropdownOpen((o) => !o)}
              className="w-full h-13 px-4 rounded-xl lx-input flex items-center justify-between gap-3 disabled:opacity-60 cursor-pointer hover:border-white/20"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg lx-accent-badge flex items-center justify-center shrink-0">
                  <Box className="w-4 h-4" />
                </div>
                <div className="text-left min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {selectedVersion || 'Sürüm Seçin'}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {installedIds.has(selectedVersion)
                      ? `${getKindBadge(selectedInstalled?.kind || 'vanilla').label} • Yüklü Profil`
                      : 'Mojang Resmi Sürüm • Otomatik İndirilir'}
                  </div>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform duration-150 ${
                  dropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {dropdownOpen &&
              dropdownPos &&
              createPortal(
                <div
                  ref={portalMenuRef}
                  role="listbox"
                  style={{
                    position: 'fixed',
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                    width: dropdownPos.width,
                    maxHeight: dropdownPos.maxHeight,
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-accent)',
                  }}
                  className="overflow-y-auto rounded-xl border shadow-[0_20px_50px_rgba(0,0,0,0.75)] p-1.5 z-[100] lx-dropdown-enter"
                >
                  {installedVersions.length > 0 && (
                    <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Yüklü Profiller
                    </div>
                  )}
                  {installedVersions.map((ver) => {
                    const badge = getKindBadge(ver.kind);
                    const active = ver.id === selectedVersion;
                    return (
                      <button
                        key={ver.id}
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onSelectVersion(ver.id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                          active
                            ? 'lx-accent-badge'
                            : 'text-zinc-200 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="truncate font-medium">{ver.id}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] px-2 py-0.5 rounded border ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {active && <Check className="w-3.5 h-3.5 lx-accent-text" />}
                        </div>
                      </button>
                    );
                  })}

                  {releaseIds.length > 0 && (
                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      İndirilebilir Sürümler
                    </div>
                  )}
                  {releaseIds.map((id) => {
                    const active = id === selectedVersion;
                    return (
                      <button
                        key={id}
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onSelectVersion(id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                          active ? 'lx-accent-badge' : 'text-zinc-300 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="truncate">Minecraft {id}</span>
                        {active && <Check className="w-3.5 h-3.5 lx-accent-text" />}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onNavigate('versions');
                    }}
                    className="w-full mt-1 py-2 text-center text-xs font-medium lx-accent-text hover:bg-white/[0.05] rounded-lg transition-colors cursor-pointer"
                  >
                    Tüm Sürümleri Gör →
                  </button>
                </div>,
                document.body
              )}
          </div>

          {/* Big PLAY Button + Quick Settings */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={launchState !== 'idle'}
              onClick={() => onLaunch()}
              className={`relative h-13 px-8 min-w-[200px] rounded-xl font-bold text-sm tracking-wide overflow-hidden flex items-center justify-center gap-2.5 cursor-pointer ${
                launchState === 'idle'
                  ? 'lx-btn-primary'
                  : launchState === 'running'
                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 cursor-default'
                  : 'lx-card border border-white/15 text-white cursor-wait'
              }`}
            >
              {launchState === 'preparing' && (
                <div
                  className="absolute inset-y-0 left-0 lx-progress-fill opacity-35 transition-all duration-300"
                  style={{ width: `${Math.max(8, progressPercent)}%` }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                {launchState === 'idle' && (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>OYNA</span>
                  </>
                )}
                {launchState === 'preparing' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin lx-accent-text" />
                    <span>HAZIRLANIYOR %{progressPercent}</span>
                  </>
                )}
                {launchState === 'running' && (
                  <>
                    <Gamepad2 className="w-4 h-4 text-emerald-400" />
                    <span>OYUN ÇALIŞIYOR</span>
                  </>
                )}
              </span>
            </button>

            <button
              onClick={() => onNavigate('settings')}
              title="Oyun Ayarları"
              className="h-13 w-13 rounded-xl lx-input hover:bg-white/[0.06] flex items-center justify-center text-zinc-300 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compact Progress Notification Bar */}
        {launchState !== 'idle' && (
          <div className="mt-4 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-black/40 border border-white/[0.08] text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-zinc-200 truncate">
                {progressMessage ||
                  (launchState === 'running'
                    ? 'Minecraft aktif olarak çalışıyor.'
                    : 'Dosyalar hazırlanıyor...')}
              </span>
            </div>
            <button
              onClick={() => onNavigate('console')}
              className="shrink-0 flex items-center gap-1.5 lx-accent-text font-medium cursor-pointer hover:underline"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Konsolu Aç</span>
            </button>
          </div>
        )}
      </section>

      {/* Middle Row: Quick Profiles + System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Quick Profiles (6 cols) */}
        <div className="lg:col-span-6 rounded-2xl lx-card p-5 flex flex-col justify-between lx-stagger-2">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Zap className="w-4 h-4 lx-accent-text" />
                <span>Hızlı Profiller</span>
              </h2>
              <button
                onClick={() => onNavigate('versions')}
                className="text-xs lx-accent-text hover:underline transition-colors cursor-pointer"
              >
                Tümünü Gör ({installedVersions.length}) →
              </button>
            </div>

            {quickProfiles.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500">
                Henüz yerel profil bulunamadı. Yukarıdan bir sürüm seçip başlatabilirsiniz.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {quickProfiles.map((prof) => {
                  const badge = getKindBadge(prof.kind);
                  const isSelected = prof.id === selectedVersion;
                  return (
                    <div
                      key={prof.id}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2.5 ${
                        isSelected
                          ? 'lx-accent-badge'
                          : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.06]'
                      }`}
                    >
                      <button
                        onClick={() => onSelectVersion(prof.id)}
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-black/30 border border-white/[0.06] flex items-center justify-center shrink-0">
                          <Box className="w-4 h-4 lx-accent-text" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-zinc-100 truncate">
                            {prof.id}
                          </div>
                          <span
                            className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.2 rounded border ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                      </button>

                      <button
                        disabled={launchState !== 'idle'}
                        onClick={() => {
                          onSelectVersion(prof.id);
                          onLaunch(prof.id);
                        }}
                        title="Seç ve Başlat"
                        className="w-8 h-8 rounded-lg lx-btn-primary flex items-center justify-center disabled:opacity-40 cursor-pointer shrink-0"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* System Status (6 cols) */}
        <div className="lg:col-span-6 rounded-2xl lx-card p-5 flex flex-col justify-between lx-stagger-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Monitor className="w-4 h-4 lx-accent-text" />
              <span>Sistem Durumu</span>
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[11px] font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Her şey yolunda</span>
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 flex items-center gap-2">
                <Coffee className="w-3.5 h-3.5 text-zinc-500" />
                <span>Java Sürümü</span>
              </span>
              <span className="text-zinc-100 font-semibold">
                {systemJava ? `Java ${systemJava.major}` : 'Otomatik (Temurin)'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-zinc-400 flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
                <span>RAM Tahsisi</span>
              </span>
              <span className="lx-accent-text font-semibold">{settings.ram} MB</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-zinc-400 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-zinc-500" />
                <span>Aikar&apos;s Flags</span>
              </span>
              <span
                className={`font-semibold ${
                  settings.aikarFlags ? 'text-emerald-400' : 'text-zinc-400'
                }`}
              >
                {settings.aikarFlags ? 'Aktif' : 'Kapalı'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-zinc-400 flex items-center gap-2">
                <Monitor className="w-3.5 h-3.5 text-zinc-500" />
                <span>Çözünürlük</span>
              </span>
              <span className="text-zinc-100 font-semibold">
                {settings.fullscreen
                  ? 'Tam Ekran'
                  : `${settings.resolutionWidth}×${settings.resolutionHeight}`}
              </span>
            </div>

            {/* Live CPU & RAM bars */}
            <div className="pt-2.5 mt-2 border-t border-white/[0.06] space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-28 text-zinc-400 flex items-center gap-1.5 shrink-0">
                  <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                  <span>CPU Kullanımı</span>
                </span>
                <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full lx-progress-fill transition-all duration-500"
                    style={{ width: `${Math.round(stats.cpuUsage)}%` }}
                  />
                </div>
                <span className="w-10 text-right text-zinc-200 font-medium">
                  %{Math.round(stats.cpuUsage)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-28 text-zinc-400 flex items-center gap-1.5 shrink-0">
                  <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
                  <span>RAM Kullanımı</span>
                </span>
                <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full lx-progress-fill transition-all duration-500"
                    style={{ width: `${Math.round(stats.ramUsage)}%` }}
                  />
                </div>
                <span className="w-10 text-right text-zinc-200 font-medium">
                  %{Math.round(stats.ramUsage)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Announcements + Quick Access */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lx-stagger-4">
        {/* Announcements (6 cols) */}
        <div className="lg:col-span-6 rounded-2xl lx-card p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Megaphone className="w-4 h-4 lx-accent-text" />
              <span>Duyurular &amp; Güncellemeler</span>
            </h2>
            <div className="flex items-center gap-1.5">
              {ANNOUNCEMENTS.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setSlideIdx(idx)}
                  aria-label={`Duyuru ${idx + 1}`}
                  className={`h-2 rounded-full transition-all cursor-pointer ${
                    idx === slideIdx ? 'w-5 lx-progress-fill' : 'w-2 bg-white/15 hover:bg-white/30'
                  }`}
                />
              ))}
            </div>
          </div>

          <div
            key={slideIdx}
            className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] lx-fade-in"
          >
            <div className="w-16 h-16 rounded-xl lx-accent-badge flex items-center justify-center shrink-0">
              <Box className="w-8 h-8" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">
                {activeAnnouncement.title}
              </div>
              <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                {activeAnnouncement.desc}
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mt-2">
                <Calendar className="w-3 h-3" />
                <span>{activeAnnouncement.date}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Access (6 cols) */}
        <div className="lg:col-span-6 rounded-2xl lx-card p-5 flex flex-col justify-between">
          <h2 className="text-sm font-semibold text-zinc-100 mb-3 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 lx-accent-text" />
            <span>Hızlı Erişim</span>
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { id: 'mods', label: 'Modlar', icon: Package, action: () => onNavigate('mods') },
              { id: 'shaderpacks', label: 'Shaderlar', icon: Sparkles, action: () => onOpenFolder('shaderpacks') },
              { id: 'root', label: 'Oyun Dizini', icon: FolderOpen, action: () => onOpenFolder('root') },
              { id: 'console', label: 'Konsol Kayıtları', icon: Terminal, action: () => onNavigate('console') },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={item.action}
                  className="p-3.5 rounded-xl bg-white/[0.025] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/15 flex flex-col items-center justify-center gap-2 text-center transition-all cursor-pointer group"
                >
                  <Icon className="w-5 h-5 lx-accent-text group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-medium text-zinc-200">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
