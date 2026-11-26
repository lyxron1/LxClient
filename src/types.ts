export type TabId = 'dashboard' | 'versions' | 'mods' | 'screenshots' | 'console' | 'settings';

export type ThemeId = 'purple' | 'green';

export type VersionKind = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt' | 'custom';

export interface LauncherSettings {
  gameDirectory: string;
  gamePath: string;
  resolutionWidth: number;
  resolutionHeight: number;
  fullscreen: boolean;
  javaPath: string;
  ram: number;
  lastUsername: string;
  lastVersion: string;
  aikarFlags: boolean;
  theme: ThemeId;
}

export interface InstalledVersion {
  id: string;
  kind: VersionKind;
  inheritsFrom?: string | null;
}

export interface JavaInfo {
  major: number;
  raw: string;
  path: string;
}

export interface SystemInfo {
  totalMemMb: number;
  defaultGameDir: string;
  activeGameDir: string;
  settings: LauncherSettings;
  installedVersions: InstalledVersion[];
  systemJava: JavaInfo | null;
}

export interface MojangVersion {
  id: string;
  type: string;
  url: string;
  releaseTime: string;
}

export interface ScreenshotItem {
  name: string;
  path: string;
  mtime: number;
  dateStr: string;
  size: number;
  thumbnail: string;
  width: number;
  height: number;
}

export interface RuntimeStats {
  cpuUsage: number;
  ramUsage: number;
  usedRamMb: number;
  totalRamMb: number;
}

export interface ModItem {
  id: string;
  name: string;
  fileName: string;
  path: string;
  version?: string | null;
  description?: string | null;
  loader?: string | null;
  size: number;
  enabled: boolean;
}

export interface LaunchConfig {
  username: string;
  version: string;
  memoryMax: number;
  gameDirectory?: string;
  resolutionWidth?: number;
  resolutionHeight?: number;
  fullscreen?: boolean;
  javaPath?: string;
  aikarFlags?: boolean;
}

export interface LogEvent {
  type: 'system' | 'data' | 'error' | 'warn' | 'debug';
  text: string;
}

export interface ProgressEvent {
  type: 'java' | 'classes' | 'assets' | 'natives';
  task: number;
  total: number;
  message: string;
}

export interface ActionResult {
  success: boolean;
  message?: string | null;
  error?: string | null;
}

export interface LogEntry extends LogEvent {
  id: number;
  timestamp: string;
}
