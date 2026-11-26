mod java;
mod launcher;
mod models;
mod mods;
mod settings;

use crate::java::{ensure_java_runtime, get_system_java_info};
use crate::launcher::{fetch_mojang_manifest, launch_minecraft};
use crate::models::{
    ActionResult, InstalledVersion, JavaInfo, LaunchConfig, LauncherSettings, LogEvent,
    ModItem, MojangVersion, RuntimeStats, ScreenshotItem, SystemInfo,
};
use crate::mods::{delete_mod_file, install_mod_files, list_mods_in_root, toggle_mod_file};
use crate::settings::{
    default_settings, get_default_game_dir, get_total_ram_mb, get_user_data_dir,
    initialize_game_directory, load_settings, sanitize_game_path, save_settings_to_disk,
    scan_installed_versions,
};
use base64::Engine;
use chrono::{DateTime, Local};
use image::ImageReader;
use md5::{Digest, Md5};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;

struct AppState {
    active_game_dir: Mutex<PathBuf>,
    mojang_cache: Mutex<Option<Vec<MojangVersion>>>,
    sys_monitor: Mutex<System>,
    thumb_semaphore: Arc<Semaphore>,
}

#[tauri::command]
fn get_system_info(state: State<AppState>) -> SystemInfo {
    let total_mem_mb = get_total_ram_mb();
    let settings = load_settings();
    let default_dir = get_default_game_dir();
    let effective = sanitize_game_path(Some(&settings.game_path));
    let _ = initialize_game_directory(&effective);

    if let Ok(mut guard) = state.active_game_dir.lock() {
        *guard = effective.clone();
    }

    let installed_versions = scan_installed_versions(&effective);
    let system_java = get_system_java_info();

    SystemInfo {
        total_mem_mb,
        default_game_dir: default_dir.to_string_lossy().to_string(),
        active_game_dir: effective.to_string_lossy().to_string(),
        settings,
        installed_versions,
        system_java,
    }
}

#[tauri::command]
fn get_installed_versions(state: State<AppState>, custom_dir: Option<String>) -> Vec<InstalledVersion> {
    let dir = match custom_dir {
        Some(ref s) if !s.trim().is_empty() => PathBuf::from(s.trim()),
        _ => state
            .active_game_dir
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| get_default_game_dir()),
    };
    scan_installed_versions(&dir)
}

