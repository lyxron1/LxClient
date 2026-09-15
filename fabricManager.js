const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Downloads a file with redirect handling
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        function get(currentUrl, redirectCount = 0) {
            if (redirectCount > 8) {
                return reject(new Error('Çok fazla yönlendirme'));
            }

            const req = https.get(currentUrl, {
                headers: { 'User-Agent': 'LxClient/1.0' }
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return get(res.headers.location, redirectCount + 1);
                }

                if (res.statusCode !== 200) {
                    return reject(new Error(`İndirme başarısız (HTTP ${res.statusCode}): ${currentUrl}`));
                }

                const fileStream = fs.createWriteStream(destPath);
                res.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close(() => resolve(destPath));
                });

                fileStream.on('error', (err) => {
                    fs.unlink(destPath, () => {});
                    reject(err);
                });
            });

            req.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }

        get(url);
    });
}

/**
 * Checks if a selected version is a Fabric or custom inherited modded profile
 */
function getVersionJson(gameRoot, versionName) {
    const jsonPath = path.join(gameRoot, 'versions', versionName, `${versionName}.json`);
    if (fs.existsSync(jsonPath)) {
        try {
            return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        } catch (e) {
            return null;
        }
    }
    return null;
}

function isFabricOrCustom(versionJson) {
    if (!versionJson) return false;
    const isFabricMain = versionJson.mainClass && (
        versionJson.mainClass.includes('net.fabricmc') ||
        versionJson.mainClass.includes('KnotClient')
    );
    const hasInherits = Boolean(versionJson.inheritsFrom);
    return Boolean(isFabricMain || hasInherits);
}

/**
 * Ensures that base vanilla version JSON and client JAR exist in versions/<baseVersion>/
 * If missing, automatically downloads them from Mojang Manifest (piston-meta).
 */
async function ensureBaseVanillaVersion(gameRoot, baseVersion, onProgress) {
    const baseDir = path.join(gameRoot, 'versions', baseVersion);
    const baseJsonPath = path.join(baseDir, `${baseVersion}.json`);
    const baseJarPath = path.join(baseDir, `${baseVersion}.jar`);

    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }

    let baseJson = null;

    // Check if JSON exists and is valid
    if (fs.existsSync(baseJsonPath)) {
        try {
            baseJson = JSON.parse(fs.readFileSync(baseJsonPath, 'utf8'));
        } catch (e) {
            baseJson = null;
        }
    }

    // If baseJson or downloads is missing, fetch from Mojang
    if (!baseJson || !baseJson.downloads || !baseJson.downloads.client || !baseJson.downloads.client.url) {
        if (onProgress) {
            onProgress({
                message: `Mojang manifest üzerinden temel vanilla sürüm (${baseVersion}) aranıyor...`,
                percent: 5,
                current: 1,
                total: 10
            });
        }

        let manifest = null;
        try {
            const mRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            if (mRes.ok) manifest = await mRes.json();
        } catch (e) {
            try {
                const mRes2 = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
                if (mRes2.ok) manifest = await mRes2.json();
            } catch (e2) {}
        }

        if (!manifest || !Array.isArray(manifest.versions)) {
            throw new Error('Mojang sürüm manifestosu indirilemedi.');
        }

        const entry = manifest.versions.find(v => v.id === baseVersion) ||
                      manifest.versions.find(v => v.id.toLowerCase() === baseVersion.toLowerCase());

        if (!entry || !entry.url) {
            throw new Error(`Temel Minecraft sürümü (${baseVersion}) Mojang manifestosunda bulunamadı.`);
        }

        if (onProgress) {
            onProgress({
                message: `Temel sürüm yapılandırması (${baseVersion}.json) indiriliyor...`,
                percent: 15,
                current: 3,
                total: 10
            });
        }

        const vRes = await fetch(entry.url);
        if (!vRes.ok) throw new Error(`Temel sürüm JSON indirilemedi: HTTP ${vRes.status}`);
        baseJson = await vRes.json();
        fs.writeFileSync(baseJsonPath, JSON.stringify(baseJson, null, 2), 'utf8');
    }

    // Check if client jar exists
    if (!fs.existsSync(baseJarPath) || fs.statSync(baseJarPath).size === 0) {
        const clientUrl = baseJson.downloads?.client?.url;
        if (!clientUrl) {
            throw new Error(`Temel sürüm (${baseVersion}) için client.jar indirme adresi bulunamadı.`);
        }

        if (onProgress) {
            onProgress({
                message: `Temel Minecraft istemcisi (${baseVersion}.jar) indiriliyor...`,
                percent: 30,
                current: 5,
                total: 10
            });
        }

        await downloadFile(clientUrl, baseJarPath);

        if (onProgress) {
            onProgress({
                message: `Temel istemci (${baseVersion}.jar) başarıyla indirildi.`,
                percent: 60,
                current: 8,
                total: 10
            });
        }
    }

    return { baseJson, baseJsonPath, baseJarPath };
}

