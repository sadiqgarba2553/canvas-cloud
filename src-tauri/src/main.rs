#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs, io::Write};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn open_board_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(file) = app.dialog().file().add_filter("Canvas Cloud board", &["canvascloud"]).blocking_pick_file() else { return Ok(None); };
    let path = file.into_path().map_err(|e| e.to_string())?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 50_000_000 { return Err("Board exceeds the 50 MB import limit".into()); }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_export(app: tauri::AppHandle, name: String, data: String, kind: String) -> Result<bool, String> {
    let extension = match kind.as_str() { "board" => "canvascloud", "svg" => "svg", _ => return Err("Unsupported export format".into()) };
    if data.len() > 50_000_000 { return Err("Export exceeds the 50 MB limit".into()); }
    let Some(file) = app.dialog().file().add_filter("Canvas Cloud export", &[extension]).set_file_name(name).blocking_save_file() else { return Ok(false); };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let parent = path.parent().ok_or("Invalid destination")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(true)
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_board_file, save_export])
        .run(tauri::generate_context!())
        .expect("Canvas Cloud could not start");
}
