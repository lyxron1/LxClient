// DOM Elements - Window Controls & Titlebar
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const btnSettings = document.getElementById('btn-settings');
const btnQuickFolder = document.getElementById('btn-quick-folder');
const quickFolderMenu = document.getElementById('quick-folder-menu');

// DOM Elements - Main Form
const usernameInput = document.getElementById('username-input');
const btnOpenVersionPicker = document.getElementById('btn-open-version-picker');
const versionTriggerDot = document.getElementById('version-trigger-dot');
const versionTriggerName = document.getElementById('version-trigger-name');
const versionTriggerBadge = document.getElementById('version-trigger-badge');
const versionPickerModal = document.getElementById('version-picker-modal');
const btnCloseVersionPicker = document.getElementById('btn-close-version-picker');
const versionSearchInput = document.getElementById('version-search-input');
const btnClearVersionSearch = document.getElementById('btn-clear-version-search');
const versionCountBadge = document.getElementById('version-count-badge');
const versionPickerList = document.getElementById('version-picker-list');
const versionPickerEmpty = document.getElementById('version-picker-empty');
const ramSlider = document.getElementById('ram-slider');
const ramDisplay = document.getElementById('ram-display');
const ramMinLabel = document.getElementById('ram-min-label');
const ramMaxLabel = document.getElementById('ram-max-label');
const launchBtn = document.getElementById('launch-button');

// DOM Elements - Player Avatar & Status
const playerAvatar = document.getElementById('player-avatar');
const playerDisplayName = document.getElementById('player-display-name');
const stateBadge = document.getElementById('state-badge');

// DOM Elements - Progress & Status Indicators
const statusText = document.getElementById('status-text');
const progressPercent = document.getElementById('progress-percent');
const progressBar = document.getElementById('progress-bar');
const speedIndicator = document.getElementById('speed-indicator');
const fileIndicator = document.getElementById('file-indicator');

// DOM Elements - Console Terminal
const logOutput = document.getElementById('log-output');
const btnClearLog = document.getElementById('btn-clear-log');
const btnToggleLog = document.getElementById('btn-toggle-log');

// DOM Elements - Settings Modal
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingGameDir = document.getElementById('setting-game-dir');
const btnBrowseDir = document.getElementById('btn-browse-dir');
const settingResW = document.getElementById('setting-res-w');
const settingResH = document.getElementById('setting-res-h');
const settingFullscreen = document.getElementById('setting-fullscreen');
const settingAikarFlags = document.getElementById('setting-aikar-flags');
const settingJavaPath = document.getElementById('setting-java-path');
const btnBrowseJava = document.getElementById('btn-browse-java');
const btnResetSettings = document.getElementById('btn-reset-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');

// DOM Elements - Screenshots Modal
const btnScreenshots = document.getElementById('btn-screenshots');
const screenshotsModal = document.getElementById('screenshots-modal');
const btnCloseScreenshots = document.getElementById('btn-close-screenshots');
const btnOpenScreenshotsFolder = document.getElementById('btn-open-screenshots-folder');
const screenshotsCount = document.getElementById('screenshots-count');
const screenshotsGridView = document.getElementById('screenshots-grid-view');
const screenshotsGrid = document.getElementById('screenshots-grid');
const screenshotsEmpty = document.getElementById('screenshots-empty');
const btnEmptyOpenFolder = document.getElementById('btn-empty-open-folder');
const screenshotPreviewView = document.getElementById('screenshot-preview-view');
const btnPreviewBack = document.getElementById('btn-preview-back');
const previewFilename = document.getElementById('preview-filename');
const previewDate = document.getElementById('preview-date');
const previewImage = document.getElementById('preview-image');
const btnShowInFolder = document.getElementById('btn-show-in-folder');
const btnCopyClipboard = document.getElementById('btn-copy-clipboard');
const copyClipboardIcon = document.getElementById('copy-clipboard-icon');
const copyClipboardText = document.getElementById('copy-clipboard-text');

// Constants
const STEVE_FALLBACK_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath fill='%234a3219' d='M0 0h8v2H0zM0 2h1v1H0zm7 0h1v1H7z'/%3E%3Cpath fill='%23cbb38b' d='M1 2h6v1H1zM0 3h8v3H0z'/%3E%3Cpath fill='%23ffffff' d='M1 4h1v1H1zm4 0h1v1H5z'/%3E%3Cpath fill='%232c1b77' d='M2 4h1v1H2zm4 0h1v1H6z'/%3E%3Cpath fill='%23875638' d='M3 5h2v1H3z'/%3E%3Cpath fill='%23442113' d='M2 6h4v1H2z'/%3E%3Cpath fill='%23875638' d='M1 7h6v1H1z'/%3E%3C/svg%3E";
const POPULAR_VERSIONS = ['1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9'];
let officialReleases = [...POPULAR_VERSIONS];