#[tauri::command]
async fn get_mojang_versions(state: State<'_, AppState>) -> Result<Vec<MojangVersion>, String> {
    if let Ok(guard) = state.mojang_cache.lock() {
        if let Some(ref cached) = *guard {
            if !cached.is_empty() {
                return Ok(cached.clone());
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("LxClient/2.0")
        .build()
        .map_err(|e| e.to_string())?;
    let list = fetch_mojang_manifest(&client).await?;

    if let Ok(mut guard) = state.mojang_cache.lock() {
        *guard = Some(list.clone());
    }
    Ok(list)
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: State<AppState>,
    mut new_settings: LauncherSettings,
) -> ActionResult {
    let target = sanitize_game_path(Some(&new_settings.game_path));
    let target_str = target.to_string_lossy().to_string();
    new_settings.game_path = target_str.clone();
    new_settings.game_directory = target_str.clone();

    let path_changed = state
        .active_game_dir
        .lock()
        .map(|g| *g != target)
        .unwrap_or(false);

    if let Ok(mut guard) = state.active_game_dir.lock() {
        *guard = target.clone();
    }

    if let Err(e) = initialize_game_directory(&target) {
        return ActionResult {
            success: false,
            message: None,
            error: Some(e),
        };
    }

    if let Err(e) = save_settings_to_disk(&new_settings) {
        return ActionResult {
            success: false,
            message: None,
            error: Some(e),
        };
    }

    if path_changed {
        let _ = app.emit(
            "launcher-log",
            LogEvent {
                log_type: "system".to_string(),
                text: format!("[Ayar] Aktif oyun dizini güncellendi: {}", target_str),
            },
        );
        let _ = app.emit("game-directory-changed", target_str);
    }

    ActionResult {
        success: true,
        message: Some("Ayarlar kaydedildi.".to_string()),
        error: None,
    }
}

#[tauri::command]
fn reset_settings(state: State<AppState>) -> Result<LauncherSettings, String> {
    let defaults = default_settings();
    let target = PathBuf::from(&defaults.game_path);
    if let Ok(mut guard) = state.active_game_dir.lock() {
        *guard = target.clone();
    }
    let _ = initialize_game_directory(&target);
    save_settings_to_disk(&defaults)?;
    Ok(defaults)
}

#[tauri::command]
fn open_special_folder(state: State<AppState>, folder_type: String) -> ActionResult {
    let root = state
        .active_game_dir
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| get_default_game_dir());
    let _ = initialize_game_directory(&root);

    let target = if folder_type == "root" {
        root
    } else {
        root.join(&folder_type)
    };

    if !target.exists() {
        let _ = fs::create_dir_all(&target);
    }

    #[cfg(windows)]
    let res = Command::new("explorer").arg(&target).spawn();
    #[cfg(target_os = "macos")]
    let res = Command::new("open").arg(&target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let res = Command::new("xdg-open").arg(&target).spawn();

    match res {
        Ok(_) => ActionResult {
            success: true,
            message: Some(target.to_string_lossy().to_string()),
            error: None,
        },
        Err(e) => ActionResult {
            success: false,
            message: None,
            error: Some(format!("Klasör açılamadı: {}", e)),
        },
    }
}

fn get_thumb_cache_path(file_path: &Path, mtime_ms: u64, size: u64) -> PathBuf {
    let cache_dir = get_user_data_dir().join("thumb_cache");
    let _ = fs::create_dir_all(&cache_dir);
    let mut hasher = Md5::new();
    hasher.update(format!("{}_{}_{}", file_path.to_string_lossy(), mtime_ms, size).as_bytes());
    let key: String = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect();
    cache_dir.join(format!("{}.jpg", key))
}

fn read_cached_thumb_data_uri(cache_path: &Path) -> Option<String> {
    let bytes = fs::read(cache_path).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
fn get_screenshots(state: State<AppState>) -> Vec<ScreenshotItem> {
    let root = state
        .active_game_dir
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| get_default_game_dir());
    let dir = root.join("screenshots");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
        return Vec::new();
    }

    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut items = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "png" && ext != "jpg" && ext != "jpeg" {
            continue;
        }

        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let file_size = meta.len();

        let date_str = meta
            .modified()
            .ok()
            .map(|t| {
                let dt: DateTime<Local> = t.into();
                dt.format("%d.%m.%Y %H:%M").to_string()
            })
            .unwrap_or_default();

        // Fast header-only dimension read (does not decode pixels)
        let (width, height) = image::image_dimensions(&path).unwrap_or((1920, 1080));

        // Only return already-cached thumbnails here; uncached ones load lazily via get_screenshot_thumbnail
        let cache_path = get_thumb_cache_path(&path, mtime_ms, file_size);
        let thumbnail = if cache_path.exists() {
            read_cached_thumb_data_uri(&cache_path).unwrap_or_default()
        } else {
            String::new()
        };

        items.push(ScreenshotItem {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            mtime: mtime_ms,
            date_str,
            size: file_size,
            thumbnail,
            width,
            height,
        });
    }

    items.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    items
}

#[tauri::command]
async fn get_screenshot_thumbnail(state: State<'_, AppState>, file_path: String) -> Result<Option<String>, String> {
    let permit = state
        .thumb_semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;

    let res = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return None;
        }
        let meta = fs::metadata(&path).ok()?;
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let file_size = meta.len();
        let cache_path = get_thumb_cache_path(&path, mtime_ms, file_size);

        if cache_path.exists() {
            if let Some(uri) = read_cached_thumb_data_uri(&cache_path) {
                return Some(uri);
            }
        }

        let img = ImageReader::open(&path).ok()?.decode().ok()?;
        let thumb = img.thumbnail(420, 420);
        let mut buf = Cursor::new(Vec::new());
        thumb.write_to(&mut buf, image::ImageFormat::Jpeg).ok()?;
        let bytes = buf.into_inner();
        let _ = fs::write(&cache_path, &bytes);
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        Some(format!("data:image/jpeg;base64,{}", b64))
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
fn get_runtime_stats(state: State<AppState>) -> RuntimeStats {
    if let Ok(mut sys) = state.sys_monitor.lock() {
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let cpu = sys.global_cpu_usage();
        let total = sys.total_memory();
        let used = sys.used_memory();
        let ram_pct = if total > 0 {
            (used as f32 / total as f32) * 100.0
        } else {
            0.0
        };
        return RuntimeStats {
            cpu_usage: cpu.clamp(0.0, 100.0),
            ram_usage: ram_pct.clamp(0.0, 100.0),
            used_ram_mb: used / (1024 * 1024),
            total_ram_mb: total / (1024 * 1024),
        };
    }
    RuntimeStats {
        cpu_usage: 0.0,
        ram_usage: 0.0,
        used_ram_mb: 0,
        total_ram_mb: 8192,
    }
}

#[tauri::command]
fn get_screenshot_full(file_path: String) -> Option<String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = if ext == "jpg" || ext == "jpeg" {
        "image/jpeg"
    } else {
        "image/png"
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
fn show_item_in_folder(file_path: String) -> ActionResult {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return ActionResult {
            success: false,
            message: None,
            error: Some("Dosya bulunamadı".to_string()),
        };
    }

    #[cfg(windows)]
    let res = Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn();
    #[cfg(not(windows))]
    let res = Command::new("xdg-open")
        .arg(path.parent().unwrap_or(&path))
        .spawn();

    match res {
        Ok(_) => ActionResult {
            success: true,
            message: None,
            error: None,
        },
        Err(e) => ActionResult {
            success: false,
            message: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
fn copy_screenshot_to_clipboard(file_path: String) -> ActionResult {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return ActionResult {
            success: false,
            message: None,
            error: Some("Dosya bulunamadı".to_string()),
        };
    }

    let img = match ImageReader::open(&path).and_then(|r| r.decode().map_err(std::io::Error::other)) {
        Ok(i) => i.to_rgba8(),
        Err(e) => {
            return ActionResult {
                success: false,
                message: None,
                error: Some(format!("Görsel okunamadı: {}", e)),
            }
        }
    };

    let (width, height) = img.dimensions();
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            return ActionResult {
                success: false,
                message: None,
                error: Some(format!("Pano açılamadı: {}", e)),
            }
        }
    };

    let img_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Owned(img.into_raw()),
    };

    match clipboard.set_image(img_data) {
        Ok(_) => ActionResult {
            success: true,
            message: Some("Panoya kopyalandı".to_string()),
            error: None,
        },
        Err(e) => ActionResult {
            success: false,
            message: None,
            error: Some(format!("Panoya kopyalanamadı: {}", e)),
        },
    }
}