/**
 * Resolves library coordinates to local disk path and download URL
 */
function resolveLibraryInfo(library, gameRoot) {
    // 1. If library has downloads.artifact
    if (library.downloads && library.downloads.artifact && library.downloads.artifact.path) {
        const relPath = library.downloads.artifact.path.replace(/\//g, path.sep);
        const fullPath = path.join(gameRoot, 'libraries', relPath);
        return {
            fullPath,
            url: library.downloads.artifact.url || null
        };
    }

    // 2. Standard Maven coordinate: group:artifact:version[:classifier]
    if (library.name) {
        const parts = library.name.split(':');
        if (parts.length >= 3) {
            const groupPath = parts[0].replace(/\./g, '/');
            const artifact = parts[1];
            const version = parts[2];
            const classifier = parts[3] ? `-${parts[3]}` : '';
            const fileName = `${artifact}-${version}${classifier}.jar`;

            const relPath = path.join(groupPath.replace(/\//g, path.sep), artifact, version, fileName);
            const fullPath = path.join(gameRoot, 'libraries', relPath);

            let downloadUrl = null;
            if (library.url) {
                const base = library.url.endsWith('/') ? library.url : library.url + '/';
                downloadUrl = `${base}${groupPath}/${artifact}/${version}/${fileName}`;
            } else {
                // Default maven repositories for Fabric and dependencies
                downloadUrl = `https://maven.fabricmc.net/${groupPath}/${artifact}/${version}/${fileName}`;
            }

            return {
                fullPath,
                url: downloadUrl
            };
        }
    }

    return null;
}

/**
 * Prepares and downloads all Fabric and inherited libraries
 * Merges Fabric version JSON with base vanilla JSON so MCLC never sees undefined url
 */
async function prepareFabricVersion(gameRoot, versionName, onProgress) {
    const versionJsonPath = path.join(gameRoot, 'versions', versionName, `${versionName}.json`);
    if (!fs.existsSync(versionJsonPath)) {
        return null;
    }

    let fabricJson = null;
    try {
        fabricJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
    } catch (e) {
        return null;
    }

    if (!isFabricOrCustom(fabricJson)) {
        return null;
    }

    const inheritsFrom = fabricJson.inheritsFrom || versionName;
    const isInherited = Boolean(fabricJson.inheritsFrom && fabricJson.inheritsFrom !== versionName);

    let baseJson = null;
    let baseJarPath = path.join(gameRoot, 'versions', inheritsFrom, `${inheritsFrom}.jar`);

    if (isInherited) {
        // Step 1: Ensure base vanilla version JSON and client jar exist (download from Mojang if needed)
        const baseResult = await ensureBaseVanillaVersion(gameRoot, inheritsFrom, onProgress);
        baseJson = baseResult.baseJson;
        baseJarPath = baseResult.baseJarPath;
    } else {
        baseJson = fabricJson;
    }

    // Copy base client jar to fabric version folder if fabric jar does not exist
    const fabricJarPath = path.join(gameRoot, 'versions', versionName, `${versionName}.jar`);
    if (fs.existsSync(baseJarPath) && !fs.existsSync(fabricJarPath)) {
        try {
            fs.copyFileSync(baseJarPath, fabricJarPath);
        } catch (e) {
            console.warn('Fabric jar kopyalama uyarısı:', e.message);
        }
    }

    // Step 3: Merged Version JSON
    // Merge Fabric JSON with base vanilla JSON so MCLC has downloads, assetIndex, and all libraries
    if (baseJson && baseJson !== fabricJson) {
        const mergedJson = {
            ...baseJson,
            ...fabricJson,
            id: versionName,
            inheritsFrom: inheritsFrom,
            mainClass: fabricJson.mainClass || baseJson.mainClass,
            arguments: fabricJson.arguments || baseJson.arguments,
            assetIndex: baseJson.assetIndex || fabricJson.assetIndex,
            assets: baseJson.assets || fabricJson.assets,
            downloads: baseJson.downloads || fabricJson.downloads,
            logging: baseJson.logging || fabricJson.logging
        };

        const fabricLibs = Array.isArray(fabricJson.libraries) ? fabricJson.libraries : [];
        const baseLibs = Array.isArray(baseJson.libraries) ? baseJson.libraries : [];

        const seenLibKeys = new Set();
        const mergedLibraries = [];

        for (const lib of fabricLibs) {
            if (lib && lib.name) {
                const parts = lib.name.split(':');
                const key = parts[0] + ':' + parts[1];
                seenLibKeys.add(key);

                if (lib.url && typeof lib.url === 'string' && !lib.url.endsWith('/')) {
                    lib.url = lib.url + '/';
                }
                mergedLibraries.push(lib);
            }
        }

        for (const lib of baseLibs) {
            if (lib && lib.name) {
                const parts = lib.name.split(':');
                const key = parts[0] + ':' + parts[1];
                if (!seenLibKeys.has(key)) {
                    mergedLibraries.push(lib);
                }
            }
        }

        mergedJson.libraries = mergedLibraries;

        try {
            fs.writeFileSync(versionJsonPath, JSON.stringify(mergedJson, null, 2), 'utf8');
            fabricJson = mergedJson;
        } catch (e) {
            console.error('Merged JSON yazılamadı:', e);
        }
    }

    // Sync asset index file if present
    const assetId = fabricJson.assets || fabricJson.assetIndex?.id || inheritsFrom;
    if (assetId) {
        const assetDir = path.join(gameRoot, 'assets', 'indexes');
        const baseAssetIndex = path.join(assetDir, `${assetId}.json`);
        const customAssetIndex = path.join(assetDir, `${versionName}.json`);
        if (fs.existsSync(baseAssetIndex) && !fs.existsSync(customAssetIndex)) {
            try {
                fs.mkdirSync(assetDir, { recursive: true });
                fs.copyFileSync(baseAssetIndex, customAssetIndex);
            } catch (e) {}
        }
    }

    // Collect and pre-download Fabric libraries
    const collectedLibraries = Array.isArray(fabricJson.libraries) ? fabricJson.libraries : [];
    const libraryPaths = [];
    const missingToDownload = [];

    for (const lib of collectedLibraries) {
        const info = resolveLibraryInfo(lib, gameRoot);
        if (info) {
            libraryPaths.push(info.fullPath);
            if (!fs.existsSync(info.fullPath) && info.url) {
                missingToDownload.push(info);
            }
        }
    }

    // Download missing libraries
    if (missingToDownload.length > 0) {
        let downloadedCount = 0;
        for (const item of missingToDownload) {
            try {
                if (onProgress) {
                    const pct = Math.round(70 + (downloadedCount / missingToDownload.length) * 30);
                    onProgress({
                        message: `Fabric kütüphaneleri indiriliyor (%${pct})...`,
                        percent: pct,
                        current: downloadedCount,
                        total: missingToDownload.length
                    });
                }
                await downloadFile(item.url, item.fullPath);
            } catch (err) {
                try {
                    const fallbackUrl = item.url.replace('https://maven.fabricmc.net/', 'https://repo1.maven.org/maven2/');
                    if (fallbackUrl !== item.url) {
                        await downloadFile(fallbackUrl, item.fullPath);
                    }
                } catch (fallbackErr) {
                    console.warn(`Kütüphane indirilemedi: ${item.url}`);
                }
            }
            downloadedCount++;
        }
    }

    return {
        isFabric: true,
        versionName: versionName,
        inheritsFrom: inheritsFrom,
        mainClass: fabricJson.mainClass || 'net.fabricmc.loader.impl.launch.knot.KnotClient',
        libraryPaths: Array.from(new Set(libraryPaths)),
        vanillaJarPath: baseJarPath,
        versionJsonPath: versionJsonPath,
        assetIndex: fabricJson.assetIndex || baseJson?.assetIndex || null
    };
}

module.exports = {
    getVersionJson,
    isFabricOrCustom,
    ensureBaseVanillaVersion,
    prepareFabricVersion
};