// State
let currentSettings = {};
let systemDefaultGameDir = '';
let selectedVersion = '1.20.4';
let currentInstalledVersions = [];
let activeVersionFilter = 'all';
let versionSearchQuery = '';

// Window Controls
btnMinimize.addEventListener('click', () => {
    window.api.minimize();
});

btnClose.addEventListener('click', () => {
    window.api.close();
});

// Quick Folder Access Menu
if (btnQuickFolder && quickFolderMenu) {
    btnQuickFolder.addEventListener('click', (e) => {
        e.stopPropagation();
        quickFolderMenu.classList.toggle('hidden');
    });

    document.querySelectorAll('.folder-item').forEach((item) => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const folderType = item.getAttribute('data-folder');
            quickFolderMenu.classList.add('hidden');

            if (folderType && window.api && window.api.openSpecialFolder) {
                const res = await window.api.openSpecialFolder(folderType);
                if (res && res.success) {
                    addLog(`Klasör açıldı: ${res.path}`, 'system');
                } else if (res && res.error) {
                    addLog(`Klasör açılamadı: ${res.error}`, 'error');
                }
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (!quickFolderMenu.contains(e.target) && e.target !== btnQuickFolder && !btnQuickFolder.contains(e.target)) {
            quickFolderMenu.classList.add('hidden');
        }
    });
}

// -------------------------------------------------------------
// Screenshots Gallery Management
// -------------------------------------------------------------
let currentActiveScreenshot = null;

async function openScreenshotsModal() {
    screenshotsModal.classList.remove('hidden');
    backToGalleryView();
    await loadScreenshots();
}

function closeScreenshotsModal() {
    screenshotsModal.classList.add('hidden');
    backToGalleryView();
}

function backToGalleryView() {
    screenshotPreviewView.classList.add('hidden');
    screenshotsGridView.classList.remove('hidden');
    currentActiveScreenshot = null;
}

async function loadScreenshots() {
    if (!screenshotsGrid || !window.api || !window.api.getScreenshots) return;

    screenshotsGrid.innerHTML = '';
    screenshotsCount.textContent = 'Yükleniyor...';

    try {
        const items = await window.api.getScreenshots();
        screenshotsCount.textContent = `${items.length} Görsel`;

        if (items.length === 0) {
            screenshotsEmpty.classList.remove('hidden');
            screenshotsGrid.classList.add('hidden');
            return;
        }

        screenshotsEmpty.classList.add('hidden');
        screenshotsGrid.classList.remove('hidden');

        for (const item of items) {
            const card = document.createElement('div');
            card.className = 'screenshot-card';
            card.title = `${item.name} (${item.dateStr})`;

            const thumbWrapper = document.createElement('div');
            thumbWrapper.className = 'screenshot-thumb-wrapper';

            const img = document.createElement('img');
            img.className = 'screenshot-thumb';
            img.loading = 'lazy';
            img.alt = item.name;
            if (item.thumbnail) {
                img.src = item.thumbnail;
            } else {
                img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'%3E%3Cpath d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/%3E%3C/svg%3E";
            }

            thumbWrapper.appendChild(img);

            const info = document.createElement('div');
            info.className = 'screenshot-info';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'screenshot-name';
            nameSpan.textContent = item.name;

            const dateSpan = document.createElement('span');
            dateSpan.className = 'screenshot-date';
            dateSpan.textContent = item.dateStr;

            info.appendChild(nameSpan);
            info.appendChild(dateSpan);

            card.appendChild(thumbWrapper);
            card.appendChild(info);

            card.addEventListener('click', () => {
                showScreenshotPreview(item);
            });

            screenshotsGrid.appendChild(card);
        }
    } catch (err) {
        addLog(`Ekran görüntüleri yüklenirken hata: ${err.message}`, 'error');
        screenshotsCount.textContent = 'Hata';
    }
}

async function showScreenshotPreview(item) {
    currentActiveScreenshot = item;
    screenshotsGridView.classList.add('hidden');
    screenshotPreviewView.classList.remove('hidden');

    previewFilename.textContent = item.name;
    previewDate.textContent = item.dateStr;

    // Use thumbnail as immediate placeholder while full res loads
    if (item.thumbnail) {
        previewImage.src = item.thumbnail;
    }

    try {
        const fullData = await window.api.getScreenshotFull(item.path);
        if (fullData) {
            previewImage.src = fullData;
        }
    } catch (err) {
        console.warn('Tam boyutlu görsel yüklenemedi:', err);
    }
}

// Event Listeners - Screenshots Modal
if (btnScreenshots) {
    btnScreenshots.addEventListener('click', openScreenshotsModal);
}

