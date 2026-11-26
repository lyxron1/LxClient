use crate::models::ModItem;
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Default)]
struct ParsedMeta {
    id: Option<String>,
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    loader: Option<String>,
}

fn read_entry_string(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    let mut content = String::new();
    // Limit metadata read to 512 KB for safety
    let _ = entry.by_ref().take(512 * 1024).read_to_string(&mut content);
    Some(content)
}

fn parse_fabric_json(raw: &str) -> Option<ParsedMeta> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let id = v.get("id").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let name = v.get("name").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let version = v.get("version").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let description = v.get("description").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    // Confirm fabric loader from depends or presence of fabric.mod.json
    let _depends = v.get("depends");
    Some(ParsedMeta {
        id,
        name,
        version,
        description,
        loader: Some("fabric".to_string()),
    })
}

fn parse_quilt_json(raw: &str) -> Option<ParsedMeta> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let ql = v.get("quilt_loader")?;
    let id = ql.get("id").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let version = ql.get("version").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let meta = ql.get("metadata");
    let name = meta.and_then(|m| m.get("name")).and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let description = meta.and_then(|m| m.get("description")).and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    Some(ParsedMeta {
        id,
        name,
        version,
        description,
        loader: Some("quilt".to_string()),
    })
}

fn extract_toml_value(line: &str, key: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.starts_with('#') {
        return None;
    }
    let (k, rest) = trimmed.split_once('=')?;
    if k.trim() != key {
        return None;
    }
    let val = rest.split('#').next()?.trim();
    let unquoted = val.trim_matches('"').trim_matches('\'').trim();
    if unquoted.is_empty() || unquoted.contains("${") {
        None
    } else {
        Some(unquoted.to_string())
    }
}

fn parse_mods_toml(raw: &str, loader_name: &str) -> Option<ParsedMeta> {
    let mut meta = ParsedMeta {
        loader: Some(loader_name.to_string()),
        ..Default::default()
    };
    let mut in_mods_section = false;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[[") {
            in_mods_section = trimmed == "[[mods]]";
            continue;
        }
        if !in_mods_section {
            continue;
        }
        if meta.id.is_none() {
            meta.id = extract_toml_value(trimmed, "modId");
        }
        if meta.name.is_none() {
            meta.name = extract_toml_value(trimmed, "displayName");
        }
        if meta.version.is_none() {
            meta.version = extract_toml_value(trimmed, "version");
        }
        if meta.description.is_none() {
            meta.description = extract_toml_value(trimmed, "description");
        }
    }

    Some(meta)
}

fn parse_mcmod_info(raw: &str) -> Option<ParsedMeta> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let entry = if let Some(arr) = v.as_array() {
        arr.first()?
    } else if let Some(arr) = v.get("modList").and_then(|m| m.as_array()) {
        arr.first()?
    } else {
        &v
    };

    let id = entry.get("modid").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let name = entry.get("name").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let version = entry.get("version").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && !s.contains("${"));
    let description = entry.get("description").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    Some(ParsedMeta {
        id,
        name,
        version,
        description,
        loader: Some("forge".to_string()),
    })
}

fn inspect_mod_jar(path: &Path) -> ParsedMeta {
    let Ok(file) = fs::File::open(path) else {
        return ParsedMeta::default();
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return ParsedMeta::default();
    };

    if let Some(raw) = read_entry_string(&mut archive, "fabric.mod.json") {
        if let Some(meta) = parse_fabric_json(&raw) {
            return meta;
        }
    }
    if let Some(raw) = read_entry_string(&mut archive, "quilt.mod.json") {
        if let Some(meta) = parse_quilt_json(&raw) {
            return meta;
        }
    }
    if let Some(raw) = read_entry_string(&mut archive, "META-INF/neoforge.mods.toml") {
        if let Some(meta) = parse_mods_toml(&raw, "neoforge") {
            return meta;
        }
    }
    if let Some(raw) = read_entry_string(&mut archive, "META-INF/mods.toml") {
        if let Some(meta) = parse_mods_toml(&raw, "forge") {
            return meta;
        }
    }
    if let Some(raw) = read_entry_string(&mut archive, "mcmod.info") {
        if let Some(meta) = parse_mcmod_info(&raw) {
            return meta;
        }
    }

    ParsedMeta::default()
}

