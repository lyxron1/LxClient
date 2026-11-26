use crate::models::{InstalledVersion, LauncherSettings};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use sysinfo::System;

pub fn get_total_ram_mb() -> u64 {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let mb = sys.total_memory() / (1024 * 1024);
    if mb == 0 {
        8192
    } else {
        mb
    }
}

pub fn get_user_data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("lxclient")
}

pub fn get_settings_file_path() -> PathBuf {
    get_user_data_dir().join("settings.json")
}

pub fn get_default_game_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(".minecraft")
}

pub fn sanitize_game_path(raw: Option<&str>) -> PathBuf {
    match raw {
        Some(s) if !s.trim().is_empty() => PathBuf::from(s.trim()),
        _ => get_default_game_dir(),
    }
}

pub fn default_settings() -> LauncherSettings {
    let total_mem_mb = get_total_ram_mb();
    let default_ram = if total_mem_mb <= 4096 {
        2560.min(total_mem_mb.saturating_sub(512)).max(1024)
    } else {
        4096
    };
    let default_dir = get_default_game_dir().to_string_lossy().to_string();

    LauncherSettings {
        game_directory: default_dir.clone(),
        game_path: default_dir,
        resolution_width: 1280,
        resolution_height: 720,
        fullscreen: false,
        java_path: String::new(),
        ram: default_ram,
        last_username: String::new(),
        last_version: "1.20.4".to_string(),
        aikar_flags: false,
        theme: "purple".to_string(),
    }
}

pub fn load_settings() -> LauncherSettings {
    let defaults = default_settings();
    let path = get_settings_file_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(mut parsed) = serde_json::from_str::<LauncherSettings>(&raw) {
            let effective = if !parsed.game_path.trim().is_empty() {
                parsed.game_path.trim().to_string()
            } else if !parsed.game_directory.trim().is_empty() {
                parsed.game_directory.trim().to_string()
            } else {
                defaults.game_directory.clone()
            };
            parsed.game_path = effective.clone();
            parsed.game_directory = effective;
            if parsed.resolution_width == 0 {
                parsed.resolution_width = defaults.resolution_width;
            }
            if parsed.resolution_height == 0 {
                parsed.resolution_height = defaults.resolution_height;
            }
            if parsed.ram < 512 {
                parsed.ram = defaults.ram;
            }
            return parsed;
        }
    }
    defaults
}

pub fn save_settings_to_disk(settings: &LauncherSettings) -> Result<(), String> {
    let path = get_settings_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Ayar klasörü oluşturulamadı: {}", e))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Ayarlar serileştirilemedi: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Ayarlar yazılamadı: {}", e))?;
    Ok(())
}

pub fn initialize_game_directory(game_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(game_dir)
        .map_err(|e| format!("Oyun dizini oluşturulamadı ({}): {}", game_dir.display(), e))?;
    for sub in [
        "mods",
        "versions",
        "resourcepacks",
        "shaderpacks",
        "screenshots",
        "saves",
        "assets",
        "libraries",
    ] {
        let sub_path = game_dir.join(sub);
        if !sub_path.exists() {
            let _ = fs::create_dir_all(&sub_path);
        }
    }
    Ok(())
}

pub fn ensure_multiplayer_unlocked(game_dir: &Path) {
    let _ = fs::create_dir_all(game_dir);
    let options_path = game_dir.join("options.txt");
    let mut map: BTreeMap<String, String> = BTreeMap::new();

    if let Ok(content) = fs::read_to_string(&options_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some((k, v)) = trimmed.split_once(':') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }

    map.insert("isDemoUser".to_string(), "false".to_string());
    map.insert("joinedFirstServer".to_string(), "true".to_string());
    map.insert("skipMultiplayerWarning".to_string(), "true".to_string());
    map.insert("chatVisibility".to_string(), "0".to_string());
    map.insert("realmsNotifications".to_string(), "false".to_string());

    let mut out = String::new();
    for (k, v) in map {
        out.push_str(&format!("{}:{}\n", k, v));
    }
    let _ = fs::write(&options_path, out);
}

fn detect_version_kind(ver_id: &str, json: &Value) -> String {
    let lower_id = ver_id.to_lowercase();
    let main_class = json
        .get("mainClass")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();

    if lower_id.contains("neoforge") || main_class.contains("neoforge") {
        return "neoforge".to_string();
    }
    if lower_id.contains("forge")
        || main_class.contains("minecraftforge")
        || main_class.contains("bootstraplauncher")
        || main_class.contains("modlauncher")
        || main_class.contains("launchwrapper")
    {
        return "forge".to_string();
    }
    if lower_id.contains("fabric") || main_class.contains("fabricmc") || main_class.contains("knotclient") {
        return "fabric".to_string();
    }
    if lower_id.contains("quilt") || main_class.contains("quiltmc") {
        return "quilt".to_string();
    }
    if json.get("inheritsFrom").is_some() {
        return "custom".to_string();
    }
    "vanilla".to_string()
}

pub fn scan_installed_versions(game_dir: &Path) -> Vec<InstalledVersion> {
    let versions_dir = game_dir.join("versions");
    if !versions_dir.exists() {
        return Vec::new();
    }

    let mut installed = Vec::new();
    let Ok(entries) = fs::read_dir(&versions_dir) else {
        return installed;
    };

    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() {
            continue;
        }
        let ver_id = entry.file_name().to_string_lossy().to_string();
        let dir_path = entry.path();
        let json_path = dir_path.join(format!("{}.json", ver_id));
        let jar_path = dir_path.join(format!("{}.jar", ver_id));

        if !json_path.exists() {
            continue;
        }

        let Ok(raw_json) = fs::read_to_string(&json_path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<Value>(&raw_json) else {
            continue;
        };

        let inherits_from = parsed
            .get("inheritsFrom")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let has_jar = jar_path.exists();
        let kind = detect_version_kind(&ver_id, &parsed);

        if has_jar || inherits_from.is_some() || kind != "vanilla" {
            installed.push(InstalledVersion {
                id: ver_id,
                kind,
                inherits_from,
            });
        }
    }

    installed.sort_by(|a, b| b.id.cmp(&a.id));
    installed
}