if (btnCloseScreenshots) {
    btnCloseScreenshots.addEventListener('click', closeScreenshotsModal);
}

if (screenshotsModal) {
    screenshotsModal.addEventListener('click', (e) => {
        if (e.target === screenshotsModal) {
            closeScreenshotsModal();
        }
    });
}

if (btnPreviewBack) {
    btnPreviewBack.addEventListener('click', backToGalleryView);
}

if (btnOpenScreenshotsFolder) {
    btnOpenScreenshotsFolder.addEventListener('click', () => {
        window.api.openSpecialFolder('screenshots');
    });
}

if (btnEmptyOpenFolder) {
    btnEmptyOpenFolder.addEventListener('click', () => {
        window.api.openSpecialFolder('screenshots');
    });
}

if (btnShowInFolder) {
    btnShowInFolder.addEventListener('click', async () => {
        if (currentActiveScreenshot && currentActiveScreenshot.path) {
            await window.api.showItemInFolder(currentActiveScreenshot.path);
            addLog(`Dosya gezgininde gösterildi: ${currentActiveScreenshot.name}`, 'system');
        }
    });
}

if (btnCopyClipboard) {
    btnCopyClipboard.addEventListener('click', async () => {
        if (currentActiveScreenshot && currentActiveScreenshot.path) {
            const res = await window.api.copyScreenshotToClipboard(currentActiveScreenshot.path);
            if (res && res.success) {
                copyClipboardIcon.textContent = '✓';
                copyClipboardText.textContent = 'Kopyalandı!';
                btnCopyClipboard.style.background = '#059669';
                setTimeout(() => {
                    copyClipboardIcon.textContent = '📋';
                    copyClipboardText.textContent = 'Panoya Kopyala';
                    btnCopyClipboard.style.background = '';
                }, 2000);
                addLog(`Ekran görüntüsü panoya kopyalandı: ${currentActiveScreenshot.name}`, 'system');
            } else {
                addLog('Görsel panoya kopyalanamadı.', 'error');
            }
        }
    });
}

// Global ESC key listener to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (versionPickerModal && !versionPickerModal.classList.contains('hidden')) {
            closeVersionPickerModal();
        } else if (screenshotsModal && !screenshotsModal.classList.contains('hidden')) {
            if (screenshotPreviewView && !screenshotPreviewView.classList.contains('hidden')) {
                backToGalleryView();
            } else {
                closeScreenshotsModal();
            }
        } else if (settingsModal && !settingsModal.classList.contains('hidden')) {
            closeSettingsModal();
        } else if (quickFolderMenu && !quickFolderMenu.classList.contains('hidden')) {
            quickFolderMenu.classList.add('hidden');
        }
    }
});

// Dynamic Minecraft Skin Avatar (Requirement 2: mc-heads.net with minotar and offline Steve fallback)
let avatarDebounceTimer = null;

playerAvatar.onerror = () => {
    playerAvatar.src = STEVE_FALLBACK_DATA_URI;
};

function handleUsernameAvatarChange(rawName) {
    playerDisplayName.textContent = rawName || 'Oyuncu';

    clearTimeout(avatarDebounceTimer);
    avatarDebounceTimer = setTimeout(() => {
        updatePlayerAvatar(rawName);
    }, 400);
}

usernameInput.addEventListener('input', (e) => {
    handleUsernameAvatarChange(e.target.value.trim());
});

usernameInput.addEventListener('change', (e) => {
    handleUsernameAvatarChange(e.target.value.trim());
});

function updatePlayerAvatar(name) {
    if (!name) {
        playerAvatar.src = STEVE_FALLBACK_DATA_URI;
        return;
    }

    const primaryUrl = `https://mc-heads.net/avatar/${encodeURIComponent(name)}/100`;
    const secondaryUrl = `https://minotar.net/avatar/${encodeURIComponent(name)}/100`;

    const imgTest = new Image();
    imgTest.onload = () => {
        playerAvatar.src = primaryUrl;
    };
    imgTest.onerror = () => {
        const imgFallback = new Image();
        imgFallback.onload = () => {
            playerAvatar.src = secondaryUrl;
        };
        imgFallback.onerror = () => {
            playerAvatar.src = STEVE_FALLBACK_DATA_URI;
        };
        imgFallback.src = secondaryUrl;
    };
    imgTest.src = primaryUrl;
}

// RAM Slider Formatting
function updateRamDisplay(mbValue) {
    const gb = (mbValue / 1024).toFixed(1);
    ramDisplay.textContent = `${mbValue} MB (${gb} GB)`;
}

ramSlider.addEventListener('input', (e) => {
    updateRamDisplay(parseInt(e.target.value, 10));
});

