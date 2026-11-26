use crate::java::{ensure_java_runtime, required_java_major};
use crate::models::{LaunchConfig, LogEvent, MojangVersion, ProgressEvent};
use crate::settings::{ensure_multiplayer_unlocked, initialize_game_directory, sanitize_game_path};
use futures_util::StreamExt;
use md5::{Digest, Md5};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone)]
struct DownloadTask {
    url: String,
    dest: PathBuf,
    label: String,
}

#[derive(Debug, Clone)]
struct ResolvedLib {
    path: PathBuf,
    url: Option<String>,
    is_native: bool,
    extract_exclude: Vec<String>,
}

pub async fn fetch_mojang_manifest(client: &reqwest::Client) -> Result<Vec<MojangVersion>, String> {
    let urls = [
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
        "https://launchermeta.mojang.com/mc/game/version_manifest.json",
    ];
    for url in urls {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<Value>().await {
                    if let Some(arr) = json.get("versions").and_then(|v| v.as_array()) {
                        let mut out = Vec::with_capacity(arr.len());
                        for item in arr {
                            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                            let vtype = item.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                            let vurl = item.get("url").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                            let rtime = item.get("releaseTime").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                            if !id.is_empty() && !vurl.is_empty() {
                                out.push(MojangVersion {
                                    id,
                                    version_type: vtype,
                                    url: vurl,
                                    release_time: rtime,
                                });
                            }
                        }
                        if !out.is_empty() {
                            return Ok(out);
                        }
                    }
                }
            }
        }
    }
    Err("Mojang sürüm manifestosu alınamadı.".to_string())
}

async fn download_to_file(client: &reqwest::Client, url: &str, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Klasör oluşturulamadı: {}", e))?;
    }
    let resp = client
        .get(url)
        .header("User-Agent", "LxClient/2.0")
        .send()
        .await
        .map_err(|e| format!("İstek hatası ({}): {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} ({})", resp.status(), url));
    }

    let tmp_path = dest.with_extension("tmp");
    let mut file = fs::File::create(&tmp_path).map_err(|e| format!("Dosya oluşturulamadı: {}", e))?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let data = chunk.map_err(|e| format!("Akış hatası: {}", e))?;
        file.write_all(&data).map_err(|e| format!("Yazma hatası: {}", e))?;
    }
    drop(file);
    fs::rename(&tmp_path, dest).map_err(|e| format!("Dosya taşınamadı: {}", e))?;
    Ok(())
}

async fn download_with_fallbacks(client: &reqwest::Client, url: &str, dest: &Path) -> Result<(), String> {
    if let Ok(()) = download_to_file(client, url, dest).await {
        return Ok(());
    }
    // Try Maven fallbacks if applicable
    let fallbacks = [
        url.replace("https://maven.fabricmc.net/", "https://repo1.maven.org/maven2/"),
        url.replace("https://maven.minecraftforge.net/", "https://repo1.maven.org/maven2/"),
        url.replace("https://libraries.minecraft.net/", "https://repo1.maven.org/maven2/"),
    ];
    for fb in fallbacks {
        if fb != url {
            if let Ok(()) = download_to_file(client, &fb, dest).await {
                return Ok(());
            }
        }
    }
    Err(format!("İndirilemedi: {}", url))
}

async fn ensure_version_json(
    client: &reqwest::Client,
    game_root: &Path,
    version_id: &str,
    manifest: &mut Option<Vec<MojangVersion>>,
) -> Result<Value, String> {
    let json_path = game_root
        .join("versions")
        .join(version_id)
        .join(format!("{}.json", version_id));

    if json_path.exists() {
        if let Ok(raw) = fs::read_to_string(&json_path) {
            if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
                return Ok(parsed);
            }
        }
    }

    if manifest.is_none() {
        *manifest = Some(fetch_mojang_manifest(client).await?);
    }
    let list = manifest.as_ref().unwrap();
    let entry = list
        .iter()
        .find(|v| v.id == version_id || v.id.eq_ignore_ascii_case(version_id))
        .ok_or_else(|| format!("Sürüm Mojang manifestosunda bulunamadı: {}", version_id))?;

    let resp = client
        .get(&entry.url)
        .send()
        .await
        .map_err(|e| format!("Sürüm JSON indirilemedi: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Sürüm JSON HTTP {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Sürüm JSON ayrıştırılamadı: {}", e))?;

    if let Some(parent) = json_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&json_path, &text);
    Ok(parsed)
}

