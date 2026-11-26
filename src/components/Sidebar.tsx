import React, { useState, useEffect, useRef } from 'react';
import { Home, Layers, Package, Image, Terminal, Settings, ArrowLeftRight } from 'lucide-react';
import { TabId } from '../types';

const STEVE_FALLBACK_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath fill='%234a3219' d='M0 0h8v2H0zM0 2h1v1H0zm7 0h1v1H7z'/%3E%3Cpath fill='%23cbb38b' d='M1 2h6v1H1zM0 3h8v3H0z'/%3E%3Cpath fill='%23ffffff' d='M1 4h1v1H1zm4 0h1v1H5z'/%3E%3Cpath fill='%232c1b77' d='M2 4h1v1H2zm4 0h1v1H6z'/%3E%3Cpath fill='%23875638' d='M3 5h2v1H3z'/%3E%3Cpath fill='%23442113' d='M2 6h4v1H2z'/%3E%3Cpath fill='%23875638' d='M1 7h6v1H1z'/%3E%3C/svg%3E";

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  username: string;
  onUsernameChange: (name: string) => void;
  launchState: 'idle' | 'preparing' | 'running';
  disabled: boolean;
}

const NAV_ITEMS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Ana Sayfa', icon: Home },
  { id: 'versions', label: 'Sürümler', icon: Layers },
  { id: 'mods', label: 'Modlar', icon: Package },
  { id: 'screenshots', label: 'Ekran Görüntüleri', icon: Image },
  { id: 'console', label: 'Canlı Konsol', icon: Terminal },
  { id: 'settings', label: 'Ayarlar', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  username,
  onUsernameChange,
  launchState,
  disabled,
}) => {
  const [avatarUrl, setAvatarUrl] = useState<string>(STEVE_FALLBACK_URI);
  const [editingUser, setEditingUser] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmed = username.trim();
    if (!trimmed) {
      setAvatarUrl(STEVE_FALLBACK_URI);
      return;
    }

    const timer = setTimeout(() => {
      const primary = `https://mc-heads.net/avatar/${encodeURIComponent(trimmed)}/100`;
      const secondary = `https://minotar.net/avatar/${encodeURIComponent(trimmed)}/100`;

      const img = new window.Image();
      img.onload = () => setAvatarUrl(primary);
      img.onerror = () => {
        const fb = new window.Image();
        fb.onload = () => setAvatarUrl(secondary);
        fb.onerror = () => setAvatarUrl(STEVE_FALLBACK_URI);
        fb.src = secondary;
      };
      img.src = primary;
    }, 350);

    return () => clearTimeout(timer);
  }, [username]);

  const statusColor =
    launchState === 'running'
      ? 'bg-emerald-400'
      : launchState === 'preparing'
      ? 'bg-amber-400 animate-pulse'
      : 'bg-emerald-500';

  const statusLabel =
    launchState === 'running'
      ? 'Oyun Açık'
      : launchState === 'preparing'
      ? 'Başlatılıyor'
      : 'Çevrimdışı / Hazır';

  const handleToggleEdit = () => {
    if (disabled) return;
    setEditingUser(true);
    setTimeout(() => inputRef.current?.focus(), 40);
  };

  return (
    <aside
      style={{
        backgroundColor: 'var(--bg-surface)',
        backgroundImage: 'var(--sidebar-ambient)',
        borderRight: '1px solid var(--border-card)',
      }}
      className="w-60 shrink-0 flex flex-col justify-between p-3.5 select-none"
    >
      {/* Top: Brand Header & Navigation */}
      <div>
        <div className="flex items-center gap-3 px-2 py-2 mb-5">
          <div className="w-10 h-10 rounded-xl lx-accent-badge flex items-center justify-center shrink-0">
            <svg viewBox="0 0 512 512" className="w-6 h-6">
              <path
                d="M 140 120 L 190 120 L 190 340 L 290 340 L 290 390 L 140 390 Z"
                fill="currentColor"
              />
              <path
                d="M 350 120 L 285 245 L 325 245 L 250 390 L 375 225 L 330 225 Z"
                fill="#ffffff"
                opacity="0.92"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white">LxClient</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md lx-accent-badge">
                v2.0
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 truncate">Rust + Tauri Launcher</p>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium lx-nav-item cursor-pointer ${
                  isActive
                    ? 'lx-nav-active'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-transform duration-150 group-hover:scale-110 ${
                    isActive ? 'lx-accent-text' : 'text-zinc-500 group-hover:text-zinc-300'
                  }`}
                />
                <span>{item.label}</span>
                {item.id === 'console' && launchState !== 'idle' && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom: Player Profile Card */}
      <div className="mt-4 p-3 rounded-2xl lx-card space-y-2.5">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <img
              src={avatarUrl}
              alt="Skin"
              className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/10 object-cover"
            />
            <span
              style={{ borderColor: 'var(--bg-card)' }}
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${statusColor}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-emerald-400/90 truncate">
              {statusLabel}
            </div>
            <p className="text-xs font-semibold text-zinc-100 truncate">
              {username.trim() || 'Oyuncu'}
            </p>
          </div>
        </div>

        {editingUser ? (
          <input
            ref={inputRef}
            type="text"
            value={username}
            disabled={disabled}
            onBlur={() => setEditingUser(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') setEditingUser(false);
            }}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="Kullanıcı adı..."
            maxLength={16}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg lx-input text-zinc-100 placeholder-zinc-600"
          />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={handleToggleEdit}
            className="w-full py-1.5 px-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] text-[11px] font-medium text-zinc-300 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <ArrowLeftRight className="w-3 h-3 text-zinc-400" />
            <span>Profil Değiştir</span>
          </button>
        )}
      </div>
    </aside>
  );
};