// Helper to format version display name
function formatVersionDisplayName(ver) {
    if (!ver) return '1.20.4';
    const lower = ver.toLowerCase();
    if (lower.includes('minecraft') || lower.includes('fabric')) {
        return ver;
    }
    return `Minecraft ${ver}`;
}

// Update selected version state & trigger button UI
function setSelectedVersion(ver, skipSave = false) {
    if (!ver) return;
    selectedVersion = ver;
    const isInstalled = currentInstalledVersions.includes(ver);
    const isFabric = ver.toLowerCase().includes('fabric');

    if (versionTriggerDot) {
        versionTriggerDot.textContent = isInstalled ? '●' : '⬇';
        versionTriggerDot.className = `version-status-dot ${isInstalled ? 'installed' : 'downloadable'}`;
    }
    if (versionTriggerName) {
        versionTriggerName.textContent = formatVersionDisplayName(ver);
    }
    if (versionTriggerBadge) {
        if (isInstalled) {
            versionTriggerBadge.textContent = isFabric ? 'Fabric Hazır' : 'Yüklü / Hazır';
            versionTriggerBadge.className = 'version-trigger-badge installed';
        } else {
            versionTriggerBadge.textContent = 'İndirilebilir';
            versionTriggerBadge.className = 'version-trigger-badge downloadable';
        }
    }

    currentSettings.lastVersion = ver;
    if (!skipSave && window.api && window.api.saveSettings) {
        window.api.saveSettings(currentSettings);
    }
}

// Render dynamic version list inside Version Picker Modal
function renderVersionPickerList() {
    if (!versionPickerList) return;
    versionPickerList.innerHTML = '';

    const installedArr = currentInstalledVersions || [];
    const installedSet = new Set(installedArr);
    const downloadableArr = officialReleases.filter(v => !installedSet.has(v));

    let allItems = [
        ...installedArr.map(v => ({ id: v, isInstalled: true })),
        ...downloadableArr.map(v => ({ id: v, isInstalled: false }))
    ];

    // Filter by search query
    const query = versionSearchQuery.trim().toLowerCase();
    if (query) {
        allItems = allItems.filter(item => {
            const name = formatVersionDisplayName(item.id).toLowerCase();
            const raw = item.id.toLowerCase();
            return name.includes(query) || raw.includes(query);
        });
    }

    // Filter by active pill
    if (activeVersionFilter === 'installed') {
        allItems = allItems.filter(item => item.isInstalled);
    } else if (activeVersionFilter === 'fabric') {
        allItems = allItems.filter(item => item.id.toLowerCase().includes('fabric'));
    } else if (activeVersionFilter === 'vanilla') {
        allItems = allItems.filter(item => !item.id.toLowerCase().includes('fabric'));
    }

    // Update count badge
    if (versionCountBadge) {
        versionCountBadge.textContent = `${allItems.length} Sürüm`;
    }

    // Handle empty state
    if (allItems.length === 0) {
        if (versionPickerEmpty) versionPickerEmpty.classList.remove('hidden');
        return;
    } else {
        if (versionPickerEmpty) versionPickerEmpty.classList.add('hidden');
    }

    // Render items
    for (const item of allItems) {
        const row = document.createElement('div');
        row.className = `version-row-item ${item.id === selectedVersion ? 'selected' : ''}`;

        const isFabric = item.id.toLowerCase().includes('fabric');
        const icon = item.isInstalled ? '●' : '⬇';
        const tagText = item.isInstalled ? (isFabric ? 'Fabric Hazır' : 'Hemen Oyna') : 'İndirilebilir';
        const tagClass = item.isInstalled ? 'tag-installed' : 'tag-downloadable';
        const subText = item.isInstalled
            ? (isFabric ? 'Yerel Fabric Sürümü' : 'Yerel Cihazda Yüklü')
            : 'Mojang Resmi Sürümü (Otomatik İndirilecek)';

        row.innerHTML = `
            <div class="version-row-left">
                <span class="version-row-icon">${icon}</span>
                <div class="version-row-meta">
                    <span class="version-row-title">${formatVersionDisplayName(item.id)}</span>
                    <span class="version-row-sub">${subText}</span>
                </div>
            </div>
            <div class="version-row-right">
                <span class="version-row-tag ${tagClass}">${tagText}</span>
                ${item.id === selectedVersion ? '<span class="version-selected-check">✓</span>' : ''}
            </div>
        `;

        row.addEventListener('click', () => {
            setSelectedVersion(item.id);
            closeVersionPickerModal();
        });

        versionPickerList.appendChild(row);
    }
}

