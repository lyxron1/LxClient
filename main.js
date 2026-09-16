const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const child_process = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { checkAndPrepareJava, getSystemJavaVersion, isJava25Required } = require('./javaManager');
const { prepareFabricVersion } = require('./fabricManager');

let mainWindow;

// Ensure options.txt has isDemoUser:false, joinedFirstServer:true, skipMultiplayerWarning:true
function ensureMultiplayerUnlocked(gameDirectory) {
    try {
        if (!fs.existsSync(gameDirectory)) {
            fs.mkdirSync(gameDirectory, { recursive: true });
        }
        const optionsPath = path.join(gameDirectory, 'options.txt');
        let lines = [];
        if (fs.existsSync(optionsPath)) {
            const content = fs.readFileSync(optionsPath, 'utf8');
            lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
        }

        const optionsMap = new Map();
        for (const line of lines) {
            const idx = line.indexOf(':');
            if (idx !== -1) {
                const key = line.substring(0, idx).trim();
                const val = line.substring(idx + 1).trim();
                optionsMap.set(key, val);
            }
        }

        optionsMap.set('isDemoUser', 'false');
        optionsMap.set('joinedFirstServer', 'true');
        optionsMap.set('skipMultiplayerWarning', 'true');
        optionsMap.set('chatVisibility', '0');
        optionsMap.set('realmsNotifications', 'false');

        const newLines = [];
        for (const [key, val] of optionsMap.entries()) {
            newLines.push(`${key}:${val}`);
        }
        fs.writeFileSync(optionsPath, newLines.join('\n') + '\n', 'utf8');
    } catch (err) {
        console.error('options.txt güncellenirken hata:', err);
    }
}

// Scan versions directory for installed versions (both .jar and .json must exist, or Fabric profile with .json)
function getInstalledVersions(gameDirectory) {
    const versionsDir = path.join(gameDirectory, 'versions');
    if (!fs.existsSync(versionsDir)) return [];
    try {
        const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
        const installed = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const verId = entry.name;
                const jarPath = path.join(versionsDir, verId, `${verId}.jar`);
                const jsonPath = path.join(versionsDir, verId, `${verId}.json`);

                if (fs.existsSync(jsonPath)) {
                    // Check if vanilla jar exists or if it's Fabric/modded inheriting from a base version
                    if (fs.existsSync(jarPath)) {
                        installed.push(verId);
                    } else {
                        try {
                            const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                            if (parsed.inheritsFrom || (parsed.mainClass && parsed.mainClass.includes('fabric'))) {
                                installed.push(verId);
                            }
                        } catch (e) {}
                    }
                }
            }
        }
        return installed;
    } catch (err) {
        console.error('Sürümler taranırken hata:', err);
        return [];
    }
}

// Global in-memory Active Game Root (Single Source of Truth)
let activeGameRoot = null;

function getSettingsFilePath() {
    try {
        if (app && app.getPath) {
            return path.join(app.getPath('userData'), 'settings.json');
        }
    } catch (e) {}
    const base = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : path.join(process.env.HOME || '', '.config'));
    return path.join(base, 'lxclient', 'settings.json');
}

function sanitizeGamePath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
        return path.join(app.getPath('appData'), '.minecraft');
    }
    return path.resolve(targetPath.trim());
}

// Settings management
function getDefaultSettings() {
    const totalMemMB = Math.floor(os.totalmem() / (1024 * 1024));
    const defaultRam = totalMemMB <= 4096 ? Math.min(2560, totalMemMB - 512) : 4096;
    const defaultMinecraftDir = path.join(app.getPath('appData'), '.minecraft');

    return {
        gameDirectory: defaultMinecraftDir,
        gamePath: defaultMinecraftDir,
        resolutionWidth: 925,
        resolutionHeight: 530,
        fullscreen: false,
        javaPath: '',
        ram: Math.max(1024, defaultRam),
        lastUsername: '',
        lastVersion: '1.20.4',
        aikarFlags: false
    };
}