fn rules_allow(rules: Option<&Vec<Value>>, has_custom_resolution: bool) -> bool {
    let Some(rules_arr) = rules else {
        return true;
    };
    if rules_arr.is_empty() {
        return true;
    }

    let mut allowed = false;
    for rule in rules_arr {
        let action = rule.get("action").and_then(|v| v.as_str()).unwrap_or("allow");
        let mut matches = true;

        if let Some(os_obj) = rule.get("os").and_then(|v| v.as_object()) {
            if let Some(name) = os_obj.get("name").and_then(|v| v.as_str()) {
                if name != "windows" {
                    matches = false;
                }
            }
            if let Some(arch) = os_obj.get("arch").and_then(|v| v.as_str()) {
                if arch == "x86" {
                    matches = false;
                }
            }
        }

        if let Some(features) = rule.get("features").and_then(|v| v.as_object()) {
            for (k, v) in features {
                let expected = v.as_bool().unwrap_or(false);
                let actual = match k.as_str() {
                    "has_custom_resolution" => has_custom_resolution,
                    "is_demo_user" => false,
                    _ => false,
                };
                if actual != expected {
                    matches = false;
                }
            }
        }

        if matches {
            allowed = action == "allow";
        }
    }
    allowed
}

fn maven_coords_to_rel_and_url(coords: &str, base_url: Option<&str>) -> Option<(PathBuf, String)> {
    // Format: group:artifact:version[:classifier][@ext]
    let (coords_clean, ext) = if let Some((c, e)) = coords.split_once('@') {
        (c, e)
    } else {
        (coords, "jar")
    };
    let parts: Vec<&str> = coords_clean.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group_slash = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).map(|c| format!("-{}", c)).unwrap_or_default();
    let filename = format!("{}-{}{}.{}", artifact, version, classifier, ext);

    let mut rel = PathBuf::new();
    for seg in group_slash.split('/') {
        rel.push(seg);
    }
    rel.push(artifact);
    rel.push(version);
    rel.push(&filename);

    let repo = base_url.unwrap_or("https://libraries.minecraft.net/");
    let repo_trimmed = repo.trim_end_matches('/');
    let url = format!("{}/{}/{}/{}/{}", repo_trimmed, group_slash, artifact, version, filename);
    Some((rel, url))
}

fn lib_dedup_key(lib: &Value) -> Option<String> {
    let name = lib.get("name").and_then(|v| v.as_str())?;
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() >= 4 {
        Some(format!("{}:{}:{}", parts[0], parts[1], parts[3]))
    } else if parts.len() >= 2 {
        Some(format!("{}:{}", parts[0], parts[1]))
    } else {
        Some(name.to_string())
    }
}