// Modal open/close controls
function openVersionPickerModal() {
    if (!versionPickerModal) return;
    versionPickerModal.classList.remove('hidden');
    if (versionSearchInput) {
        versionSearchInput.value = versionSearchQuery;
        setTimeout(() => versionSearchInput.focus(), 60);
    }
    renderVersionPickerList();
    setTimeout(() => {
        const selectedEl = versionPickerList.querySelector('.version-row-item.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, 80);
}

function closeVersionPickerModal() {
    if (!versionPickerModal) return;
    versionPickerModal.classList.add('hidden');
}

// Version Picker Event Listeners
if (btnOpenVersionPicker) {
    btnOpenVersionPicker.addEventListener('click', () => {
        if (!launchBtn.disabled) {
            openVersionPickerModal();
        }
    });
}

if (btnCloseVersionPicker) {
    btnCloseVersionPicker.addEventListener('click', closeVersionPickerModal);
}

if (versionPickerModal) {
    versionPickerModal.addEventListener('click', (e) => {
        if (e.target === versionPickerModal) {
            closeVersionPickerModal();
        }
    });
}

if (versionSearchInput) {
    versionSearchInput.addEventListener('input', (e) => {
        versionSearchQuery = e.target.value;
        if (btnClearVersionSearch) {
            if (versionSearchQuery.length > 0) {
                btnClearVersionSearch.classList.remove('hidden');
            } else {
                btnClearVersionSearch.classList.add('hidden');
            }
        }
        renderVersionPickerList();
    });
}

if (btnClearVersionSearch) {
    btnClearVersionSearch.addEventListener('click', () => {
        versionSearchQuery = '';
        if (versionSearchInput) {
            versionSearchInput.value = '';
            versionSearchInput.focus();
        }
        btnClearVersionSearch.classList.add('hidden');
        renderVersionPickerList();
    });
}

document.querySelectorAll('.version-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.version-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeVersionFilter = pill.getAttribute('data-filter') || 'all';
        renderVersionPickerList();
    });
});

// Requirement 1: Update Version Dropdown with Mojang releases and installed custom versions
function updateVersionDropdown(installedList = [], preferredVersion = null) {
    currentInstalledVersions = installedList || [];
    const targetVer = preferredVersion || selectedVersion || currentSettings.lastVersion || '1.20.4';

    const installedSet = new Set(currentInstalledVersions);
    const downloadableArr = officialReleases.filter(v => !installedSet.has(v));
    const allKnown = [...currentInstalledVersions, ...downloadableArr];

    if (allKnown.includes(targetVer)) {
        setSelectedVersion(targetVer, true);
    } else if (allKnown.length > 0) {
        setSelectedVersion(allKnown[0], true);
    } else {
        setSelectedVersion(targetVer, true);
    }

    renderVersionPickerList();
}

// Fetch all official releases dynamically from Mojang Manifest
async function loadOfficialVersions(installedList = []) {
    try {
        let releases = null;
        if (window.api && window.api.getMojangVersions) {
            releases = await window.api.getMojangVersions();
        }
        if (!releases || releases.length === 0) {
            const res = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data.versions)) {
                    releases = data.versions
                        .filter(v => v.type === 'release')
                        .map(v => v.id);
                }
            }
        }

        if (releases && releases.length > 0) {
            officialReleases = releases;
            addLog(`Mojang manifestosundan ${releases.length} resmi sürüm çekildi (${releases[0]} - ${releases[releases.length - 1]}).`, 'system');
            updateVersionDropdown(installedList, selectedVersion || currentSettings.lastVersion);
        }
    } catch (err) {
        console.warn('Mojang manifestosu alınamadı:', err);
    }
}

// Logger Helpers (Requirement 2 & 4: Stream hidden CMD stdout/stderr lines)
function addLog(text, type = 'system') {
    if (!text) return;
    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    logOutput.appendChild(line);

    if (logOutput.children.length > 500) {
        logOutput.removeChild(logOutput.firstChild);
    }

    logOutput.scrollTop = logOutput.scrollHeight;
}

btnClearLog.addEventListener('click', () => {
    logOutput.innerHTML = '<div class="log-line log-system">[Sistem] Konsol temizlendi.</div>';
});

let isLogExpanded = false;
btnToggleLog.addEventListener('click', () => {
    const consoleBox = document.querySelector('.console-box');
    isLogExpanded = !isLogExpanded;
    if (isLogExpanded) {
        consoleBox.style.flex = '2';
        btnToggleLog.textContent = 'Daralt';
    } else {
        consoleBox.style.flex = '1';
        btnToggleLog.textContent = 'Genişlet';
    }
});

// Helper to resolve Game Directory input element regardless of ID
function getGameDirInput() {
    return document.getElementById('setting-game-dir') ||
           document.getElementById('game-directory-input') ||
           document.getElementById('game-dir-input');
}

