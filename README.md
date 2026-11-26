# LxClient

A fast, modern, and high-performance Minecraft launcher built with **Rust + Tauri v2** and **React + TypeScript + Tailwind CSS**.

## Features

* **Rust + Tauri v2 Architecture:** Native performance, low memory footprint, and custom frameless window.
* **Vanilla, Fabric & Forge Support:** Full `inheritsFrom` chain resolution, concurrent asset/library downloads, and automatic Java version selection (Java 8 / 17 / 21 / 25 via Eclipse Adoptium Temurin).
* **Theme System:** Instant switching between **Purple** (default) and **Green** themes with persistent settings.
* **Mod Manager:** Metadata inspection (`fabric.mod.json`, `quilt.mod.json`, `mods.toml`, `neoforge.mods.toml`, `mcmod.info`), safe enable/disable (`mods/` ↔ `disabled-mods/`), drag-and-drop `.jar` installation, and delete confirmation.
* **High-Performance Screenshot Gallery:** Disk-cached thumbnails, lazy loading, aspect-ratio preservation, and Lightbox with keyboard navigation.
* **Aikar's JVM Optimization & GPU Preference:** Optional G1GC performance flags and Windows High-Performance GPU registry preference.
* **Live Console:** Real-time color-coded JVM/launcher logs with search, level filtering, and copy support.

## Getting Started

```bash
# Clone the repository
git clone https://github.com/lyxron1/LxClient.git

# Navigate to project directory
cd LxClient

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build Windows NSIS installer
npm run tauri build -- --bundles nsis
```
