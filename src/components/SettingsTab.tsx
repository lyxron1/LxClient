import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FolderOpen,
  Cpu,
  Monitor,
  Zap,
  Coffee,
  RotateCcw,
  Save,
  Check,
  Palette,
  Sliders,
} from 'lucide-react';
import { LauncherSettings, ThemeId } from '../types';

interface SettingsTabProps {
  settings: LauncherSettings;
  totalMemMb: number;
  onSave: (updated: LauncherSettings) => Promise<void>;
  onReset: () => Promise<void>;
  onInstantThemeChange: (theme: ThemeId) => void;
}

type SettingsCategory = 'appearance' | 'general' | 'minecraft' | 'java' | 'advanced';

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  totalMemMb,
  onSave,
  onReset,
  onInstantThemeChange,
}) => {
  const [draft, setDraft] = useState<LauncherSettings>(settings);
  const [category, setCategory] = useState<SettingsCategory>('appearance');
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleBrowseGameDir = async () => {
    const selected = await invoke<string | null>('select_game_dir');
    if (typeof selected === 'string' && selected.trim()) {
      setDraft((d) => ({ ...d, gamePath: selected, gameDirectory: selected }));
    }
  };

  const handleBrowseJava = async () => {
    const selected = await invoke<string | null>('select_java_path');
    if (typeof selected === 'string' && selected.trim()) {
      setDraft((d) => ({ ...d, javaPath: selected }));
    }
  };

  const handleSave = async () => {
    await onSave(draft);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  const handleThemeSelect = (theme: ThemeId) => {
    setDraft((d) => ({ ...d, theme }));
    onInstantThemeChange(theme);
  };

  const maxRam = Math.max(2048, totalMemMb);

  const categories: {
    id: SettingsCategory;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'appearance', label: 'Görünüm ve Temalar', icon: Palette },
    { id: 'general', label: 'Genel Ayarlar', icon: FolderOpen },
    { id: 'minecraft', label: 'Minecraft Ayarları', icon: Monitor },
    { id: 'java', label: 'Java Ayarları', icon: Coffee },
    { id: 'advanced', label: 'Gelişmiş Ayarlar', icon: Sliders },
  ];

  return (
    <div className="max-w-4xl space-y-5 pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Ayarlar</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Tema görünümü, oyun dizini, bellek tahsisi ve JVM performans seçenekleri
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="px-3.5 py-2 rounded-xl lx-card hover:bg-white/[0.06] text-xs font-medium text-zinc-300 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Varsayılan</span>
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl lx-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            {savedToast ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Kaydedildi</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Kaydet</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const active = category === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                active ? 'lx-accent-badge' : 'lx-card text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Görünüm ve Temalar */}
      {category === 'appearance' && (
        <div className="rounded-2xl lx-card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Palette className="w-4 h-4 lx-accent-text" />
              <span>Tema Seçimi</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Seçtiğiniz tema anında uygulanır ve otomatik kaydedilir.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Mor Tema Kartı */}
            <button
              type="button"
              onClick={() => handleThemeSelect('purple')}
              className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                draft.theme === 'purple'
                  ? 'border-purple-500/60 bg-purple-500/10 ring-1 ring-purple-500/40'
                  : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
              }`}
            >
              {/* Mini Preview */}
              <div className="h-24 rounded-xl bg-[#07060d] border border-purple-500/25 p-3 flex flex-col justify-between mb-3 overflow-hidden relative">
                <div
                  className="absolute inset-0 opacity-60"
                  style={{
                    background:
                      'radial-gradient(circle at 85% 20%, rgba(168,85,247,0.35), transparent 60%)',
                  }}
                />
                <div className="relative flex items-center justify-between">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Varsayılan
                  </span>
                  {draft.theme === 'purple' && (
                    <span className="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div className="relative flex items-center gap-2">
                  <div className="h-2.5 flex-1 rounded-full bg-white/10" />
                  <div className="h-6 w-16 rounded-lg bg-gradient-to-r from-purple-600 to-violet-500" />
                </div>
              </div>
              <div className="text-sm font-semibold text-white">Mor Tema</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Koyu obsidian zemin üzerinde neon mor vurgular
              </div>
            </button>

            {/* Yeşil Tema Kartı */}
            <button
              type="button"
              onClick={() => handleThemeSelect('green')}
              className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                draft.theme === 'green'
                  ? 'border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/40'
                  : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
              }`}
            >
              <div className="h-24 rounded-xl bg-[#050a08] border border-emerald-500/25 p-3 flex flex-col justify-between mb-3 overflow-hidden relative">
                <div
                  className="absolute inset-0 opacity-60"
                  style={{
                    background:
                      'radial-gradient(circle at 85% 20%, rgba(16,185,129,0.35), transparent 60%)',
                  }}
                />
                <div className="relative flex items-center justify-between">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Zümrüt
                  </span>
                  {draft.theme === 'green' && (
                    <span className="w-5 h-5 rounded-full bg-emerald-500 text-zinc-950 flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div className="relative flex items-center gap-2">
                  <div className="h-2.5 flex-1 rounded-full bg-white/10" />
                  <div className="h-6 w-16 rounded-lg bg-gradient-to-r from-emerald-500 to-green-500" />
                </div>
              </div>
              <div className="text-sm font-semibold text-white">Yeşil Tema</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Koyu zümrüt zemin üzerinde canlı yeşil vurgular
              </div>
            </button>
          </div>
        </div>
      )}

      {/* 2. Genel Ayarlar */}
      {category === 'general' && (
        <div className="rounded-2xl lx-card p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <FolderOpen className="w-4 h-4 lx-accent-text" />
            <span>Oyun Dizini (.minecraft)</span>
          </div>
          <p className="text-xs text-zinc-400">
            Modlar, dünyalar, ekran görüntüleri ve sürüm dosyalarının saklandığı ana klasör.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={draft.gamePath}
              onChange={(e) =>
                setDraft((d) => ({ ...d, gamePath: e.target.value, gameDirectory: e.target.value }))
              }
              className="flex-1 h-10 px-3.5 rounded-xl lx-input text-xs text-zinc-200"
            />
            <button
              onClick={handleBrowseGameDir}
              className="px-4 h-10 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
            >
              Gözat
            </button>
          </div>
        </div>
      )}

      {/* 3. Minecraft Ayarları */}
      {category === 'minecraft' && (
        <div className="rounded-2xl lx-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Monitor className="w-4 h-4 lx-accent-text" />
              <span>Pencere Çözünürlüğü</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.fullscreen}
                onChange={(e) => setDraft((d) => ({ ...d, fullscreen: e.target.checked }))}
                className="rounded border-white/20 bg-zinc-900 accent-[var(--accent)]"
              />
              <span>Tam Ekran Başlat</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">Genişlik (px)</label>
              <input
                type="number"
                value={draft.resolutionWidth}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, resolutionWidth: Number(e.target.value) || 1280 }))
                }
                className="w-full h-10 px-3 rounded-xl lx-input text-xs text-zinc-200"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">Yükseklik (px)</label>
              <input
                type="number"
                value={draft.resolutionHeight}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, resolutionHeight: Number(e.target.value) || 720 }))
                }
                className="w-full h-10 px-3 rounded-xl lx-input text-xs text-zinc-200"
              />
            </div>
          </div>
        </div>
      )}

      {/* 4. Java Ayarları */}
      {category === 'java' && (
        <div className="space-y-4">
          <div className="rounded-2xl lx-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Cpu className="w-4 h-4 lx-accent-text" />
                <span>Bellek (RAM) Tahsisi</span>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg lx-accent-badge">
                {draft.ram} MB ({(draft.ram / 1024).toFixed(1)} GB)
              </span>
            </div>

            <input
              type="range"
              min={1024}
              max={maxRam}
              step={256}
              value={draft.ram}
              onChange={(e) => setDraft((d) => ({ ...d, ram: Number(e.target.value) }))}
              className="w-full accent-[var(--accent)] cursor-pointer"
            />

            <div className="flex justify-between text-[11px] text-zinc-500">
              <span>Min: 1.0 GB</span>
              <span>Sistem Toplamı: {(totalMemMb / 1024).toFixed(1)} GB</span>
            </div>
          </div>

          <div className="rounded-2xl lx-card p-5 space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Coffee className="w-4 h-4 lx-accent-text" />
              <span>Özel Java Yolu (Opsiyonel)</span>
            </div>
            <p className="text-xs text-zinc-400">
              Boş bırakılırsa seçilen Minecraft ve Forge sürümüne uygun Java (8 / 17 / 21 / 25) otomatik algılanır veya indirilir.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft.javaPath}
                onChange={(e) => setDraft((d) => ({ ...d, javaPath: e.target.value }))}
                placeholder="Otomatik (Önerilen)"
                className="flex-1 h-10 px-3.5 rounded-xl lx-input text-xs text-zinc-200 placeholder-zinc-600"
              />
              <button
                onClick={handleBrowseJava}
                className="px-4 h-10 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
              >
                Gözat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Gelişmiş Ayarlar */}
      {category === 'advanced' && (
        <div className="rounded-2xl lx-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Aikar&apos;s JVM Performans Bayrakları</span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                G1GC çöp toplayıcı optimizasyonları ile takılmaları (stutter) azaltır.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, aikarFlags: !d.aikarFlags }))}
              className={`w-12 h-6 rounded-full transition-colors p-0.5 cursor-pointer ${
                draft.aikarFlags ? 'lx-progress-fill' : 'bg-zinc-700'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  draft.aikarFlags ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
