use crate::models::{JavaInfo, LogEvent, ProgressEvent};
use crate::settings::get_user_data_dir;
use futures_util::StreamExt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn parse_java_major(version_output: &str) -> Option<u32> {
    // Examples:
    // java version "1.8.0_301" -> 8
    // openjdk version "17.0.2" -> 17
    // openjdk version "21.0.5" -> 21
    let idx = version_output.find('"')?;
    let rest = &version_output[idx + 1..];
    let end = rest.find('"')?;
    let ver_str = &rest[..end];

    let mut parts = ver_str.split('.');
    let first = parts.next()?.parse::<u32>().ok()?;
    if first == 1 {
        parts.next()?.split(|c: char| !c.is_ascii_digit()).next()?.parse::<u32>().ok()
    } else {
        Some(first)
    }
}

pub fn inspect_java_binary(java_bin: &Path) -> Option<JavaInfo> {
    if !java_bin.exists() {
        return None;
    }
    // Use java.exe if javaw.exe was passed, because javaw.exe doesn't output -version to stderr on Windows
    let check_bin = if java_bin
        .file_name()
        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("javaw.exe"))
        .unwrap_or(false)
    {
        let sibling = java_bin.with_file_name("java.exe");
        if sibling.exists() {
            sibling
        } else {
            java_bin.to_path_buf()
        }
    } else {
        java_bin.to_path_buf()
    };

    let mut cmd = Command::new(&check_bin);
    cmd.arg("-version");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().ok()?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let major = parse_java_major(&combined)?;
    Some(JavaInfo {
        major,
        raw: combined.trim().to_string(),
        path: java_bin.to_string_lossy().to_string(),
    })
}

pub fn get_system_java_info() -> Option<JavaInfo> {
    if let Ok(output) = {
        let mut cmd = Command::new("where.exe");
        cmd.arg("javaw");
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output()
    } {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let p = PathBuf::from(trimmed);
                    if let Some(info) = inspect_java_binary(&p) {
                        return Some(info);
                    }
                }
            }
        }
    }

    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let p = PathBuf::from(java_home).join("bin").join("javaw.exe");
        if let Some(info) = inspect_java_binary(&p) {
            return Some(info);
        }
    }

    None
}

/// Determines the required Java major version for a given Minecraft version string.
pub fn required_java_major(mc_version: &str, json_java_major: Option<u32>) -> u32 {
    let lower = mc_version.to_lowercase();
    if lower.contains("26.") || lower.starts_with("26w") || lower.contains("java-25") || lower.contains("java25") {
        return 25;
    }

    if let Some(major) = json_java_major {
        return major;
    }

    // Parse "1.XX.Y" from version string
    // Strip prefixes like "fabric-loader-0.16.0-1.20.1" or "1.20.1-forge-47.3.0"
    let mut minor_ver: Option<(u32, u32)> = None;
    for token in lower.split(|c: char| !c.is_ascii_digit() && c != '.') {
        let nums: Vec<&str> = token.split('.').collect();
        if nums.len() >= 2 && nums[0] == "1" {
            if let Ok(minor) = nums[1].parse::<u32>() {
                let patch = nums.get(2).and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
                minor_ver = Some((minor, patch));
                break;
            }
        }
    }

    match minor_ver {
        Some((minor, _)) if minor <= 16 => 8,
        Some((17..=19, _)) => 17,
        Some((20, patch)) if patch <= 4 => 17,
        Some((20, _)) => 21,
        Some((minor, _)) if minor >= 21 => 21,
        _ => 21,
    }
}

fn find_javaw_in_dir(dir: &Path) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    let direct = dir.join("bin").join("javaw.exe");
    if direct.exists() {
        return Some(direct);
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let sub = entry.path().join("bin").join("javaw.exe");
                if sub.exists() {
                    return Some(sub);
                }
            }
        }
    }
    None
}

fn find_matching_local_or_system_java(target_major: u32) -> Option<JavaInfo> {
    // 1. Check %APPDATA%/lxclient/runtimes/java-{major}
    let user_runtime = get_user_data_dir()
        .join("runtimes")
        .join(format!("java-{}", target_major));
    if let Some(bin) = find_javaw_in_dir(&user_runtime) {
        if let Some(info) = inspect_java_binary(&bin) {
            return Some(info);
        }
    }

    // 2. Check ./runtimes/java-{major} (workspace / portable runtimes)
    if let Ok(cwd) = std::env::current_dir() {
        let cwd_runtime = cwd.join("runtimes").join(format!("java-{}", target_major));
        if let Some(bin) = find_javaw_in_dir(&cwd_runtime) {
            if let Some(info) = inspect_java_binary(&bin) {
                return Some(info);
            }
        }
    }

    // 3. Check system PATH / JAVA_HOME if exact match (or compatible for vanilla/newer)
    if let Some(sys) = get_system_java_info() {
        if sys.major == target_major {
            return Some(sys);
        }
    }

    // 4. Scan common Windows Java installation directories
    let common_roots = [
        r"C:\Program Files\Eclipse Adoptium",
        r"C:\Program Files\Java",
        r"C:\Program Files\Microsoft",
        r"C:\Program Files\Zulu",
        r"C:\Program Files\BellSoft",
    ];
    for root in common_roots {
        let root_path = Path::new(root);
        if let Ok(entries) = fs::read_dir(root_path) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let candidate = entry.path().join("bin").join("javaw.exe");
                    if let Some(info) = inspect_java_binary(&candidate) {
                        if info.major == target_major {
                            return Some(info);
                        }
                    }
                }
            }
        }
    }

    None
}