fn scan_dir_mods(dir: &Path, enabled: bool, out: &mut Vec<ModItem>) {
    if !dir.exists() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

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
        if ext != "jar" {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let meta = inspect_mod_jar(&path);

        let fallback_name = file_name.strip_suffix(".jar").unwrap_or(&file_name).to_string();
        out.push(ModItem {
            id: meta.id.unwrap_or_else(|| file_name.clone()),
            name: meta.name.unwrap_or(fallback_name),
            file_name,
            path: path.to_string_lossy().to_string(),
            version: meta.version,
            description: meta.description,
            loader: meta.loader,
            size,
            enabled,
        });
    }
}

pub fn list_mods_in_root(game_root: &Path) -> Vec<ModItem> {
    let mods_dir = game_root.join("mods");
    let disabled_dir = game_root.join("disabled-mods");
    let _ = fs::create_dir_all(&mods_dir);

    let mut items = Vec::new();
    scan_dir_mods(&mods_dir, true, &mut items);
    scan_dir_mods(&disabled_dir, false, &mut items);

    items.sort_by(|a, b| {
        b.enabled
            .cmp(&a.enabled)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    items
}

pub fn toggle_mod_file(game_root: &Path, file_name: &str, enable: bool) -> Result<PathBuf, String> {
    let mods_dir = game_root.join("mods");
    let disabled_dir = game_root.join("disabled-mods");
    fs::create_dir_all(&mods_dir).map_err(|e| format!("mods klasörü oluşturulamadı: {}", e))?;
    fs::create_dir_all(&disabled_dir)
        .map_err(|e| format!("disabled-mods klasörü oluşturulamadı: {}", e))?;

    let (src_dir, dst_dir) = if enable {
        (&disabled_dir, &mods_dir)
    } else {
        (&mods_dir, &disabled_dir)
    };

    let src = src_dir.join(file_name);
    let dst = dst_dir.join(file_name);

    if !src.exists() {
        return Err(format!("Mod dosyası bulunamadı: {}", src.display()));
    }
    if dst.exists() {
        return Err(format!(
            "Hedefte aynı isimde bir mod dosyası zaten mevcut ({}). Üzerine yazma engellendi.",
            dst.display()
        ));
    }

    // Attempt atomic rename first; fallback to copy + verify + remove if needed
    if fs::rename(&src, &dst).is_err() {
        fs::copy(&src, &dst).map_err(|e| format!("Mod taşınamadı: {}", e))?;
        let src_len = fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
        let dst_len = fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
        if src_len != dst_len {
            let _ = fs::remove_file(&dst);
            return Err("Dosya kopyalama doğrulaması başarısız oldu, orijinal dosya korundu.".to_string());
        }
        fs::remove_file(&src).map_err(|e| format!("Kaynak dosya kaldırılamadı: {}", e))?;
    }

    Ok(dst)
}

pub fn delete_mod_file(game_root: &Path, file_name: &str, enabled: bool) -> Result<(), String> {
    let target_dir = if enabled {
        game_root.join("mods")
    } else {
        game_root.join("disabled-mods")
    };
    let target = target_dir.join(file_name);
    if !target.exists() {
        return Err(format!("Silinecek mod dosyası bulunamadı: {}", file_name));
    }
    fs::remove_file(&target).map_err(|e| format!("Mod silinemedi: {}", e))
}

pub fn install_mod_files(game_root: &Path, source_paths: Vec<String>) -> Result<Vec<String>, String> {
    let mods_dir = game_root.join("mods");
    let disabled_dir = game_root.join("disabled-mods");
    fs::create_dir_all(&mods_dir).map_err(|e| format!("mods klasörü oluşturulamadı: {}", e))?;

    let mut installed = Vec::new();
    for raw_src in source_paths {
        let src = PathBuf::from(raw_src.trim());
        if !src.exists() || !src.is_file() {
            continue;
        }
        let Some(fname) = src.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        if !fname.to_lowercase().ends_with(".jar") {
            return Err(format!("Yalnızca .jar mod dosyaları yüklenebilir: {}", fname));
        }
        let dst = mods_dir.join(&fname);
        let disabled_dst = disabled_dir.join(&fname);
        if dst.exists() || disabled_dst.exists() {
            return Err(format!(
                "Aynı isimde bir mod zaten yüklü ({}). Üzerine yazma engellendi.",
                fname
            ));
        }
        fs::copy(&src, &dst).map_err(|e| format!("Mod kopyalanamadı ({}): {}", fname, e))?;
        installed.push(fname);
    }
    Ok(installed)
}