fn resolve_library(lib: &Value, libraries_dir: &Path) -> Vec<ResolvedLib> {
    let mut out = Vec::new();
    let rules = lib.get("rules").and_then(|v| v.as_array());
    if !rules_allow(rules, true) {
        return out;
    }

    let extract_exclude: Vec<String> = lib
        .get("extract")
        .and_then(|e| e.get("exclude"))
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // 1. Standard artifact
    if let Some(artifact) = lib.get("downloads").and_then(|d| d.get("artifact")) {
        if let Some(path_str) = artifact.get("path").and_then(|p| p.as_str()) {
            let mut full = libraries_dir.to_path_buf();
            for seg in path_str.split('/') {
                full.push(seg);
            }
            let url = artifact
                .get("url")
                .and_then(|u| u.as_str())
                .filter(|u| !u.is_empty())
                .map(|u| u.to_string());
            let is_native = path_str.contains("natives-windows");
            out.push(ResolvedLib {
                path: full,
                url,
                is_native,
                extract_exclude: extract_exclude.clone(),
            });
        }
    } else if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
        // Maven coordinate only (Fabric, old Forge, etc.)
        let base_url = lib.get("url").and_then(|u| u.as_str());
        let fallback_repo = if base_url.is_none() {
            if name.starts_with("net.fabricmc") || name.starts_with("org.ow2.asm") {
                Some("https://maven.fabricmc.net/")
            } else if name.starts_with("net.minecraftforge") || name.starts_with("cpw.mods") {
                Some("https://maven.minecraftforge.net/")
            } else if name.starts_with("net.neoforged") {
                Some("https://maven.neoforged.net/releases/")
            } else {
                Some("https://libraries.minecraft.net/")
            }
        } else {
            base_url
        };
        if let Some((rel, url)) = maven_coords_to_rel_and_url(name, fallback_repo) {
            let is_native = name.contains("natives-windows");
            out.push(ResolvedLib {
                path: libraries_dir.join(rel),
                url: Some(url),
                is_native,
                extract_exclude: extract_exclude.clone(),
            });
        }
    }

    // 2. Native classifiers (for older MC/Forge versions like 1.12.2, 1.16.5)
    if let Some(natives_obj) = lib.get("natives").and_then(|n| n.as_object()) {
        if let Some(win_key_raw) = natives_obj.get("windows").and_then(|w| w.as_str()) {
            let win_key = win_key_raw.replace("${arch}", "64");
            if let Some(classifier) = lib
                .get("downloads")
                .and_then(|d| d.get("classifiers"))
                .and_then(|c| c.get(&win_key))
            {
                if let Some(path_str) = classifier.get("path").and_then(|p| p.as_str()) {
                    let mut full = libraries_dir.to_path_buf();
                    for seg in path_str.split('/') {
                        full.push(seg);
                    }
                    let url = classifier
                        .get("url")
                        .and_then(|u| u.as_str())
                        .filter(|u| !u.is_empty())
                        .map(|u| u.to_string());
                    out.push(ResolvedLib {
                        path: full,
                        url,
                        is_native: true,
                        extract_exclude,
                    });
                }
            }
        }
    }

    out
}

fn extract_native_jar(jar_path: &Path, natives_dir: &Path, excludes: &[String]) {
    let Ok(file) = fs::File::open(jar_path) else {
        return;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return;
    };
    let _ = fs::create_dir_all(natives_dir);

    for i in 0..archive.len() {
        let Ok(mut entry) = archive.by_index(i) else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let rel_str = rel_path.to_string_lossy().replace('\\', "/");
        if rel_str.starts_with("META-INF/") {
            continue;
        }
        if excludes.iter().any(|ex| rel_str.starts_with(ex.as_str())) {
            continue;
        }
        // Extract .dll or any native file
        let out_path = natives_dir.join(&rel_path);
        if let Some(parent) = out_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut out_file) = fs::File::create(&out_path) {
            let _ = std::io::copy(&mut entry, &mut out_file);
        }
    }
}

fn collect_arguments(arr: Option<&Vec<Value>>, has_custom_resolution: bool) -> Vec<String> {
    let mut out = Vec::new();
    let Some(items) = arr else {
        return out;
    };
    for item in items {
        if let Some(s) = item.as_str() {
            out.push(s.to_string());
        } else if let Some(obj) = item.as_object() {
            let rules = obj.get("rules").and_then(|r| r.as_array());
            if !rules_allow(rules, has_custom_resolution) {
                continue;
            }
            if let Some(val) = obj.get("value") {
                if let Some(s) = val.as_str() {
                    out.push(s.to_string());
                } else if let Some(vals) = val.as_array() {
                    for v in vals {
                        if let Some(s) = v.as_str() {
                            out.push(s.to_string());
                        }
                    }
                }
            }
        }
    }
    out
}

fn substitute_vars(input: &str, vars: &HashMap<&str, String>) -> String {
    let mut res = input.to_string();
    for (k, v) in vars {
        res = res.replace(k, v);
    }
    res
}