// Settings Modal Management (Requirement 4: Game Directory selection & persistence)
async function openSettingsModal() {
    if (!systemDefaultGameDir && window.api && window.api.getDefaultGamePath) {
        systemDefaultGameDir = await window.api.getDefaultGamePath();
    }
    const inputEl = getGameDirInput();
    const storedDir = localStorage.getItem('lx_gameDirectory');
    const displayPath = (currentSettings.gamePath || currentSettings.gameDirectory || storedDir || systemDefaultGameDir || '').trim();
    if (inputEl) {
        inputEl.value = displayPath;
    }
    settingResW.value = currentSettings.resolutionWidth || 925;
    settingResH.value = currentSettings.resolutionHeight || 530;
    settingFullscreen.checked = Boolean(currentSettings.fullscreen);
    settingAikarFlags.checked = Boolean(currentSettings.aikarFlags);
    settingJavaPath.value = currentSettings.javaPath || '';

    settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
    settingsModal.classList.add('hidden');
}

btnSettings.addEventListener('click', openSettingsModal);
btnCloseSettings.addEventListener('click', closeSettingsModal);

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        closeSettingsModal();
    }
});

btnBrowseDir.addEventListener('click', async () => {
    const selectedDir = await window.api.selectGameDir();
    if (selectedDir && typeof selectedDir === 'string' && selectedDir.trim().length > 0) {
        const cleanDir = selectedDir.trim();
        const inputEl = getGameDirInput();
        if (inputEl) inputEl.value = cleanDir;
        currentSettings.gamePath = cleanDir;
        currentSettings.gameDirectory = cleanDir;
        localStorage.setItem('lx_gameDirectory', cleanDir);
        await window.api.saveSettings(currentSettings);
        addLog(`Özel oyun dizini seçildi ve kaydedildi: ${cleanDir}`, 'system');

        // Refresh installed versions for newly selected path
        try {
            const installed = await window.api.getInstalledVersions(cleanDir);
            updateVersionDropdown(installed, currentSettings.lastVersion);
        } catch (e) {}
    }
});

btnBrowseJava.addEventListener('click', async () => {
    const selectedJava = await window.api.selectJavaPath();
    if (selectedJava) {
        settingJavaPath.value = selectedJava;
    }
});

btnResetSettings.addEventListener('click', async () => {
    if (!systemDefaultGameDir && window.api && window.api.getDefaultGamePath) {
        systemDefaultGameDir = await window.api.getDefaultGamePath();
    }
    const inputEl = getGameDirInput();
    if (inputEl) inputEl.value = systemDefaultGameDir;
    currentSettings.gamePath = systemDefaultGameDir;
    currentSettings.gameDirectory = systemDefaultGameDir;
    localStorage.removeItem('lx_gameDirectory');
    settingResW.value = 925;
    settingResH.value = 530;
    settingFullscreen.checked = false;
    settingAikarFlags.checked = false;
    settingJavaPath.value = '';
    await window.api.saveSettings(currentSettings);
    addLog('Ayarlar varsayılana döndürüldü.', 'system');
});

btnSaveSettings.addEventListener('click', async () => {
    const inputEl = getGameDirInput();
    const chosenDir = (inputEl ? inputEl.value.trim() : '') || currentSettings.gamePath || currentSettings.gameDirectory || localStorage.getItem('lx_gameDirectory') || systemDefaultGameDir;
    currentSettings.gameDirectory = chosenDir;
    currentSettings.gamePath = chosenDir;
    localStorage.setItem('lx_gameDirectory', chosenDir);
    currentSettings.resolutionWidth = parseInt(settingResW.value, 10) || 925;
    currentSettings.resolutionHeight = parseInt(settingResH.value, 10) || 530;
    currentSettings.fullscreen = settingFullscreen.checked;
    currentSettings.aikarFlags = settingAikarFlags.checked;
    currentSettings.javaPath = settingJavaPath.value.trim();
    currentSettings.ram = parseInt(ramSlider.value, 10);
    currentSettings.lastUsername = usernameInput.value.trim();
    currentSettings.lastVersion = selectedVersion;

    await window.api.saveSettings({
        ...currentSettings,
        gamePath: chosenDir,
        gameDirectory: chosenDir
    });
    addLog(`Ayarlar kaydedildi. Oyun dizini: ${chosenDir}`, 'system');

    // If game directory changed, refresh installed versions
    const activeDir = chosenDir || systemDefaultGameDir;
    const installed = await window.api.getInstalledVersions(activeDir);
    updateVersionDropdown(installed, currentSettings.lastVersion);

    closeSettingsModal();
});

