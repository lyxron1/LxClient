const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const child_process = require('child_process');
const AdmZip = require('adm-zip');

function getUserDataPath() {
    try {
        const { app } = require('electron');
        if (app && app.getPath) {
            return app.getPath('userData');
        }
    } catch (e) {}
    const base = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : path.join(process.env.HOME || '', '.config'));
    return path.join(base, 'lxclient');
}

/**
 * Checks system default Java version by executing 'java -version'
 * Returns { major: number, raw: string } or null if not found
 */
function getSystemJavaVersion() {
    try {
        const res = child_process.spawnSync('java', ['-version'], { encoding: 'utf8' });
        const output = (res.stdout || '') + (res.stderr || '');
        if (!output) return null;

        // Matches: "1.8.0_301" -> 8, "17.0.2" -> 17, "21.0.1" -> 21, "25.0.4" -> 25
        const match = output.match(/version "(?:1\.)?([0-9]+)/);
        if (match) {
            return {
                major: parseInt(match[1], 10),
                raw: output.trim()
            };
        }
    } catch (err) {
        // java command not available
    }
    return null;
}

/**
 * Resolves path to system javaw.exe
 */
function getSystemJavawPath() {
    try {
        const res = child_process.spawnSync('where.exe', ['javaw'], { encoding: 'utf8' });
        if (res.status === 0 && res.stdout) {
            const first = res.stdout.split(/\r?\n/)[0].trim();
            if (fs.existsSync(first)) return first;
        }
    } catch (e) {}

    if (process.env.JAVA_HOME) {
        const p = path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe');
        if (fs.existsSync(p)) return p;
    }

    return 'javaw';
}

/**
 * Downloads a file from URL (following 30x redirects) with progress callback
 */
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        function get(currentUrl, redirectCount = 0) {
            if (redirectCount > 10) {
                return reject(new Error('Çok fazla yönlendirme hatası (Too many redirects)'));
            }

            let parsedUrl;
            try {
                parsedUrl = new URL(currentUrl);
            } catch (e) {
                return reject(new Error(`Geçersiz URL: ${currentUrl}`));
            }

            const client = parsedUrl.protocol === 'http:' ? http : https;

            const req = client.get(currentUrl, {
                headers: {
                    'User-Agent': 'LxClient-Launcher/1.0 (Windows x64)'
                }
            }, (res) => {
                // Follow redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const nextUrl = new URL(res.headers.location, currentUrl).href;
                    return get(nextUrl, redirectCount + 1);
                }

                if (res.statusCode !== 200) {
                    return reject(new Error(`İndirme başarısız oldu: HTTP ${res.statusCode}`));
                }

                const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
                let downloadedBytes = 0;

                const fileStream = fs.createWriteStream(destPath);

                res.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0 && onProgress) {
                        const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
                        onProgress(percent, downloadedBytes, totalBytes);
                    }
                });

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
 * Finds javaw.exe directly in dir/bin or inside a single subdirectory (e.g. dir/jdk-21.0.x-jre/bin)
 */
function findJavawInDir(dir) {
    if (!fs.existsSync(dir)) return null;
    const direct = path.join(dir, 'bin', 'javaw.exe');
    if (fs.existsSync(direct)) return direct;

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const subCandidate = path.join(dir, entry.name, 'bin', 'javaw.exe');
                if (fs.existsSync(subCandidate)) return subCandidate;
            }
        }
    } catch (e) {}
    return null;
}

/**
 * Extracts archive using AdmZip and normalizes folder so that targetDir/bin/javaw.exe is present
 */
function extractAndNormalizeJava(zipPath, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(targetDir, true);

    const directJavaw = path.join(targetDir, 'bin', 'javaw.exe');
    if (fs.existsSync(directJavaw)) {
        return directJavaw;
    }

    // Check if files were extracted inside a subfolder (e.g., jdk-21.0.6+7-jre)
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const subDir = path.join(targetDir, entry.name);
            const subJavaw = path.join(subDir, 'bin', 'javaw.exe');
            if (fs.existsSync(subJavaw)) {
                // Move items from subfolder to targetDir
                try {
                    const subItems = fs.readdirSync(subDir);
                    for (const item of subItems) {
                        const src = path.join(subDir, item);
                        const dest = path.join(targetDir, item);
                        if (fs.existsSync(dest)) {
                            try { fs.rmSync(dest, { recursive: true, force: true }); } catch (e) {}
                        }
                        fs.renameSync(src, dest);
                    }
                    try { fs.rmdirSync(subDir); } catch (e) {}
                } catch (err) {
                    console.warn('Klasör normalizasyonu hatası:', err.message);
                }
                break;
            }
        }
    }

    const normalizedJavaw = path.join(targetDir, 'bin', 'javaw.exe');
    if (fs.existsSync(normalizedJavaw)) {
        return normalizedJavaw;
    }

    const fallbackFound = findJavawInDir(targetDir);
    if (fallbackFound) return fallbackFound;

    return normalizedJavaw;
}

/**
 * Checks if the version or profile requires Java 25 (e.g. 26.x or newer Minecraft/modded versions)
 */