function loadSettings() {
    try {
        const defaults = getDefaultSettings();
        const settingsPath = getSettingsFilePath();
        let loaded = defaults;
        if (fs.existsSync(settingsPath)) {
            const raw = fs.readFileSync(settingsPath, 'utf8');
            const parsed = JSON.parse(raw);
            loaded = { ...defaults, ...parsed };
        }
        loaded.gamePath = sanitizeGamePath(loaded.gamePath);
        loaded.gameDirectory = sanitizeGamePath(loaded.gameDirectory);
        return loaded;
    } catch (err) {
        return getDefaultSettings();
    }
}

// Track directories that have already been initialized to prevent repetitive loop executions
const initializedDirs = new Set();

// Auto-initialize directory structure if missing or new (sanitized and loop-free)
function initializeGameDirectory(target) {
    const targetDir = sanitizeGamePath(target);

    try {
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        const subdirs = ['mods', 'versions', 'resourcepacks', 'screenshots', 'saves', 'assets'];
        subdirs.forEach(sub => {
            const subDir = path.join(targetDir, sub);
            if (!fs.existsSync(subDir)) {
                fs.mkdirSync(subDir, { recursive: true });
            }
        });

        // Prevent multiple repetitive logs/events on same directory
        if (!initializedDirs.has(targetDir)) {
            initializedDirs.add(targetDir);
            const logMsg = '[Dizin] Seçilen konum Minecraft kök dizini olarak bağlandı ve hazırlandı: ' + targetDir;
            console.log(logMsg);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-log', {
                    type: 'system',
                    text: logMsg
                });
            }
        }
    } catch (err) {
        console.error('Dizin hazırlanırken hata:', err);
    }
}

// Single Source of Truth: Active Minecraft Game Directory
function getActiveGamePath() {
    if (activeGameRoot && typeof activeGameRoot === 'string' && activeGameRoot.trim().length > 0) {
        activeGameRoot = sanitizeGamePath(activeGameRoot);
        return activeGameRoot;
    }
    const settings = loadSettings();
    let chosen = (settings && (settings.gamePath || settings.gameDirectory)) || '';
    if (chosen && typeof chosen === 'string' && chosen.trim().length > 0) {
        activeGameRoot = sanitizeGamePath(chosen);
        return activeGameRoot;
    }
    const defaultPath = path.join(app.getPath('appData'), '.minecraft');
    activeGameRoot = defaultPath;
    return defaultPath;
}