// Initialize System Info & Settings
async function initSystemInfo() {
    try {
        const sysInfo = await window.api.getSystemInfo();
        const totalMemMB = sysInfo.totalMemMB;
        systemDefaultGameDir = sysInfo.defaultGameDir;
        currentSettings = sysInfo.settings || {};

        const storedDir = localStorage.getItem('lx_gameDirectory');
        if (storedDir && typeof storedDir === 'string' && storedDir.trim().length > 0) {
            currentSettings.gamePath = storedDir.trim();
            currentSettings.gameDirectory = storedDir.trim();
        }

        // Configure RAM Slider
        ramSlider.min = 1024;
        ramSlider.max = totalMemMB;
        ramSlider.step = 256;

        ramMinLabel.textContent = 'Min: 1.0 GB';
        ramMaxLabel.textContent = `Maks: ${(totalMemMB / 1024).toFixed(1)} GB`;

        const savedRam = currentSettings.ram && currentSettings.ram <= totalMemMB && currentSettings.ram >= 1024
            ? currentSettings.ram
            : (totalMemMB <= 4096 ? Math.min(2560, totalMemMB - 512) : 4096);

        ramSlider.value = savedRam;
        updateRamDisplay(savedRam);

        // Restore last user profile
        if (currentSettings.lastUsername && currentSettings.lastUsername.trim()) {
            usernameInput.value = currentSettings.lastUsername;
            playerDisplayName.textContent = currentSettings.lastUsername;
            updatePlayerAvatar(currentSettings.lastUsername);
        } else {
            usernameInput.value = '';
            playerDisplayName.textContent = 'Oyuncu';
            updatePlayerAvatar('');
        }

        // Build version dropdown with installed versions & fetch Mojang releases
        updateVersionDropdown(sysInfo.installedVersions, currentSettings.lastVersion);
        loadOfficialVersions(sysInfo.installedVersions);

        addLog(`Sistem RAM'i: ${(totalMemMB / 1024).toFixed(1)} GB (${totalMemMB} MB).`, 'system');
        if (sysInfo.installedVersions && sysInfo.installedVersions.length > 0) {
            addLog(`Yüklü sürümler tespit edildi: ${sysInfo.installedVersions.join(', ')}`, 'system');
        }
    } catch (err) {
        addLog(`Sistem bilgisi alınırken hata: ${err.message}`, 'error');
    }
}

// UI State Management
function setLaunchingState(isLaunching, message = '') {
    launchBtn.disabled = isLaunching;
    usernameInput.disabled = isLaunching;
    if (btnOpenVersionPicker) btnOpenVersionPicker.disabled = isLaunching;
    ramSlider.disabled = isLaunching;
    btnSettings.disabled = isLaunching;

    if (isLaunching) {
        stateBadge.textContent = 'Çalışıyor';
        stateBadge.className = 'badge-busy';
        launchBtn.innerHTML = '<span class="launch-icon">⏳</span><span class="launch-label">BAŞLATILIYOR...</span>';
        if (message) statusText.textContent = message;
    } else {
        stateBadge.textContent = 'Hazır';
        stateBadge.className = 'badge-ready';
        launchBtn.innerHTML = '<span class="launch-icon">▶</span><span class="launch-label">OYUNU BAŞLAT</span>';
        progressBar.style.width = '0%';
        progressPercent.textContent = '0%';
        speedIndicator.textContent = '-- KB/s';
        fileIndicator.textContent = 'Beklemede';
    }
}

// Launch Game Action
launchBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (!username) {
        statusText.textContent = 'Lütfen bir kullanıcı adı girin!';
        usernameInput.focus();
        return;
    }

    const version = selectedVersion;
    const ram = parseInt(ramSlider.value, 10);

    // Auto save preferences
    currentSettings.lastUsername = username;
    currentSettings.lastVersion = version;
    currentSettings.ram = ram;
    window.api.saveSettings(currentSettings);

    const activeGameDir = (currentSettings.gamePath || currentSettings.gameDirectory || localStorage.getItem('lx_gameDirectory') || systemDefaultGameDir || '').trim();

    setLaunchingState(true, 'Oyun dosyaları kontrol ediliyor...');
    addLog(`Oyun başlatılıyor: ${username} (Sürüm: ${version}, RAM: ${ram}M)...`, 'system');
    addLog(`Oyun Dizini: ${activeGameDir}`, 'system');
    addLog('Çok Oyunculu (Multiplayer) kilidi açıldı ve uyarılar bypass edildi.', 'system');

    try {
        const result = await window.api.launchGame({
            username: username,
            version: version,
            memoryMax: ram,
            gameDirectory: activeGameDir,
            resolutionWidth: currentSettings.resolutionWidth || 925,
            resolutionHeight: currentSettings.resolutionHeight || 530,
            fullscreen: Boolean(currentSettings.fullscreen),
            javaPath: currentSettings.javaPath || '',
            aikarFlags: Boolean(currentSettings.aikarFlags)
        });

        if (!result.success) {
            addLog(`Başlatma hatası: ${result.error}`, 'error');
            statusText.textContent = 'Başlatma hatası!';
            setLaunchingState(false);
        }
    } catch (err) {
        addLog(`Bağlantı hatası: ${err.message}`, 'error');
        statusText.textContent = 'Bağlantı hatası!';
        setLaunchingState(false);
    }
});

