const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Window Controls
    minimize: () => ipcRenderer.send('window-minimize'),
    close: () => ipcRenderer.send('window-close'),

    // Settings & System Info
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    getInstalledVersions: (customDir) => ipcRenderer.invoke('get-installed-versions', customDir),
    getMojangVersions: () => ipcRenderer.invoke('get-mojang-versions'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    selectGameDir: () => ipcRenderer.invoke('select-game-dir'),
    selectJavaPath: () => ipcRenderer.invoke('select-java-path'),
    openSpecialFolder: (folderType) => ipcRenderer.invoke('open-special-folder', folderType),

    // Screenshots Gallery
    getScreenshots: () => ipcRenderer.invoke('get-screenshots'),
    getScreenshotFull: (filePath) => ipcRenderer.invoke('get-screenshot-full', filePath),
    showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
    copyScreenshotToClipboard: (filePath) => ipcRenderer.invoke('copy-screenshot-to-clipboard', filePath),

    // Java Verification & Preparation
    checkJava: () => ipcRenderer.invoke('check-java'),
    onJavaDownloadProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('java-download-progress', handler);
        return () => ipcRenderer.removeListener('java-download-progress', handler);
    },

    // Launcher Actions
    launchGame: (config) => ipcRenderer.invoke('launch-game', config),

    // Event Listeners
    onLog: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('launcher-log', handler);
        return () => ipcRenderer.removeListener('launcher-log', handler);
    },
    onProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('launcher-progress', handler);
        return () => ipcRenderer.removeListener('launcher-progress', handler);
    },
    onSpeed: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('launcher-speed', handler);
        return () => ipcRenderer.removeListener('launcher-speed', handler);
    },
    onDownloadStatus: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('launcher-download-status', handler);
        return () => ipcRenderer.removeListener('launcher-download-status', handler);
    },
    onStarted: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('launcher-started', handler);
        return () => ipcRenderer.removeListener('launcher-started', handler);
    },
    onClose: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('launcher-close', handler);
        return () => ipcRenderer.removeListener('launcher-close', handler);
    },
    onError: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('launcher-error', handler);
        return () => ipcRenderer.removeListener('launcher-error', handler);
    },
    getActiveGamePath: () => ipcRenderer.invoke('get-active-game-path'),
    getDefaultGamePath: () => ipcRenderer.invoke('get-default-game-path'),
    onGameDirectoryChanged: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('game-directory-changed', handler);
        return () => ipcRenderer.removeListener('game-directory-changed', handler);
    }
});
