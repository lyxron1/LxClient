import React, { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X, Home, Layers, Package, Image, Terminal, Settings } from 'lucide-react';
import { TabId } from '../types';

interface TitlebarProps {
  activeTab: TabId;
  activeTabLabel: string;
}

const TAB_ICONS: Record<TabId, React.ComponentType<{ className?: string }>> = {
  dashboard: Home,
  versions: Layers,
  mods: Package,
  screenshots: Image,
  console: Terminal,
  settings: Settings,
};

export const Titlebar: React.FC<TitlebarProps> = ({ activeTab, activeTabLabel }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const TabIcon = TAB_ICONS[activeTab];

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const handleMinimize = () => {
    getCurrentWindow().minimize().catch(() => {});
  };

  const handleToggleMaximize = () => {
    getCurrentWindow().toggleMaximize().catch(() => {});
  };

  const handleClose = () => {
    getCurrentWindow().close().catch(() => {});
  };

  return (
    <header
      data-tauri-drag-region
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-card)',
      }}
      className="h-10 shrink-0 flex items-center justify-between px-4 backdrop-blur-md select-none z-40"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 text-xs text-zinc-400">
        <div className="w-5 h-5 rounded-md flex items-center justify-center lx-accent-badge">
          <svg viewBox="0 0 512 512" className="w-3.5 h-3.5">
            <path
              d="M 140 120 L 190 120 L 190 340 L 290 340 L 290 390 L 140 390 Z"
              fill="currentColor"
            />
            <path
              d="M 350 120 L 285 245 L 325 245 L 250 390 L 375 225 L 330 225 Z"
              fill="#ffffff"
              opacity="0.9"
            />
          </svg>
        </div>
        <span className="font-semibold text-zinc-200 tracking-tight">LxClient</span>
        <span className="text-zinc-600">|</span>
        <span className="flex items-center gap-1.5 text-zinc-400">
          <TabIcon className="w-3.5 h-3.5 lx-accent-text" />
          <span>{activeTabLabel}</span>
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={handleMinimize}
          title="Küçült"
          aria-label="Küçült"
          className="w-8 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.07] transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleToggleMaximize}
          title={isMaximized ? 'Küçült' : 'Ekranı Kapla'}
          aria-label={isMaximized ? 'Küçült' : 'Ekranı Kapla'}
          className="w-8 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.07] transition-colors cursor-pointer"
        >
          {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
        <button
          onClick={handleClose}
          title="Kapat"
          aria-label="Kapat"
          className="w-8 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-rose-500/80 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