// IPC Event Listeners from Preload
window.api.onProgress((e) => {
    if (!e || typeof e.task === 'undefined' || typeof e.total === 'undefined') return;
    const percent = Math.min(100, Math.max(0, Math.round((e.task / e.total) * 100)));
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;

    const typeLabels = {
        assets: 'Varlıklar (Sesler & Dokular)',
        classes: 'Oyun Sınıfları & Kütüphaneler',
        natives: 'Platform Dosyaları',
        java: 'Java Çalışma Ortamı (JRE)'
    };

    const label = typeLabels[e.type] || e.type || 'Dosyalar';
    statusText.textContent = `${label} indiriliyor... (${e.task}/${e.total})`;
    fileIndicator.textContent = `${e.task} / ${e.total}`;
});

window.api.onSpeed((speed) => {
    if (typeof speed !== 'number') return;
    if (speed > 1024 * 1024) {
        speedIndicator.textContent = `${(speed / (1024 * 1024)).toFixed(2)} MB/s`;
    } else {
        speedIndicator.textContent = `${Math.round(speed / 1024)} KB/s`;
    }
});

window.api.onDownloadStatus((status) => {
    if (typeof status === 'string') {
        fileIndicator.textContent = status;
    } else if (status && status.name) {
        fileIndicator.textContent = status.name;
    }
});

window.api.onLog((logData) => {
    addLog(logData.text, logData.type || 'data');
});

window.api.onJavaDownloadProgress((data) => {
    if (!data) return;
    if (typeof data.percent === 'number') {
        progressBar.style.width = `${data.percent}%`;
        progressPercent.textContent = `${data.percent}%`;
    }
    if (data.message) {
        statusText.textContent = data.message;
        fileIndicator.textContent = data.message;
    }
});

window.api.onStarted(async () => {
    statusText.textContent = 'Minecraft başarıyla başlatıldı!';
    stateBadge.textContent = 'Oyun Açık';
    stateBadge.className = 'badge-ready';
    launchBtn.innerHTML = '<span class="launch-icon">🎮</span><span class="launch-label">OYUN ÇALIŞIYOR</span>';
    addLog('Minecraft açıldı! javaw.exe ile harici CMD penceresi tamamen gizlendi.', 'system');

    // Refresh version dropdown to highlight recently downloaded version
    const activeDir = currentSettings.gamePath || currentSettings.gameDirectory || systemDefaultGameDir;
    const installed = await window.api.getInstalledVersions(activeDir);
    updateVersionDropdown(installed, selectedVersion);
});

window.api.onClose(async (code) => {
    addLog(`Minecraft kapandı (Çıkış kodu: ${code})`, 'system');
    statusText.textContent = 'Oyun kapandı. Yeniden başlatabilirsiniz.';
    setLaunchingState(false);

    // Refresh version dropdown in case new files were installed
    const activeDir = currentSettings.gamePath || currentSettings.gameDirectory || systemDefaultGameDir;
    const installed = await window.api.getInstalledVersions(activeDir);
    updateVersionDropdown(installed, selectedVersion);
});

window.api.onError((errorMsg) => {
    addLog(`Hata: ${errorMsg}`, 'error');
    statusText.textContent = 'Oyun başlatılırken hata oluştu!';
    setLaunchingState(false);
});

// Real-time Game Directory Changed Listener
if (window.api && window.api.onGameDirectoryChanged) {
    window.api.onGameDirectoryChanged(async (data) => {
        if (!data || !data.newPath) return;
        const newDir = data.newPath;
        currentSettings.gameDirectory = newDir;
        currentSettings.gamePath = newDir;
        if (settingGameDir) {
            settingGameDir.value = newDir;
        }

        addLog(`[Dizin] Oyun kök dizini güncellendi: ${newDir}`, 'system');

        // Reload installed versions from new path
        try {
            const installed = await window.api.getInstalledVersions(newDir);
            updateVersionDropdown(installed, selectedVersion);
        } catch (e) {
            console.error('Sürümler yenilenirken hata:', e);
        }

        // Reload screenshots gallery from new path
        try {
            await loadScreenshots();
        } catch (e) {
            console.error('Ekran görüntüleri yenilenirken hata:', e);
        }
    });
}

// Run initialization
initSystemInfo();