function saveSettings(settings) {
    try {
        const settingsPath = getSettingsFilePath();
        const dir = path.dirname(settingsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Ayarlar kaydedilemedi:', err);
        return false;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 960,
        height: 670,
        minWidth: 860,
        minHeight: 600,
        frame: false,
        icon: path.join(__dirname, 'logo.svg'),
        backgroundColor: '#0a0f1d',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Window controls
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

// Settings & System Info IPC
ipcMain.handle('get-system-info', () => {
    const totalMemMB = Math.floor(os.totalmem() / (1024 * 1024));
    const settings = loadSettings();
    const defaultGameDir = path.join(app.getPath('appData'), '.minecraft');
    const effectiveDir = getActiveGamePath();
    initializeGameDirectory(effectiveDir);
    const installedVersions = getInstalledVersions(effectiveDir);
    const sysJava = getSystemJavaVersion();

    return {
        totalMemMB,
        defaultGameDir,
        activeGameDir: effectiveDir,
        settings,
        installedVersions,
        systemJava: sysJava
    };
});

ipcMain.handle('get-installed-versions', (_event, customDir) => {
    const targetDir = customDir && customDir.trim().length > 0 ? customDir.trim() : getActiveGamePath();
    return getInstalledVersions(targetDir);
});

ipcMain.handle('get-active-game-path', () => {
    return getActiveGamePath();
});

ipcMain.handle('get-default-game-path', () => {
    return path.join(app.getPath('appData'), '.minecraft');
});

ipcMain.handle('save-settings', (_event, newSettings) => {
    const oldPath = getActiveGamePath();
    const rawPath = (newSettings && (newSettings.gamePath || newSettings.gameDirectory)) || '';
    const targetPath = sanitizeGamePath(rawPath);

    const pathChanged = path.resolve(oldPath) !== path.resolve(targetPath);

    // Assign to in-memory global variable directly without pruning
    activeGameRoot = targetPath;

    // Assign to settings object
    if (newSettings) {
        newSettings.gamePath = targetPath;
        newSettings.gameDirectory = targetPath;
    }

    // Auto-initialize directory structure if missing or new
    initializeGameDirectory(targetPath);

    // Write physically to settings.json
    const res = saveSettings(newSettings);

    // Only emit directory changed and log if the path actually changed to prevent event loops
    if (pathChanged) {
        console.log('[Ayar] Aktif oyun dizini güncellendi: ' + activeGameRoot);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('launcher-log', {
                type: 'system',
                text: '[Ayar] Aktif oyun dizini güncellendi: ' + activeGameRoot
            });
            mainWindow.webContents.send('game-directory-changed', {
                oldPath,
                newPath: activeGameRoot
            });
        }
    }

    return res;
});

// Mojang Version Manifest Fetch
let mojangReleasesCache = null;

ipcMain.handle('get-mojang-versions', async () => {
    if (mojangReleasesCache && mojangReleasesCache.length > 0) {
        return mojangReleasesCache;
    }
    try {
        const res = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data && Array.isArray(data.versions)) {
            const releases = data.versions
                .filter(v => v.type === 'release')
                .map(v => v.id);
            if (releases.length > 0) {
                mojangReleasesCache = releases;
                return releases;
            }
        }
    } catch (err) {
        console.error('Mojang manifest çekilemedi:', err.message);
    }
    return null;
});

// Java inspection and download IPC
ipcMain.handle('check-java', async (_event, requestedMajor) => {
    try {
        const targetMajor = requestedMajor || 21;
        const result = await checkAndPrepareJava((progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('java-download-progress', progress);
            }
        }, targetMajor);
        return { success: true, ...result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Directory & Java selection dialogs
ipcMain.handle('select-game-dir', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Minecraft Oyun Klasörünü Seçin',
        properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('select-java-path', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Java Yürütülebilir Dosyasını (javaw.exe) Seçin',
        properties: ['openFile'],
        filters: [
            { name: 'Java Executable', extensions: ['exe'] },
            { name: 'Tüm Dosyalar', extensions: ['*'] }
        ]
    });
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Special folder quick opener
ipcMain.handle('open-special-folder', async (_event, folderType) => {
    try {
        const currentRoot = getActiveGamePath();
        initializeGameDirectory(currentRoot);
        const targetPath = folderType === 'root' ? currentRoot : path.join(currentRoot, folderType);

        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }

        await shell.openPath(targetPath);
        return { success: true, path: targetPath };
    } catch (err) {
        console.error('Klasör açılırken hata:', err);
        return { success: false, error: err.message };
    }
});

// Screenshots Gallery IPC Handlers
ipcMain.handle('get-screenshots', async () => {
    try {
        const gameRoot = getActiveGamePath();
        const screenshotsDir = path.join(gameRoot, 'screenshots');

        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
            return [];
        }

        const entries = fs.readdirSync(screenshotsDir, { withFileTypes: true });
        const imageFiles = entries.filter(f => {
            if (!f.isFile()) return false;
            const ext = path.extname(f.name).toLowerCase();
            return ext === '.png' || ext === '.jpg' || ext === '.jpeg';
        });

        const items = [];
        for (const file of imageFiles) {
            const fullPath = path.join(screenshotsDir, file.name);
            const stat = fs.statSync(fullPath);

            let thumbnail = '';
            try {
                const img = nativeImage.createFromPath(fullPath);
                if (!img.isEmpty()) {
                    const size = img.getSize();
                    const targetWidth = 320;
                    const targetHeight = size.width > 0 ? Math.round((size.height / size.width) * targetWidth) : 180;
                    thumbnail = img.resize({ width: targetWidth, height: targetHeight, quality: 'good' }).toDataURL();
                }
            } catch (e) {}

            items.push({
                name: file.name,
                path: fullPath,
                mtime: stat.mtimeMs,
                dateStr: stat.mtime.toLocaleString('tr-TR'),
                size: stat.size,
                thumbnail: thumbnail
            });
        }

        // Sort by newest first
        items.sort((a, b) => b.mtime - a.mtime);
        return items;
    } catch (err) {
        console.error('Ekran görüntüleri taranırken hata:', err);
        return [];
    }
});

ipcMain.handle('get-screenshot-full', async (_event, filePath) => {
    try {
        if (!filePath || !fs.existsSync(filePath)) return null;
        const img = nativeImage.createFromPath(filePath);
        if (!img.isEmpty()) {
            return img.toDataURL();
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
        const base64 = fs.readFileSync(filePath).toString('base64');
        return `data:${mime};base64,${base64}`;
    } catch (err) {
        console.error('Önizleme alınamadı:', err);
        return null;
    }
});

ipcMain.handle('show-item-in-folder', async (_event, filePath) => {
    try {
        if (filePath && fs.existsSync(filePath)) {
            shell.showItemInFolder(filePath);
            return { success: true };
        }
        return { success: false, error: 'Dosya bulunamadı' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('copy-screenshot-to-clipboard', async (_event, filePath) => {
    try {
        if (filePath && fs.existsSync(filePath)) {
            const img = nativeImage.createFromPath(filePath);
            if (!img.isEmpty()) {
                clipboard.writeImage(img);
                return { success: true };
            }
        }
        return { success: false, error: 'Görsel panoya kopyalanamadı' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Game launcher handler
ipcMain.handle('launch-game', async (_event, config) => {
    try {
        const launcher = new Client();
        const settings = loadSettings();

        // Single Source of Truth: Active Minecraft Game Root
        let gameRoot = getActiveGamePath();
        if (config && config.gameDirectory && typeof config.gameDirectory === 'string' && config.gameDirectory.trim()) {
            gameRoot = sanitizeGamePath(config.gameDirectory);
            activeGameRoot = gameRoot;
        }

        // Auto-initialize directory structure if missing or new
        initializeGameDirectory(gameRoot);

        // Ensure options.txt has isDemoUser:false and multiplayer unlocks
        ensureMultiplayerUnlocked(gameRoot);

        // Standard Offline Authorization with MD5 UUID
        const playerName = ((config && config.username) || (settings && settings.lastUsername) || 'Oyuncu').trim();
        const playerUuid = crypto.createHash('md5').update('OfflinePlayer:' + playerName).digest('hex');
        const auth = {
            access_token: "null",
            client_token: "null",
            uuid: playerUuid,
            name: playerName,
            user_properties: "{}"
        };
        auth.meta = {
            type: 'mojang',
            demo: false
        };

        // Memory configuration
        const memoryMaxMB = parseInt(config.memoryMax, 10) || 2560;
        const memoryMinMB = Math.max(1024, Math.floor(memoryMaxMB / 2));
        const memoryMax = `${memoryMaxMB}M`;
        const memoryMin = `${memoryMinMB}M`;

        // Requirement 1: Fabric & Modded profile resolution
        const fabricInfo = await prepareFabricVersion(gameRoot, config.version || '1.20.4', (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-progress', {
                    type: 'classes',
                    task: progress.current,
                    total: progress.total
                });
                mainWindow.webContents.send('launcher-download-status', progress.message);
                mainWindow.webContents.send('launcher-log', {
                    type: 'system',
                    text: progress.message
                });
            }
        });

        // Requirement 1 & 2: Automatic selection of Java 25 for 26.x or Java 25+ profiles
        const needsJava25 = isJava25Required(config.version, fabricInfo?.inheritsFrom);
        const targetJavaMajor = needsJava25 ? 25 : 21;

        let javaExec = null;
        if (config.javaPath && config.javaPath.trim().length > 0) {
            javaExec = config.javaPath.trim();
        } else if (settings.javaPath && settings.javaPath.trim().length > 0) {
            javaExec = settings.javaPath.trim();
        }

        if (!javaExec) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-log', {
                    type: 'system',
                    text: `Java çalışma ortamı doğrulanıyor (Gerekli Sürüm: Java ${targetJavaMajor})...`
                });
            }

            const javaRes = await checkAndPrepareJava((progress) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('java-download-progress', progress);
                    mainWindow.webContents.send('launcher-progress', {
                        type: 'java',
                        task: progress.percent,
                        total: 100
                    });
                    mainWindow.webContents.send('launcher-download-status', progress.message);
                    if (progress.percent === 0 || progress.percent === 100) {
                        mainWindow.webContents.send('launcher-log', {
                            type: 'system',
                            text: progress.message
                        });
                    }
                }
            }, targetJavaMajor);

            javaExec = javaRes.javaPath;

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-log', {
                    type: 'system',
                    text: `Java runtime hazırlandı (${javaRes.source} - Java ${javaRes.version}): ${javaExec}`
                });
            }
        }

        // Ensure javaw.exe is used
        if (javaExec) {
            if (javaExec.toLowerCase().endsWith('java.exe')) {
                javaExec = javaExec.slice(0, -8) + 'javaw.exe';
            } else if (javaExec.toLowerCase() === 'java') {
                javaExec = 'javaw';
            }
        }

        // Asset Index & Root Resolution
        const assetsDir = path.join(gameRoot, 'assets');
        const indexesDir = path.join(assetsDir, 'indexes');
        if (!fs.existsSync(indexesDir)) {
            fs.mkdirSync(indexesDir, { recursive: true });
        }

        let assetIndexInfo = null;
        let baseVersionId = config.version || '1.20.4';

        if (fabricInfo && fabricInfo.isFabric) {
            baseVersionId = fabricInfo.inheritsFrom || baseVersionId;
            const baseVanillaJsonPath = path.join(gameRoot, 'versions', fabricInfo.inheritsFrom, `${fabricInfo.inheritsFrom}.json`);
            if (fs.existsSync(baseVanillaJsonPath)) {
                try {
                    const baseJson = JSON.parse(fs.readFileSync(baseVanillaJsonPath, 'utf8'));
                    assetIndexInfo = baseJson.assetIndex || (baseJson.assets ? { id: baseJson.assets } : null);
                } catch (e) {}
            }
        } else {
            const verJsonPath = path.join(gameRoot, 'versions', baseVersionId, `${baseVersionId}.json`);
            if (fs.existsSync(verJsonPath)) {
                try {
                    const verJson = JSON.parse(fs.readFileSync(verJsonPath, 'utf8'));
                    assetIndexInfo = verJson.assetIndex || (verJson.assets ? { id: verJson.assets } : null);
                } catch (e) {}
            }
        }

        const assetIndexId = assetIndexInfo?.id || baseVersionId;
        const targetIndexFile = path.join(indexesDir, `${assetIndexId}.json`);

        // If asset index file is missing and URL is available, download it directly
        if (!fs.existsSync(targetIndexFile) && assetIndexInfo?.url) {
            try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launcher-log', {
                        type: 'system',
                        text: `Varlık indeksi (${assetIndexId}.json) indiriliyor...`
                    });
                }
                const aRes = await fetch(assetIndexInfo.url);
                if (aRes.ok) {
                    const idxData = await aRes.text();
                    fs.writeFileSync(targetIndexFile, idxData, 'utf8');
                }
            } catch (err) {
                console.warn('Varlık indeksi indirilemedi:', err.message);
            }
        }

        // Mirror asset index to version aliases so MCLC and Minecraft find it under any expected name
        if (fs.existsSync(targetIndexFile)) {
            const aliasesToSync = [];
            if (fabricInfo && fabricInfo.isFabric) {
                aliasesToSync.push(fabricInfo.versionName, fabricInfo.inheritsFrom);
            }
            if (config.version && config.version !== assetIndexId) {
                aliasesToSync.push(config.version);
            }
            for (const alias of aliasesToSync) {
                const aliasFile = path.join(indexesDir, `${alias}.json`);
                if (!fs.existsSync(aliasFile)) {
                    try {
                        fs.copyFileSync(targetIndexFile, aliasFile);
                    } catch (e) {}
                }
            }
        }

        // Ensure Fabric merged JSON has full assetIndex info
        if (fabricInfo && fabricInfo.isFabric && fabricInfo.versionJsonPath && fs.existsSync(fabricInfo.versionJsonPath) && assetIndexInfo) {
            try {
                const fJson = JSON.parse(fs.readFileSync(fabricInfo.versionJsonPath, 'utf8'));
                if (!fJson.assetIndex || !fJson.assetIndex.url) {
                    fJson.assetIndex = assetIndexInfo;
                    fJson.assets = assetIndexId;
                    fs.writeFileSync(fabricInfo.versionJsonPath, JSON.stringify(fJson, null, 2), 'utf8');
                }
            } catch (e) {}
        }

        const librariesDir = path.join(gameRoot, 'libraries');
        const nativesDir = path.join(gameRoot, 'natives');

        let versionConfig;
        let overridesConfig = {};

        if (fabricInfo && fabricInfo.isFabric) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-log', {
                    type: 'system',
                    text: `Fabric profili devrede: ${fabricInfo.versionName} (Temel: ${fabricInfo.inheritsFrom})`
                });
            }

            versionConfig = {
                number: fabricInfo.inheritsFrom,
                custom: fabricInfo.versionName,
                type: 'release'
            };

            overridesConfig = {
                minecraftJar: fabricInfo.vanillaJarPath,
                directory: path.join(gameRoot, 'versions', fabricInfo.versionName),
                versionJson: fabricInfo.versionJsonPath,
                gameDirectory: gameRoot,
                assetRoot: assetsDir,
                assetIndex: assetIndexId,
                libraryRoot: librariesDir,
                natives: nativesDir,
                cwd: gameRoot
            };
        } else {
            versionConfig = {
                number: config.version || '1.20.4',
                type: 'release'
            };
            overridesConfig = {
                gameDirectory: gameRoot,
                assetRoot: assetsDir,
                assetIndex: assetIndexId,
                libraryRoot: librariesDir,
                natives: nativesDir,
                cwd: gameRoot
            };
        }

        // Features object/array preventing is_demo_user
        const features = ['has_custom_resolution'];
        features.is_demo_user = false;
        features.has_custom_resolution = true;

        // Aikar's JVM Performance Flags (Low-end / RAM & FPS saver mode)
        const useAikarFlags = Boolean(config.aikarFlags !== undefined ? config.aikarFlags : settings.aikarFlags);
        const customArgs = [
            '-Dminecraft.api.env=custom',
            '-Dminecraft.api.auth.host=https://localhost',
            '-Dminecraft.api.account.host=https://localhost',
            '-Dminecraft.api.session.host=https://localhost',
            '-Dminecraft.api.services.host=https://localhost'
        ];

        if (useAikarFlags) {
            customArgs.push(
                "-XX:+UseG1GC",
                "-XX:+ParallelRefProcEnabled",
                "-XX:MaxGCPauseMillis=200",
                "-XX:+UnlockExperimentalVMOptions",
                "-XX:+DisableExplicitGC",
                "-XX:+AlwaysPreTouch",
                "-XX:G1NewSizePercent=30",
                "-XX:G1MaxNewSizePercent=40",
                "-XX:G1ReservePercent=20",
                "-XX:G1HeapWastePercent=5",
                "-XX:G1MixedGCCountTarget=4",
                "-XX:InitiatingHeapOccupancyPercent=15",
                "-XX:G1MixedGCLiveThresholdPercent=90",
                "-XX:G1RSetUpdatingPauseTimePercent=5",
                "-XX:SurvivorRatio=32",
                "-XX:+PerfDisableSharedMem"
            );

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-log', {
                    type: 'system',
                    text: "Aikar's JVM performans bayrakları aktif: G1GC & Düşük Gecikme Modu devrede."
                });
            }
        }

        const opts = {
            clientPackage: null,
            authorization: auth,
            root: gameRoot,
            assets: assetsDir,
            version: versionConfig,
            memory: {
                max: memoryMax,
                min: memoryMin
            },
            javaPath: javaExec,
            window: {
                width: parseInt(config.resolutionWidth, 10) || 925,
                height: parseInt(config.resolutionHeight, 10) || 530,
                fullscreen: Boolean(config.fullscreen)
            },
            features: features,
            overrides: overridesConfig,
            customArgs: customArgs.filter(arg => arg !== '--demo'),
            customLaunchArgs: ['--gameDir', gameRoot],
            skipAssets: false
        };

        // Intercept startMinecraft to strictly filter out '--demo' and unresolved '${quickPlay...}' templates
        launcher.startMinecraft = function (launchArguments) {
            const spawnOpts = {
                cwd: gameRoot,
                detached: false,
                windowsHide: true
            };

            let binary = this.options.javaPath || 'javaw';
            if (binary.toLowerCase().endsWith('java.exe')) {
                binary = binary.slice(0, -8) + 'javaw.exe';
            } else if (binary.toLowerCase() === 'java') {
                binary = 'javaw';
            }

            let cleanArguments = launchArguments.filter(arg => {
                if (typeof arg !== 'string') return true;
                const trimmed = arg.trim();
                if (trimmed === '--demo') return false;
                if (trimmed.startsWith('${quickPlay') || trimmed.includes('${quickPlay')) return false;
                return true;
            });

            // Guarantee username parameter
            const userIndex = cleanArguments.indexOf('--username');
            if (userIndex !== -1 && userIndex + 1 < cleanArguments.length) {
                cleanArguments[userIndex + 1] = playerName;
            } else if (userIndex === -1) {
                cleanArguments.push('--username', playerName);
            }

            // Guarantee uuid parameter
            const uuidIndex = cleanArguments.indexOf('--uuid');
            if (uuidIndex !== -1 && uuidIndex + 1 < cleanArguments.length) {
                cleanArguments[uuidIndex + 1] = playerUuid;
            }

            // Guarantee --gameDir parameter points to gameRoot
            const gameDirIdx = cleanArguments.indexOf('--gameDir');
            if (gameDirIdx !== -1 && gameDirIdx + 1 < cleanArguments.length) {
                cleanArguments[gameDirIdx + 1] = gameRoot;
            } else if (gameDirIdx === -1) {
                cleanArguments.push('--gameDir', gameRoot);
            }

            // Guarantee assetsDir and assetIndex parameters
            const assetsDirIdx = cleanArguments.indexOf('--assetsDir');
            if (assetsDirIdx !== -1 && assetsDirIdx + 1 < cleanArguments.length) {
                cleanArguments[assetsDirIdx + 1] = assetsDir;
            } else if (assetsDirIdx === -1) {
                cleanArguments.push('--assetsDir', assetsDir);
            }

            const assetIndexIdx = cleanArguments.indexOf('--assetIndex');
            if (assetIndexIdx !== -1 && assetIndexIdx + 1 < cleanArguments.length) {
                cleanArguments[assetIndexIdx + 1] = assetIndexId;
            } else if (assetIndexIdx === -1) {
                cleanArguments.push('--assetIndex', assetIndexId);
            }

            // Clean any unresolved auth or asset or game_directory templates
            cleanArguments = cleanArguments.map(arg => {
                if (typeof arg !== 'string') return arg;
                return arg
                    .replace(/\$\{game_directory\}/g, gameRoot)
                    .replace(/\$\{auth_player_name\}/g, playerName)
                    .replace(/\$\{auth_uuid\}/g, playerUuid)
                    .replace(/\$\{auth_access_token\}/g, 'null')
                    .replace(/\$\{user_properties\}/g, '{}')
                    .replace(/\$\{assets_root\}/g, assetsDir)
                    .replace(/\$\{game_assets\}/g, assetsDir)
                    .replace(/\$\{assets_index_name\}/g, assetIndexId);
            });

            // Guarantee that all Fabric libraries and KnotClient mainClass are in launchArguments
            if (fabricInfo && fabricInfo.isFabric) {
                const cpIndex = cleanArguments.indexOf('-cp');
                if (cpIndex !== -1 && cpIndex + 1 < cleanArguments.length) {
                    const currentCp = cleanArguments[cpIndex + 1];
                    const separator = process.platform === 'win32' ? ';' : ':';
                    const existingCpSet = new Set(currentCp.split(separator));

                    const missingLibs = fabricInfo.libraryPaths.filter(p => fs.existsSync(p) && !existingCpSet.has(p));
                    if (missingLibs.length > 0) {
                        cleanArguments[cpIndex + 1] = currentCp + separator + missingLibs.join(separator);
                    }

                    // Ensure vanilla jar is present in classpath if it exists
                    if (fs.existsSync(fabricInfo.vanillaJarPath) && !cleanArguments[cpIndex + 1].includes(fabricInfo.vanillaJarPath)) {
                        cleanArguments[cpIndex + 1] += separator + fabricInfo.vanillaJarPath;
                    }

                    // Ensure main class is KnotClient
                    if (cpIndex + 2 < cleanArguments.length && fabricInfo.mainClass) {
                        cleanArguments[cpIndex + 2] = fabricInfo.mainClass;
                    }
                }
            }

            const minecraft = child_process.spawn(binary, cleanArguments, spawnOpts);

            minecraft.stdout.on('data', (data) => {
                const text = data.toString('utf-8');
                this.emit('data', text);
            });

            minecraft.stderr.on('data', (data) => {
                const text = data.toString('utf-8');
                this.emit('data-error', text);
            });

            minecraft.on('error', (err) => {
                this.emit('process-error', err.message || String(err));
            });

            minecraft.on('close', (code) => {
                this.emit('close', code);
            });

            return minecraft;
        };

        // Forward all events via IPC to renderer
        launcher.on('debug', (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-log', { type: 'debug', text: String(e) });
            }
        });

        launcher.on('data', (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-log', { type: 'data', text: String(e) });
            }
        });

        launcher.on('data-error', (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-log', { type: 'error', text: String(e) });
            }
        });

        launcher.on('process-error', (errMsg) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-error', `Java Hatası: ${errMsg}`);
            }
        });

        launcher.on('progress', (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-progress', e);
            }
        });

        launcher.on('speed', (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-speed', e);
            }
        });

        launcher.on('download-status', (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-download-status', e);
            }
        });

        launcher.on('close', (code) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-close', code);
            }
        });

        // Force Windows High Performance GPU Preference (Registry Injection)
        if (process.platform === 'win32' && opts.javaPath) {
            try {
                child_process.execSync(
                    `reg add "HKCU\\SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences" /v "${opts.javaPath}" /t REG_SZ /d "GpuPreference=2;" /f`,
                    { windowsHide: true, stdio: 'ignore' }
                );
                console.log('[Sistem] Harici GPU zorlaması aktif edildi.');
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launcher-log', {
                        type: 'system',
                        text: '[Sistem] Harici GPU zorlaması aktif edildi.'
                    });
                }
            } catch (err) {
                console.warn('[Sistem] GPU Yüksek Performans tercihi ayarlanamadı, devam ediliyor...', err);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launcher-log', {
                        type: 'system',
                        text: '[Sistem] GPU Yüksek Performans tercihi ayarlanamadı, devam ediliyor...'
                    });
                }
            }
        }

        // Launch game
        launcher.launch(opts).then(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-started');
            }
        }).catch((err) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('launcher-error', err.message || String(err));
            }
        });

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
