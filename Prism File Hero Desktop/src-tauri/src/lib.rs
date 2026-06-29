use std::fs;

#[tauri::command]
fn save_file_dialog(app: tauri::AppHandle, data: Vec<u8>, default_name: String) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app.dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            fs::write(&path_str, data).map_err(|e| e.to_string())?;
            Ok(path_str)
        }
        None => Err("No file selected".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.handle().plugin(tauri_plugin_dialog::init())?;
            app.handle().plugin(tauri_plugin_fs::init())?;

            // Expose the save_file_dialog command
            // The frontend will use window.__TAURI__.invoke

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_file_dialog])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
