use serde::{Deserialize, Serialize};

fn default_theme() -> String {
    "purple".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    pub game_directory: String,
    pub game_path: String,
    pub resolution_width: u32,
    pub resolution_height: u32,
    pub fullscreen: bool,
    pub java_path: String,
    pub ram: u64,
    pub last_username: String,
    pub last_version: String,
    pub aikar_flags: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledVersion {
    pub id: String,
    pub kind: String, // "vanilla" | "fabric" | "forge" | "neoforge" | "quilt" | "custom"
    pub inherits_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInfo {
    pub major: u32,
    pub raw: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub total_mem_mb: u64,
    pub default_game_dir: String,
    pub active_game_dir: String,
    pub settings: LauncherSettings,
    pub installed_versions: Vec<InstalledVersion>,
    pub system_java: Option<JavaInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MojangVersion {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub release_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotItem {
    pub name: String,
    pub path: String,
    pub mtime: u64,
    pub date_str: String,
    pub size: u64,
    pub thumbnail: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStats {
    pub cpu_usage: f32,
    pub ram_usage: f32,
    pub used_ram_mb: u64,
    pub total_ram_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModItem {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub path: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub loader: Option<String>,
    pub size: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    pub username: String,
    pub version: String,
    pub memory_max: u64,
    pub game_directory: Option<String>,
    pub resolution_width: Option<u32>,
    pub resolution_height: Option<u32>,
    pub fullscreen: Option<bool>,
    pub java_path: Option<String>,
    pub aikar_flags: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    #[serde(rename = "type")]
    pub log_type: String, // "system" | "data" | "error" | "warn" | "debug"
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    #[serde(rename = "type")]
    pub stage: String, // "java" | "classes" | "assets" | "natives"
    pub task: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub success: bool,
    pub message: Option<String>,
    pub error: Option<String>,
}