fn offline_uuid(username: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(format!("OfflinePlayer:{}", username).as_bytes());
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

fn emit_log(app: &AppHandle, log_type: &str, text: impl Into<String>) {
    let _ = app.emit(
        "launcher-log",
        LogEvent {
            log_type: log_type.to_string(),
            text: text.into(),
        },
    );
}

pub async fn launch_minecraft(app: AppHandle, config: LaunchConfig) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("LxClient/2.0")
        .build()
        .map_err(|e| e.to_string())?;

    let game_root = sanitize_game_path(config.game_directory.as_deref());
    initialize_game_directory(&game_root)?;
    ensure_multiplayer_unlocked(&game_root);

    let player_name = if config.username.trim().is_empty() {
        "Oyuncu".to_string()
    } else {
        config.username.trim().to_string()
    };
    let player_uuid = offline_uuid(&player_name);
    let version_id = config.version.trim().to_string();

    emit_log(
        &app,
        "system",
        format!(
            "Başlatma hazırlanıyor: {} | Sürüm: {} | RAM: {} MB",
            player_name, version_id, config.memory_max
        ),
    );
    emit_log(
        &app,
        "system",
        format!("Oyun Dizini: {}", game_root.display()),
    );

    // 1. Resolve inheritsFrom chain (from child to root, then reverse to [root, ..., child])
    let mut manifest_cache: Option<Vec<MojangVersion>> = None;
    let mut chain: Vec<Value> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut current_id = version_id.clone();

    for _ in 0..6 {
        if !visited.insert(current_id.clone()) {
            return Err(format!("Döngüsel inheritsFrom algılandı: {}", current_id));
        }
        let json = ensure_version_json(&client, &game_root, &current_id, &mut manifest_cache).await?;
        let next_parent = json
            .get("inheritsFrom")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty() && *s != current_id)
            .map(|s| s.to_string());
        chain.push(json);
        match next_parent {
            Some(parent_id) => current_id = parent_id,
            None => break,
        }
    }

    // chain[0] = child (e.g. Forge/Fabric), chain.last() = root vanilla (e.g. 1.20.1)
    let child_json = chain.first().unwrap();
    let root_json = chain.last().unwrap();
    let base_version_id = root_json
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or(&current_id)
        .to_string();

    let main_class = chain
        .iter()
        .find_map(|j| j.get("mainClass").and_then(|v| v.as_str()))
        .ok_or_else(|| "Sürüm JSON içinde mainClass bulunamadı!".to_string())?
        .to_string();

    let is_modlauncher = main_class.contains("BootstrapLauncher")
        || main_class.contains("modlauncher.Launcher")
        || main_class.contains("neoforge");

    emit_log(
        &app,
        "system",
        format!(
            "Profil çözümlendi: {} (Temel: {}, MainClass: {})",
            version_id, base_version_id, main_class
        ),
    );

    // 2. Determine and prepare Java
    let json_java_major = chain
        .iter()
        .find_map(|j| {
            j.get("javaVersion")
                .and_then(|jv| jv.get("majorVersion"))
                .and_then(|m| m.as_u64())
        })
        .map(|m| m as u32);
    let target_java_major = required_java_major(&base_version_id, json_java_major);
    let java_info = ensure_java_runtime(
        &app,
        &client,
        config.java_path.as_deref(),
        target_java_major,
    )
    .await?;

    // Windows High Performance GPU preference
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok((key, _)) = hkcu.create_subkey(r"SOFTWARE\Microsoft\DirectX\UserGpuPreferences") {
            if key.set_value(&java_info.path, &"GpuPreference=2;").is_ok() {
                emit_log(&app, "system", "[Sistem] Harici GPU yüksek performans tercihi ayarlandı.");
            }
        }
    }

    // 3. Ensure base client JAR exists
    let base_jar_path = game_root
        .join("versions")
        .join(&base_version_id)
        .join(format!("{}.jar", base_version_id));
    if !base_jar_path.exists() || fs::metadata(&base_jar_path).map(|m| m.len() == 0).unwrap_or(true) {
        let client_url = root_json
            .get("downloads")
            .and_then(|d| d.get("client"))
            .and_then(|c| c.get("url"))
            .and_then(|u| u.as_str())
            .ok_or_else(|| format!("{} için client.jar indirme adresi bulunamadı.", base_version_id))?;

        emit_log(&app, "system", format!("Temel istemci ({}.jar) indiriliyor...", base_version_id));
        let _ = app.emit(
            "launcher-progress",
            ProgressEvent {
                stage: "classes".to_string(),
                task: 10,
                total: 100,
                message: format!("{}.jar indiriliyor...", base_version_id),
            },
        );
        download_to_file(&client, client_url, &base_jar_path).await?;
    }

    // 4. Merge libraries (child -> root so child overrides parent!)
    let libraries_dir = game_root.join("libraries");
    let natives_dir = game_root.join("natives").join(&version_id);
    let _ = fs::create_dir_all(&natives_dir);

    let mut seen_lib_keys: HashSet<String> = HashSet::new();
    let mut resolved_libs: Vec<ResolvedLib> = Vec::new();

    for j in &chain {
        if let Some(libs) = j.get("libraries").and_then(|l| l.as_array()) {
            for lib in libs {
                let rules = lib.get("rules").and_then(|r| r.as_array());
                if !rules_allow(rules, true) {
                    continue;
                }
                if let Some(key) = lib_dedup_key(lib) {
                    if !seen_lib_keys.insert(key) {
                        continue;
                    }
                }
                let mut entries = resolve_library(lib, &libraries_dir);
                resolved_libs.append(&mut entries);
            }
        }
    }

    // Download missing libraries concurrently
    let mut missing_lib_tasks: Vec<DownloadTask> = Vec::new();
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();

    for lib in &resolved_libs {
        if !lib.path.exists() && seen_paths.insert(lib.path.clone()) {
            if let Some(url) = &lib.url {
                let name = lib
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "library.jar".to_string());
                missing_lib_tasks.push(DownloadTask {
                    url: url.clone(),
                    dest: lib.path.clone(),
                    label: name,
                });
            }
        }
    }

    if !missing_lib_tasks.is_empty() {
        let total = missing_lib_tasks.len() as u64;
        emit_log(
            &app,
            "system",
            format!("{} adet eksik kütüphane indiriliyor...", total),
        );
        let sem = Arc::new(Semaphore::new(10));
        let mut handles = Vec::new();
        for task in missing_lib_tasks {
            let c = client.clone();
            let s = sem.clone();
            handles.push(tokio::spawn(async move {
                let _permit = s.acquire().await.ok()?;
                let res = download_with_fallbacks(&c, &task.url, &task.dest).await;
                Some((task.label, res))
            }));
        }
        let mut done: u64 = 0;
        for h in handles {
            if let Ok(Some((label, res))) = h.await {
                done += 1;
                if let Err(e) = res {
                    emit_log(&app, "warn", format!("Kütüphane indirilemedi ({}): {}", label, e));
                }
                let _ = app.emit(
                    "launcher-progress",
                    ProgressEvent {
                        stage: "classes".to_string(),
                        task: done,
                        total,
                        message: format!("Kütüphaneler: {} ({}/{})", label, done, total),
                    },
                );
            }
        }
    }

    // Extract natives & build classpath
    let mut classpath_entries: Vec<String> = Vec::new();
    let mut cp_seen: HashSet<PathBuf> = HashSet::new();

    for lib in &resolved_libs {
        if lib.is_native {
            if lib.path.exists() {
                extract_native_jar(&lib.path, &natives_dir, &lib.extract_exclude);
            }
        } else if lib.path.exists() {
            if cp_seen.insert(lib.path.clone()) {
                classpath_entries.push(lib.path.to_string_lossy().to_string());
            }
        } else if lib.url.is_none() {
            emit_log(
                &app,
                "warn",
                format!(
                    "[Uyarı] Yerel kütüphane bulunamadı (Forge/Mod kurulumu eksik olabilir): {}",
                    lib.path.display()
                ),
            );
        }
    }

    // Add client jar to classpath unless using ModLauncher/BootstrapLauncher (Forge 1.17+)
    if !is_modlauncher {
        let custom_jar = game_root
            .join("versions")
            .join(&version_id)
            .join(format!("{}.jar", version_id));
        if custom_jar.exists() && cp_seen.insert(custom_jar.clone()) {
            classpath_entries.push(custom_jar.to_string_lossy().to_string());
        } else if base_jar_path.exists() && cp_seen.insert(base_jar_path.clone()) {
            classpath_entries.push(base_jar_path.to_string_lossy().to_string());
        }
    }

    // 5. Asset Index & Assets Download
    let assets_dir = game_root.join("assets");
    let indexes_dir = assets_dir.join("indexes");
    let objects_dir = assets_dir.join("objects");
    let _ = fs::create_dir_all(&indexes_dir);
    let _ = fs::create_dir_all(&objects_dir);

    let asset_index_obj = chain
        .iter()
        .rev()
        .find_map(|j| j.get("assetIndex"))
        .or_else(|| child_json.get("assetIndex"));

    let asset_index_id = asset_index_obj
        .and_then(|a| a.get("id"))
        .and_then(|v| v.as_str())
        .or_else(|| root_json.get("assets").and_then(|v| v.as_str()))
        .unwrap_or(&base_version_id)
        .to_string();

    let asset_index_file = indexes_dir.join(format!("{}.json", asset_index_id));
    if !asset_index_file.exists() {
        if let Some(url) = asset_index_obj.and_then(|a| a.get("url")).and_then(|u| u.as_str()) {
            emit_log(&app, "system", format!("Varlık indeksi ({}.json) indiriliyor...", asset_index_id));
            download_to_file(&client, url, &asset_index_file).await?;
        }
    }

    if let Ok(idx_raw) = fs::read_to_string(&asset_index_file) {
        if let Ok(idx_json) = serde_json::from_str::<Value>(&idx_raw) {
            if let Some(objects) = idx_json.get("objects").and_then(|o| o.as_object()) {
                let mut missing_assets: Vec<DownloadTask> = Vec::new();
                for (_name, obj) in objects {
                    if let Some(hash) = obj.get("hash").and_then(|h| h.as_str()) {
                        if hash.len() >= 2 {
                            let prefix = &hash[..2];
                            let dest = objects_dir.join(prefix).join(hash);
                            if !dest.exists() {
                                let url = format!(
                                    "https://resources.download.minecraft.net/{}/{}",
                                    prefix, hash
                                );
                                missing_assets.push(DownloadTask {
                                    url,
                                    dest,
                                    label: hash[..8].to_string(),
                                });
                            }
                        }
                    }
                }

                if !missing_assets.is_empty() {
                    let total = missing_assets.len() as u64;
                    emit_log(
                        &app,
                        "system",
                        format!("{} adet eksik oyun varlığı (ses/doku) indiriliyor...", total),
                    );
                    let sem = Arc::new(Semaphore::new(16));
                    let mut handles = Vec::new();
                    for task in missing_assets {
                        let c = client.clone();
                        let s = sem.clone();
                        handles.push(tokio::spawn(async move {
                            let _permit = s.acquire().await.ok()?;
                            let _ = download_to_file(&c, &task.url, &task.dest).await;
                            Some(task.label)
                        }));
                    }
                    let mut done: u64 = 0;
                    for h in handles {
                        if h.await.is_ok() {
                            done += 1;
                            if done % 25 == 0 || done == total {
                                let _ = app.emit(
                                    "launcher-progress",
                                    ProgressEvent {
                                        stage: "assets".to_string(),
                                        task: done,
                                        total,
                                        message: format!("Varlıklar indiriliyor ({}/{})", done, total),
                                    },
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    // 6. Build JVM & Game Arguments (root -> child order!)
    let has_custom_res = true;
    let res_w = config.resolution_width.unwrap_or(1280).to_string();
    let res_h = config.resolution_height.unwrap_or(720).to_string();
    let joined_cp = classpath_entries.join(";");

    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("${auth_player_name}", player_name.clone());
    vars.insert("${version_name}", version_id.clone());
    vars.insert("${game_directory}", game_root.to_string_lossy().to_string());
    vars.insert("${assets_root}", assets_dir.to_string_lossy().to_string());
    vars.insert("${game_assets}", assets_dir.to_string_lossy().to_string());
    vars.insert("${assets_index_name}", asset_index_id.clone());
    vars.insert("${auth_uuid}", player_uuid.clone());
    vars.insert("${auth_access_token}", "null".to_string());
    vars.insert("${user_type}", "mojang".to_string());
    vars.insert("${version_type}", "release".to_string());
    vars.insert("${user_properties}", "{}".to_string());
    vars.insert("${natives_directory}", natives_dir.to_string_lossy().to_string());
    vars.insert("${launcher_name}", "LxClient".to_string());
    vars.insert("${launcher_version}", "2.0.0".to_string());
    vars.insert("${library_directory}", libraries_dir.to_string_lossy().to_string());
    vars.insert("${classpath_separator}", ";".to_string());
    vars.insert("${classpath}", joined_cp.clone());
    vars.insert("${resolution_width}", res_w.clone());
    vars.insert("${resolution_height}", res_h.clone());

    let mut raw_jvm_args: Vec<String> = Vec::new();
    let mut raw_game_args: Vec<String> = Vec::new();

    for j in chain.iter().rev() {
        if let Some(args_obj) = j.get("arguments") {
            let jvm = collect_arguments(args_obj.get("jvm").and_then(|v| v.as_array()), has_custom_res);
            raw_jvm_args.extend(jvm);
            let game = collect_arguments(args_obj.get("game").and_then(|v| v.as_array()), has_custom_res);
            raw_game_args.extend(game);
        }
    }

    // Legacy minecraftArguments fallback (1.12.2 and earlier)
    if raw_game_args.is_empty() {
        for j in &chain {
            if let Some(mc_args) = j.get("minecraftArguments").and_then(|v| v.as_str()) {
                raw_game_args = mc_args.split_whitespace().map(|s| s.to_string()).collect();
                break;
            }
        }
    }

    let mut final_args: Vec<String> = Vec::new();
    let mem_max = config.memory_max.max(512);
    let mem_min = (mem_max / 2).max(512);
    final_args.push(format!("-Xms{}M", mem_min));
    final_args.push(format!("-Xmx{}M", mem_max));

    // Offline auth overrides
    final_args.push("-Dminecraft.api.env=custom".to_string());
    final_args.push("-Dminecraft.api.auth.host=https://localhost".to_string());
    final_args.push("-Dminecraft.api.account.host=https://localhost".to_string());
    final_args.push("-Dminecraft.api.session.host=https://localhost".to_string());
    final_args.push("-Dminecraft.api.services.host=https://localhost".to_string());

    if config.aikar_flags.unwrap_or(false) {
        for flag in [
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
            "-XX:+PerfDisableSharedMem",
        ] {
            final_args.push(flag.to_string());
        }
        emit_log(&app, "system", "Aikar's JVM performans bayrakları aktif.");
    }

    let mut has_cp = false;
    let mut has_lib_path = false;
    for arg in raw_jvm_args {
        let sub = substitute_vars(&arg, &vars);
        if sub == "-cp" || sub == "-classpath" {
            has_cp = true;
        }
        if sub.starts_with("-Djava.library.path=") {
            has_lib_path = true;
        }
        final_args.push(sub);
    }

    if !has_lib_path {
        final_args.push(format!("-Djava.library.path={}", natives_dir.display()));
    }
    if !has_cp {
        final_args.push("-cp".to_string());
        final_args.push(joined_cp);
    }

    // Main Class
    final_args.push(main_class);

    // Game Args (filter --demo and ${quickPlay...})
    let mut clean_game_args: Vec<String> = Vec::new();
    let mut skip_next = false;
    for arg in raw_game_args {
        if skip_next {
            skip_next = false;
            continue;
        }
        let trimmed = arg.trim();
        if trimmed == "--demo" {
            continue;
        }
        if trimmed == "--quickPlayPath"
            || trimmed == "--quickPlaySingleplayer"
            || trimmed == "--quickPlayMultiplayer"
            || trimmed == "--quickPlayRealms"
        {
            skip_next = true;
            continue;
        }
        if trimmed.contains("${quickPlay") {
            continue;
        }
        clean_game_args.push(substitute_vars(&arg, &vars));
    }

    if config.fullscreen.unwrap_or(false) && !clean_game_args.iter().any(|a| a == "--fullscreen") {
        clean_game_args.push("--fullscreen".to_string());
    }
    if !clean_game_args.iter().any(|a| a == "--width") {
        clean_game_args.push("--width".to_string());
        clean_game_args.push(res_w);
        clean_game_args.push("--height".to_string());
        clean_game_args.push(res_h);
    }

    final_args.extend(clean_game_args);

    emit_log(
        &app,
        "system",
        format!("Minecraft başlatılıyor (Java {})...", java_info.major),
    );

    let mut cmd = Command::new(&java_info.path);
    cmd.current_dir(&game_root)
        .args(&final_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Java süreci başlatılamadı ({}): {}", java_info.path, e))?;

    let _ = app.emit("launcher-started", ());

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_out = app.clone();
    std::thread::spawn(move || {
        if let Some(out) = stdout {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_out.emit(
                    "launcher-log",
                    LogEvent {
                        log_type: "data".to_string(),
                        text: line,
                    },
                );
            }
        }
    });

    let app_err = app.clone();
    std::thread::spawn(move || {
        if let Some(err) = stderr {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_err.emit(
                    "launcher-log",
                    LogEvent {
                        log_type: "error".to_string(),
                        text: line,
                    },
                );
            }
        }
    });

    let app_wait = app.clone();
    std::thread::spawn(move || {
        let code = match child.wait() {
            Ok(status) => status.code().unwrap_or(0),
            Err(_) => -1,
        };
        let _ = app_wait.emit("launcher-close", code);
    });

    Ok(())
}