function isJava25Required(versionName, inheritsFrom) {
    const vStr = `${versionName || ''} ${inheritsFrom || ''}`.toLowerCase();
    return (
        /\b26\./.test(vStr) ||
        /\b1\.26/.test(vStr) ||
        /\b26w/.test(vStr) ||
        vStr.includes('26.') ||
        vStr.includes('-26') ||
        vStr.includes('java-25') ||
        vStr.includes('java25')
    );
}

/**
 * Requirement 2: checkAndPrepareJava (Automatic Java 21 Download & ENOTDIR Fix)
 * - Safe target directory: path.join(app.getPath('userData'), 'runtimes', 'java-21')
 * - Never extracts under __dirname to prevent asar/read-only packaging errors.
 * - Reuses existing local runtime once downloaded.
 * - Checks system Java if valid.
 * - If missing, automatically downloads Eclipse Adoptium Temurin 21 Windows x64.
 */
async function checkAndPrepareJava(onProgress, targetMajor = 21) {
    const javaMajor = targetMajor >= 25 ? 25 : 21;
    const userData = getUserDataPath();
    const runtimesDir = path.join(userData, 'runtimes');
    const jreDir = path.join(runtimesDir, `java-${javaMajor}`);

    // a) Check local runtime in userData: Bir kere indikten sonra tekrar indirmeyip bu yerel runtime'ı kullansın
    const localJavaw = findJavawInDir(jreDir);
    if (localJavaw && fs.existsSync(localJavaw)) {
        return {
            javaPath: path.resolve(localJavaw),
            source: 'local',
            version: javaMajor
        };
    }

    // b) Check system Java major version
    const sysJava = getSystemJavaVersion();
    if (sysJava && sysJava.major >= javaMajor) {
        const sysJavawPath = getSystemJavawPath();
        return {
            javaPath: sysJavawPath,
            source: 'system',
            version: sysJava.major
        };
    }

    // c) Hedef Dizin Güvenliği: İndirme ve zip açma işlemi ASLA '__dirname' altına yapılmasın
    fs.mkdirSync(jreDir, { recursive: true });
    fs.mkdirSync(runtimesDir, { recursive: true });

    const adoptiumJreUrl = `https://api.adoptium.net/v3/binary/latest/${javaMajor}/ga/windows/x64/jre/hotspot/normal/eclipse`;
    const adoptiumJdkUrl = `https://api.adoptium.net/v3/binary/latest/${javaMajor}/ga/windows/x64/jdk/hotspot/normal/eclipse`;
    const tempZip = path.join(runtimesDir, `java-${javaMajor}-download.zip`);

    if (onProgress) {
        onProgress({
            percent: 0,
            message: `Java ${javaMajor} Runtime İndiriliyor... (%0)`
        });
    }

    try {
        let downloaded = false;
        try {
            await downloadFile(adoptiumJreUrl, tempZip, (percent, bytesDown, total) => {
                if (onProgress) {
                    const mbDown = (bytesDown / (1024 * 1024)).toFixed(1);
                    const mbTotal = (total / (1024 * 1024)).toFixed(1);
                    onProgress({
                        percent,
                        message: `Java ${javaMajor} Runtime İndiriliyor... (%${percent} - ${mbDown}/${mbTotal} MB)`
                    });
                }
            });
            downloaded = true;
        } catch (jreErr) {
            // Fallback to JDK endpoint if JRE fails or is not available
            await downloadFile(adoptiumJdkUrl, tempZip, (percent, bytesDown, total) => {
                if (onProgress) {
                    const mbDown = (bytesDown / (1024 * 1024)).toFixed(1);
                    const mbTotal = (total / (1024 * 1024)).toFixed(1);
                    onProgress({
                        percent,
                        message: `Java ${javaMajor} Runtime (JDK) İndiriliyor... (%${percent} - ${mbDown}/${mbTotal} MB)`
                    });
                }
            });
            downloaded = true;
        }

        if (onProgress) {
            onProgress({
                percent: 100,
                message: `Java ${javaMajor} Arşivi Açılıyor...`
            });
        }

        const finalJavaw = extractAndNormalizeJava(tempZip, jreDir);

        // Remove temporary zip
        if (fs.existsSync(tempZip)) {
            try {
                fs.unlinkSync(tempZip);
            } catch (e) {}
        }

        if (!fs.existsSync(finalJavaw)) {
            throw new Error(`Java ${javaMajor} çıkarıldı fakat javaw.exe bulunamadı: ${finalJavaw}`);
        }

        if (onProgress) {
            onProgress({
                percent: 100,
                message: `Java ${javaMajor} Runtime Hazırlandı!`
            });
        }

        return {
            javaPath: path.resolve(finalJavaw),
            source: 'downloaded',
            version: javaMajor
        };
    } catch (err) {
        if (fs.existsSync(tempZip)) {
            try {
                fs.unlinkSync(tempZip);
            } catch (e) {}
        }
        throw err;
    }
}

module.exports = {
    getSystemJavaVersion,
    getSystemJavawPath,
    isJava25Required,
    checkAndPrepareJava
};