async fn download_java_zip(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    java_major: u32,
) -> Result<(), String> {
    let resp = client
        .get(url)
        .header("User-Agent", "LxClient-Launcher/2.0 (Windows x64)")
        .send()
        .await
        .map_err(|e| format!("Java indirme isteği başarısız: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Java indirme hatası: HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_percent: u64 = 0;

    let mut file = fs::File::create(dest).map_err(|e| format!("Geçici zip oluşturulamadı: {}", e))?;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let data = chunk.map_err(|e| format!("İndirme akışı hatası: {}", e))?;
        file.write_all(&data)
            .map_err(|e| format!("Dosya yazma hatası: {}", e))?;
        downloaded += data.len() as u64;

        if total > 0 {
            let pct = (downloaded * 100 / total).min(100);
            if pct != last_percent && (pct % 5 == 0 || pct == 100) {
                last_percent = pct;
                let mb_down = downloaded as f64 / (1024.0 * 1024.0);
                let mb_total = total as f64 / (1024.0 * 1024.0);
                let msg = format!(
                    "Java {} Runtime indiriliyor... (%{} - {:.1}/{:.1} MB)",
                    java_major, pct, mb_down, mb_total
                );
                let _ = app.emit(
                    "launcher-progress",
                    ProgressEvent {
                        stage: "java".to_string(),
                        task: pct,
                        total: 100,
                        message: msg.clone(),
                    },
                );
                let _ = app.emit("launcher-download-status", msg);
            }
        }
    }
    Ok(())
}

fn extract_zip_normalized(zip_path: &Path, target_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(target_dir).map_err(|e| format!("Java hedef klasörü oluşturulamadı: {}", e))?;
    let file = fs::File::open(zip_path).map_err(|e| format!("Java zip açılamadı: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Zip arşivi okunamadı: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };

        // Strip top-level directory (e.g. jdk-21.0.6+7-jre/bin/javaw.exe -> bin/javaw.exe)
        let mut components = rel_path.components();
        let _first = components.next();
        let stripped: PathBuf = components.collect();
        if stripped.as_os_str().is_empty() {
            continue;
        }

        let out_path = target_dir.join(&stripped);
        if entry.is_dir() {
            let _ = fs::create_dir_all(&out_path);
        } else {
            if let Some(parent) = out_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }

    find_javaw_in_dir(target_dir).ok_or_else(|| {
        format!(
            "Java çıkarıldı fakat javaw.exe bulunamadı: {}",
            target_dir.display()
        )
    })
}

pub async fn ensure_java_runtime(
    app: &AppHandle,
    client: &reqwest::Client,
    custom_java_path: Option<&str>,
    required_major: u32,
) -> Result<JavaInfo, String> {
    // Check custom user-specified Java path first
    if let Some(custom) = custom_java_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if !p.exists() {
                return Err(format!("Özel Java yolu bulunamadı: {}", trimmed));
            }
            if let Some(info) = inspect_java_binary(&p) {
                if info.major != required_major {
                    let _ = app.emit(
                        "launcher-log",
                        LogEvent {
                            log_type: "warn".to_string(),
                            text: format!(
                                "[Java Uyarısı] Seçili özel Java (Java {}) bu Minecraft sürümü için önerilen Java {} ile uyuşmuyor! Sorun yaşarsanız Ayarlar'dan özel Java yolunu temizleyin.",
                                info.major, required_major
                            ),
                        },
                    );
                }
                return Ok(info);
            }
            return Ok(JavaInfo {
                major: required_major,
                raw: "Özel Java".to_string(),
                path: trimmed.to_string(),
            });
        }
    }

    if let Some(found) = find_matching_local_or_system_java(required_major) {
        let _ = app.emit(
            "launcher-log",
            LogEvent {
                log_type: "system".to_string(),
                text: format!(
                    "[Java] Java {} bulundu: {}",
                    found.major, found.path
                ),
            },
        );
        return Ok(found);
    }

    // Download Adoptium Temurin JRE / JDK
    let _ = app.emit(
        "launcher-log",
        LogEvent {
            log_type: "system".to_string(),
            text: format!(
                "[Java] Sistemde Java {} bulunamadı. Eclipse Adoptium Temurin {} otomatik indiriliyor...",
                required_major, required_major
            ),
        },
    );

    let runtimes_dir = get_user_data_dir().join("runtimes");
    let target_dir = runtimes_dir.join(format!("java-{}", required_major));
    fs::create_dir_all(&runtimes_dir).map_err(|e| e.to_string())?;
    let temp_zip = runtimes_dir.join(format!("java-{}-download.zip", required_major));

    let jre_url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/windows/x64/jre/hotspot/normal/eclipse",
        required_major
    );
    let jdk_url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/windows/x64/jdk/hotspot/normal/eclipse",
        required_major
    );

    if let Err(_jre_err) = download_java_zip(app, client, &jre_url, &temp_zip, required_major).await {
        download_java_zip(app, client, &jdk_url, &temp_zip, required_major).await?;
    }

    let _ = app.emit(
        "launcher-download-status",
        format!("Java {} arşivi açılıyor...", required_major),
    );
    let javaw = extract_zip_normalized(&temp_zip, &target_dir)?;
    let _ = fs::remove_file(&temp_zip);

    let _ = app.emit(
        "launcher-log",
        LogEvent {
            log_type: "system".to_string(),
            text: format!("[Java] Java {} başarıyla hazırlandı: {}", required_major, javaw.display()),
        },
    );

    Ok(JavaInfo {
        major: required_major,
        raw: format!("Adoptium Temurin {}", required_major),
        path: javaw.to_string_lossy().to_string(),
    })
}
