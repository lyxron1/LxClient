import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { DashboardTab } from './components/DashboardTab';
import { VersionsTab } from './components/VersionsTab';
import { ModsTab } from './components/ModsTab';
import { ScreenshotsTab } from './components/ScreenshotsTab';
import { ConsoleTab } from './components/ConsoleTab';
import { SettingsTab } from './components/SettingsTab';
import {
  ActionResult,
  InstalledVersion,
  JavaInfo,
  LauncherSettings,
  LogEntry,
  LogEvent,
  MojangVersion,
  ProgressEvent,
  SystemInfo,
  TabId,
  ThemeId,
} from './types';

const TAB_LABELS: Record<TabId, string> = {
  dashboard: 'Ana Sayfa',
  versions: 'Sürümler',
  mods: 'Modlar',
  screenshots: 'Ekran Görüntüleri',
  console: 'Canlı Konsol',
  settings: 'Ayarlar',
};

const DEFAULT_SETTINGS: LauncherSettings = {
  gameDirectory: '',
  gamePath: '',
  resolutionWidth: 1280,
  resolutionHeight: 720,
  fullscreen: false,
  javaPath: '',
  ram: 4096,
  lastUsername: '',
  lastVersion: '1.20.4',
  aikarFlags: false,
  theme: 'purple',
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [settings, setSettings] = useState<LauncherSettings>(DEFAULT_SETTINGS);
  const [totalMemMb, setTotalMemMb] = useState<number>(8192);
  const [systemJava, setSystemJava] = useState<JavaInfo | null>(null);
  const [installedVersions, setInstalledVersions] = useState<InstalledVersion[]>([]);
  const [mojangVersions, setMojangVersions] = useState<MojangVersion[]>([]);
  const [username, setUsername] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<string>('1.20.4');
  const [launchState, setLaunchState] = useState<'idle' | 'preparing' | 'running'>('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(1);

  useEffect(() => {
    const theme = settings.theme === 'green' ? 'green' : 'purple';
    document.documentElement.setAttribute('data-theme', theme);
  }, [settings.theme]);

  const appendLog = useCallback((type: LogEvent['type'], text: string) => {
    if (!text) return;
    const now = new Date().toLocaleTimeString('tr-TR');
    setLogs((prev) => {
      const next = [...prev, { id: logIdRef.current++, type, text, timestamp: now }];
      return next.length > 600 ? next.slice(next.length - 600) : next;
    });
  }, []);

  const refreshInstalledVersions = useCallback(async (customDir?: string) => {
    try {
      const list = await invoke<InstalledVersion[]>('get_installed_versions', {
        customDir: customDir || null,
      });
      setInstalledVersions(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const info = await invoke<SystemInfo>('get_system_info');
        setTotalMemMb(info.totalMemMb);
        setSettings(info.settings);
        setSystemJava(info.systemJava);
        setInstalledVersions(info.installedVersions);
        setUsername(info.settings.lastUsername || '');
        setSelectedVersion(
          info.settings.lastVersion ||
            info.installedVersions[0]?.id ||
            '1.20.4'
        );
        appendLog(
          'system',
          `LxClient hazır. Sistem RAM: ${(info.totalMemMb / 1024).toFixed(1)} GB | Yüklü Profiller: ${info.installedVersions.length}`
        );
      } catch (err) {
        appendLog('error', `Sistem bilgisi alınamadı: ${String(err)}`);
      }

      try {
        const mojang = await invoke<MojangVersion[]>('get_mojang_versions');
        setMojangVersions(mojang);
      } catch (err) {
        appendLog('warn', `Mojang sürüm listesi çekilemedi: ${String(err)}`);
      }
    })();
  }, [appendLog]);

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    unlisteners.push(
      listen<LogEvent>('launcher-log', (e) => {
        appendLog(e.payload.type, e.payload.text);
      })
    );

    unlisteners.push(
      listen<ProgressEvent>('launcher-progress', (e) => {
        const { task, total, message } = e.payload;
        const pct = total > 0 ? Math.min(100, Math.round((task / total) * 100)) : 0;
        setProgressPercent(pct);
        if (message) setProgressMessage(message);
      })
    );

    unlisteners.push(
      listen<string>('launcher-download-status', (e) => {
        if (e.payload) setProgressMessage(e.payload);
      })
    );

    unlisteners.push(
      listen('launcher-started', () => {
        setLaunchState('running');
        setProgressPercent(100);
        setProgressMessage('Minecraft başlatıldı!');
        appendLog('system', 'Minecraft süreci başlatıldı.');
        refreshInstalledVersions();
      })
    );

    unlisteners.push(
      listen<number>('launcher-close', (e) => {
        setLaunchState('idle');
        setProgressPercent(0);
        setProgressMessage('');
        appendLog('system', `Minecraft kapandı (Çıkış kodu: ${e.payload}).`);
        refreshInstalledVersions();
      })
    );

    unlisteners.push(
      listen<string>('launcher-error', (e) => {
        setLaunchState('idle');
        setProgressPercent(0);
        setProgressMessage('');
        appendLog('error', `Hata: ${e.payload}`);
      })
    );

    unlisteners.push(
      listen<string>('game-directory-changed', (e) => {
        refreshInstalledVersions(e.payload);
      })
    );

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, [appendLog, refreshInstalledVersions]);

  const handleSelectVersion = (ver: string) => {
    setSelectedVersion(ver);
    const updated = { ...settings, lastVersion: ver };
    setSettings(updated);
    invoke('save_settings', { newSettings: updated }).catch(() => {});
  };

  const handleLaunch = async (overrideVersion?: string) => {
    const targetVersion = overrideVersion || selectedVersion;
    const cleanUser = username.trim() || 'Oyuncu';
    if (!username.trim()) {
      setUsername(cleanUser);
    }

    const updatedSettings = {
      ...settings,
      lastUsername: cleanUser,
      lastVersion: targetVersion,
    };
    setSettings(updatedSettings);
    await invoke('save_settings', { newSettings: updatedSettings }).catch(() => {});

    setLaunchState('preparing');
    setProgressPercent(5);
    setProgressMessage('Oyun dosyaları ve Java doğrulanıyor...');

    try {
      const res = await invoke<ActionResult>('launch_game', {
        config: {
          username: cleanUser,
          version: targetVersion,
          memoryMax: updatedSettings.ram,
          gameDirectory: updatedSettings.gamePath,
          resolutionWidth: updatedSettings.resolutionWidth,
          resolutionHeight: updatedSettings.resolutionHeight,
          fullscreen: updatedSettings.fullscreen,
          javaPath: updatedSettings.javaPath,
          aikarFlags: updatedSettings.aikarFlags,
        },
      });
      if (!res.success) {
        setLaunchState('idle');
        setProgressPercent(0);
        setProgressMessage('');
      }
    } catch (err) {
      setLaunchState('idle');
      setProgressPercent(0);
      setProgressMessage('');
      appendLog('error', `Başlatma hatası: ${String(err)}`);
    }
  };

  const handleOpenFolder = async (folderType: string) => {
    const res = await invoke<ActionResult>('open_special_folder', { folderType });
    if (!res.success && res.error) {
      appendLog('error', res.error);
    }
  };

  const handleSaveSettings = async (updated: LauncherSettings) => {
    setSettings(updated);
    const res = await invoke<ActionResult>('save_settings', { newSettings: updated });
    if (res.success) {
      appendLog('system', `Ayarlar kaydedildi. Oyun dizini: ${updated.gamePath}`);
      await refreshInstalledVersions(updated.gamePath);
    } else if (res.error) {
      appendLog('error', res.error);
    }
  };

  const handleResetSettings = async () => {
    try {
      const defaults = await invoke<LauncherSettings>('reset_settings');
      setSettings(defaults);
      appendLog('system', 'Ayarlar varsayılana sıfırlandı.');
      await refreshInstalledVersions(defaults.gamePath);
    } catch (err) {
      appendLog('error', `Sıfırlama hatası: ${String(err)}`);
    }
  };

  const handleInstantThemeChange = async (theme: ThemeId) => {
    const updated: LauncherSettings = { ...settings, theme };
    setSettings(updated);
    document.documentElement.setAttribute('data-theme', theme);
    await invoke<ActionResult>('save_settings', { newSettings: updated }).catch(() => {});
  };

  return (
    <div
      style={{ backgroundColor: 'var(--bg-base)' }}
      className="h-screen w-screen flex flex-col text-zinc-100 overflow-hidden"
    >
      <Titlebar activeTab={activeTab} activeTabLabel={TAB_LABELS[activeTab]} />

      <div className="flex-1 flex min-h-0">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          username={username}
          onUsernameChange={setUsername}
          launchState={launchState}
          disabled={launchState !== 'idle'}
        />

        <main className="flex-1 min-w-0 overflow-y-auto p-5">
          <div key={activeTab} className="h-full lx-page-enter">
            {activeTab === 'dashboard' && (
              <DashboardTab
                username={username}
                selectedVersion={selectedVersion}
                onSelectVersion={handleSelectVersion}
                installedVersions={installedVersions}
                mojangVersions={mojangVersions}
                settings={settings}
                systemJava={systemJava}
                launchState={launchState}
                progressPercent={progressPercent}
                progressMessage={progressMessage}
                onLaunch={handleLaunch}
                onOpenFolder={handleOpenFolder}
                onNavigate={setActiveTab}
              />
            )}

            {activeTab === 'versions' && (
              <VersionsTab
                installedVersions={installedVersions}
                mojangVersions={mojangVersions}
                selectedVersion={selectedVersion}
                onSelectVersion={handleSelectVersion}
                onLaunchVersion={handleLaunch}
                launchState={launchState}
              />
            )}

            {activeTab === 'mods' && (
              <ModsTab onOpenFolder={handleOpenFolder} />
            )}

            {activeTab === 'screenshots' && (
              <ScreenshotsTab onOpenFolder={handleOpenFolder} />
            )}

            {activeTab === 'console' && (
              <ConsoleTab
                logs={logs}
                onClear={() => setLogs([])}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsTab
                settings={settings}
                totalMemMb={totalMemMb}
                onSave={handleSaveSettings}
                onReset={handleResetSettings}
                onInstantThemeChange={handleInstantThemeChange}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