#[tauri::command]
async fn select_game_dir() -> Option<String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let script = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Minecraft Oyun Klasörünü Seçin'; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }";
            let out = Command::new("powershell")
                .args(["-NoProfile", "-STA", "-Command", script])
                .creation_flags(0x08000000)
                .output()
                .ok()?;
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        #[cfg(not(windows))]
        {
            None
        }
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn select_java_path() -> Option<String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let script = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Java Yürütülebilir Dosyasını (javaw.exe) Seçin'; $d.Filter = 'Java Executable (*.exe)|*.exe|All Files (*.*)|*.*'; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }";
            let out = Command::new("powershell")
                .args(["-NoProfile", "-STA", "-Command", script])
                .creation_flags(0x08000000)
                .output()
                .ok()?;
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        #[cfg(not(windows))]
        {
            None
        }
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn get_mods(state: State<'_, AppState>) -> Result<Vec<ModItem>, String> {
    let root = state
        .active_game_dir
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| get_default_game_dir());
    tokio::task::spawn_blocking(move || list_mods_in_root(&root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_mod(state: State<AppState>, file_name: String, enable: bool) -> ActionResult {
    let root = state
        .active_game_dir
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| get_default_game_dir());
    match toggle_mod_file(&root, &file_name, enable) {
        Ok(new_path) => ActionResult {
            success: true,
            message: Some(new_path.to_string_lossy().to_string()),
            error: None,
        },
        Err(e) => ActionResult {
            success: false,
            message: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
fn delete_mod(state: State<AppState>, file_name: String, enabled: bool) -> ActionResult {
    let root = state
        .active_game_dir
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| get_default_game_dir());
    match delete_mod_file(&root, &file_name, enabled) {
        Ok(_) => ActionResult {
            success: true,
            message: Some(format!("Mod silindi: {}", file_name)),
            error: None,
        },
        Err(e) => ActionResult {
            success: false,
            message: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
fn install_mods_from_paths(state: State<AppState>, paths: Vec<String>) -> ActionResult {
    let root = state
        .active_game_dir
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| get_default_game_dir());
    if paths.is_empty() {
        return ActionResult {
            success: false,
            message: None,
            error: Some("Yüklenecek dosya seçilmedi.".to_string()),
        };
    }
    match install_mod_files(&root, paths) {
        Ok(installed) => ActionResult {
            success: true,
            message: Some(format!("{} mod yüklendi.", installed.len())),
            error: None,
        },
        Err(e) => ActionResult {
            success: false,
            message: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
async fn select_and_install_mods(state: State<'_, AppState>) -> Result<ActionResult, String> {
    let root = state
        .active_game_dir
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| get_default_game_dir());

    let selected_paths = tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let script = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Yüklenecek Mod Dosyalarını Seçin (.jar)'; $d.Filter = 'Minecraft Mods (*.jar)|*.jar'; $d.Multiselect = $true; if ($d.ShowDialog() -eq 'OK') { $d.FileNames | ForEach-Object { Write-Output $_ } }";
            let out = Command::new("powershell")
                .args(["-NoProfile", "-STA", "-Command", script])
                .creation_flags(0x08000000)
                .output()
                .ok()?;
            let paths: Vec<String> = String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            Some(paths)
        }
        #[cfg(not(windows))]
        {
            None::<Vec<String>>
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(paths) = selected_paths else {
        return Ok(ActionResult {
            success: false,
            message: None,
            error: None,
        });
    };
    if paths.is_empty() {
        return Ok(ActionResult {
            success: false,
            message: None,
            error: None,
        });
    }

    match install_mod_files(&root, paths) {
        Ok(installed) => Ok(ActionResult {
            success: true,
            message: Some(format!("{} mod yüklendi.", installed.len())),
            error: None,
        }),
        Err(e) => Ok(ActionResult {
            success: false,
            message: None,
            error: Some(e),
        }),
    }
}

#[tauri::command]
async fn check_java(app: AppHandle, requested_major: Option<u32>) -> Result<JavaInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("LxClient/2.0")
        .build()
        .map_err(|e| e.to_string())?;
    ensure_java_runtime(&app, &client, None, requested_major.unwrap_or(21)).await
}

#[tauri::command]
async fn launch_game(app: AppHandle, config: LaunchConfig) -> ActionResult {
    match launch_minecraft(app.clone(), config).await {
        Ok(_) => ActionResult {
            success: true,
            message: Some("Oyun başlatıldı".to_string()),
            error: None,
        },
        Err(err) => {
            let _ = app.emit("launcher-error", err.clone());
            let _ = app.emit(
                "launcher-log",
                LogEvent {
                    log_type: "error".to_string(),
                    text: format!("[Başlatma Hatası] {}", err),
                },
            );
            ActionResult {
                success: false,
                message: None,
                error: Some(err),
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_settings = load_settings();
    let initial_dir = sanitize_game_path(Some(&initial_settings.game_path));

    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    tauri::Builder::default()
        .manage(AppState {
            active_game_dir: Mutex::new(initial_dir),
            mojang_cache: Mutex::new(None),
            sys_monitor: Mutex::new(sys),
            thumb_semaphore: Arc::new(Semaphore::new(4)),
        })
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            get_runtime_stats,
            get_installed_versions,
            get_mojang_versions,
            save_settings,
            reset_settings,
            open_special_folder,
            get_screenshots,
            get_screenshot_thumbnail,
            get_screenshot_full,
            show_item_in_folder,
            copy_screenshot_to_clipboard,
            select_game_dir,
            select_java_path,
            get_mods,
            toggle_mod,
            delete_mod,
            install_mods_from_paths,
            select_and_install_mods,
            check_java,
            launch_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
