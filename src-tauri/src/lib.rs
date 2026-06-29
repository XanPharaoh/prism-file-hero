use image::GenericImageView;
use lopdf::{content, dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Helper: acquire a Mutex recovering from poison (prior panic).
/// This keeps the app operational after a panic instead of bricking all commands.
fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| {
        log::warn!("Recovered from poisoned Mutex");
        poisoned.into_inner()
    })
}

#[derive(Default)]
struct AppQueueState {
    queue: Mutex<Vec<QueueItem>>,
    ui_state: Mutex<UiState>,
    hot_folder: Mutex<HotFolderConfig>,
}

/// Configuration for the hot folder watcher.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HotFolderConfig {
    enabled: bool,
    watch_path: Option<String>,
    output_path: Option<String>,
    tool: Option<String>,
    /// Serialized tool options (password, watermark text, etc.)
    tool_options: Value,
}

impl Default for HotFolderConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            watch_path: None,
            output_path: None,
            tool: None,
            tool_options: json!({}),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UiState {
    selected_tool: Option<String>,
    tool_options: Value,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            selected_tool: None,
            tool_options: json!({}),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueItem {
    id: String,
    file_path: String,
    file_name: String,
    file_size: u64,
    status: String,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueItemInput {
    id: String,
    file_path: String,
    file_name: String,
    file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickedFile {
    file_path: String,
    file_name: String,
    file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinaryFile {
    file_name: String,
    data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedAppState {
    queue: Vec<QueueItem>,
    selected_tool: Option<String>,
    tool_options: Value,
    #[serde(default)]
    hot_folder: HotFolderConfig,
}

fn app_state_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    Ok(app_data_dir.join("app_state.json"))
}

fn load_persisted_state(app: &tauri::AppHandle) -> PersistedAppState {
    let Ok(path) = app_state_file_path(app) else {
        return PersistedAppState::default();
    };

    if !path.exists() {
        return PersistedAppState::default();
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => {
            // Try .tmp backup in case the main file was corrupted mid-write
            let tmp = path.with_extension("json.tmp");
            match fs::read_to_string(&tmp) {
                Ok(c) => {
                    log::warn!("Main state file corrupt, recovered from .tmp backup");
                    c
                }
                Err(_) => return PersistedAppState::default(),
            }
        }
    };

    match serde_json::from_str(&content) {
        Ok(state) => state,
        Err(e) => {
            log::error!("Failed to parse persisted state: {e}");
            PersistedAppState::default()
        }
    }
}

fn snapshot_state(state: &tauri::State<AppQueueState>) -> PersistedAppState {
    let queue = lock_or_recover(&state.queue).clone();
    let ui_state = lock_or_recover(&state.ui_state).clone();
    let hot_folder = lock_or_recover(&state.hot_folder).clone();

    PersistedAppState {
        queue,
        selected_tool: ui_state.selected_tool,
        tool_options: ui_state.tool_options,
        hot_folder,
    }
}

/// Persist state to disk using atomic write-to-tmp-then-rename.
/// This is fire-and-forget: failures are logged but never propagated
/// to callers -- a persistence hiccup must not block the user.
fn persist_state(app: &tauri::AppHandle, state: &tauri::State<AppQueueState>) {
    let snapshot = snapshot_state(state);
    let path = match app_state_file_path(app) {
        Ok(p) => p,
        Err(e) => { log::error!("persist_state path error: {e}"); return; }
    };

    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            log::error!("persist_state mkdir error: {e}");
            return;
        }
    }

    let serialized = match serde_json::to_string_pretty(&snapshot) {
        Ok(s) => s,
        Err(e) => { log::error!("persist_state serialize error: {e}"); return; }
    };

    // Atomic write: write to .tmp, then rename over the real file.
    let tmp_path = path.with_extension("json.tmp");
    if let Err(e) = fs::write(&tmp_path, &serialized) {
        log::error!("persist_state write tmp error: {e}");
        return;
    }
    if let Err(e) = fs::rename(&tmp_path, &path) {
        // rename can fail on some Windows antiviruses; fall back to direct write
        log::warn!("persist_state rename failed ({e}), falling back to direct write");
        if let Err(e2) = fs::write(&path, &serialized) {
            log::error!("persist_state direct write fallback failed: {e2}");
        }
    }
}

#[tauri::command]
fn pick_files(app: tauri::AppHandle, tool_id: Option<String>) -> Result<Vec<PickedFile>, String> {
    let mut picker = app.dialog().file();

    match tool_id.as_deref() {
        Some("jpg-to-pdf") => {
            picker = picker.add_filter("Images", &["jpg", "jpeg", "png"]);
        }
        _ => {
            picker = picker.add_filter("PDF", &["pdf"]);
        }
    }

    let selected = picker.blocking_pick_files();
    let paths = selected.ok_or_else(|| "No files selected".to_string())?;

    let mut files = Vec::new();
    for path in paths {
        let path_str = path.to_string();
        let file_name = Path::new(&path_str)
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown")
            .to_string();

        let file_size = fs::metadata(&path_str).map(|m| m.len()).unwrap_or(0);
        files.push(PickedFile {
            file_path: path_str,
            file_name,
            file_size,
        });
    }

    Ok(files)
}

#[tauri::command]
fn add_files_to_queue(
    app: tauri::AppHandle,
    state: tauri::State<AppQueueState>,
    files: Vec<QueueItemInput>,
) -> Result<Vec<QueueItem>, String> {
    // Validate that every file actually exists on disk before adding
    for file in &files {
        if !Path::new(&file.file_path).exists() {
            return Err(format!("File not found: {}", file.file_path));
        }
    }

    let mut queue = lock_or_recover(&state.queue);

    for file in files {
        queue.push(QueueItem {
            id: file.id,
            file_path: file.file_path,
            file_name: file.file_name,
            file_size: file.file_size,
            status: "IDLE".to_string(),
            error: None,
        });
    }

    let result = queue.clone();
    drop(queue);
    persist_state(&app, &state);
    Ok(result)
}

#[tauri::command]
fn get_queue_state(state: tauri::State<AppQueueState>) -> Result<Vec<QueueItem>, String> {
    Ok(lock_or_recover(&state.queue).clone())
}

#[tauri::command]
fn remove_queue_item(
    app: tauri::AppHandle,
    state: tauri::State<AppQueueState>,
    id: String,
) -> Result<Vec<QueueItem>, String> {
    let mut queue = lock_or_recover(&state.queue);
    queue.retain(|item| item.id != id);
    let result = queue.clone();
    drop(queue);
    persist_state(&app, &state);
    Ok(result)
}

#[tauri::command]
fn clear_queue(app: tauri::AppHandle, state: tauri::State<AppQueueState>) -> Result<(), String> {
    let mut queue = lock_or_recover(&state.queue);
    queue.clear();
    drop(queue);
    persist_state(&app, &state);
    Ok(())
}

#[tauri::command]
fn update_queue_item_status(
    app: tauri::AppHandle,
    state: tauri::State<AppQueueState>,
    id: String,
    status: String,
    error: Option<String>,
) -> Result<(), String> {
    let mut queue = lock_or_recover(&state.queue);

    if let Some(item) = queue.iter_mut().find(|item| item.id == id) {
        item.status = status;
        item.error = error;
    }

    drop(queue);
    persist_state(&app, &state);
    Ok(())
}

#[tauri::command]
fn get_ui_state(state: tauri::State<AppQueueState>) -> Result<UiState, String> {
    Ok(lock_or_recover(&state.ui_state).clone())
}

#[tauri::command]
fn save_ui_state(
    app: tauri::AppHandle,
    state: tauri::State<AppQueueState>,
    selected_tool: Option<String>,
    tool_options: Value,
) -> Result<(), String> {
    let mut ui_state = lock_or_recover(&state.ui_state);
    ui_state.selected_tool = selected_tool;
    ui_state.tool_options = tool_options;
    drop(ui_state);
    persist_state(&app, &state);
    Ok(())
}

#[tauri::command]
fn process_merge_pdfs(app: tauri::AppHandle, file_paths: Vec<String>) -> Result<Vec<u8>, String> {
    if file_paths.len() < 2 {
        return Err("Merge requires at least two PDF files.".to_string());
    }

    // Validate all files exist before starting the expensive operation
    for path in &file_paths {
        if !Path::new(path).exists() {
            return Err(format!("File no longer exists: {path}"));
        }
    }

    let total = file_paths.len();
    let mut documents = Vec::new();
    for (idx, path) in file_paths.iter().enumerate() {
        let doc = Document::load(path)
            .map_err(|e| format!("Failed to load PDF `{path}`: {e}"))?;
        documents.push(doc);
        let _ = app.emit("processing-progress", json!({
            "progress": ((idx + 1) as f64 / total as f64 * 80.0) as u32,
            "message": format!("Loading PDF {}/{}", idx + 1, total),
        }));
    }

    let mut merged = Document::with_version("1.5");
    let mut next_id: u32 = 1;
    let mut page_ids: Vec<ObjectId> = Vec::new();

    for mut doc in documents {
        doc.renumber_objects_with(next_id);
        next_id = doc.max_id + 1;

        for (_, page_id) in doc.get_pages() {
            page_ids.push(page_id);
        }

        merged.objects.extend(doc.objects);
    }

    if page_ids.is_empty() {
        return Err("No pages found in input PDFs.".to_string());
    }

    let pages_id = merged.new_object_id();
    let catalog_id = merged.new_object_id();

    for page_id in &page_ids {
        if let Some(Object::Dictionary(page_dict)) = merged.objects.get_mut(page_id) {
            page_dict.set("Parent", Object::Reference(pages_id));
        }
    }

    let kids: Vec<Object> = page_ids.iter().map(|id| Object::Reference(*id)).collect();
    merged.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => Object::Array(kids),
            "Count" => page_ids.len() as i64,
        }),
    );

    merged.objects.insert(
        catalog_id,
        Object::Dictionary(dictionary! {
            "Type" => "Catalog",
            "Pages" => Object::Reference(pages_id),
        }),
    );

    merged.trailer.set("Root", Object::Reference(catalog_id));
    merged.compress();

    let mut out = Vec::new();
    merged
        .save_to(&mut out)
        .map_err(|e| format!("Failed to save merged PDF: {e}"))?;
    Ok(out)
}

#[tauri::command]
fn process_split_pdf(file_path: String) -> Result<Vec<BinaryFile>, String> {
    if !Path::new(&file_path).exists() {
        return Err(format!("File no longer exists: {file_path}"));
    }
    let source = Document::load(&file_path)
        .map_err(|e| format!("Failed to load PDF `{file_path}`: {e}"))?;
    let page_numbers: Vec<u32> = source.get_pages().keys().copied().collect();

    if page_numbers.is_empty() {
        return Err("No pages found in PDF.".to_string());
    }

    let mut outputs = Vec::new();

    for page_number in page_numbers.clone() {
        let mut single = source.clone();
        let pages_to_remove: Vec<u32> = page_numbers
            .iter()
            .copied()
            .filter(|num| *num != page_number)
            .collect();

        single.delete_pages(&pages_to_remove);
        single.prune_objects();
        single.compress();

        let mut bytes = Vec::new();
        single
            .save_to(&mut bytes)
            .map_err(|e| format!("Failed to save split page {page_number}: {e}"))?;

        outputs.push(BinaryFile {
            file_name: format!("Page_{page_number}.pdf"),
            data: bytes,
        });
    }

    Ok(outputs)
}

#[tauri::command]
fn process_rotate_pdf(file_path: String, angle: i64) -> Result<Vec<u8>, String> {
    if angle % 90 != 0 {
        return Err("Rotation angle must be a multiple of 90.".to_string());
    }
    if !Path::new(&file_path).exists() {
        return Err(format!("File no longer exists: {file_path}"));
    }

    let mut doc = Document::load(&file_path)
        .map_err(|e| format!("Failed to load PDF `{file_path}`: {e}"))?;

    for (_, page_id) in doc.get_pages() {
        let page_dict = doc
            .get_object_mut(page_id)
            .and_then(|obj| obj.as_dict_mut())
            .map_err(|e| format!("Missing page dictionary: {e}"))?;

        let current_rotation = page_dict
            .get(b"Rotate")
            .and_then(|obj| obj.as_i64())
            .unwrap_or(0);

        let normalized = (current_rotation + angle).rem_euclid(360);
        page_dict.set("Rotate", normalized);
    }

    doc.compress();

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| format!("Failed to save rotated PDF: {e}"))?;
    Ok(out)
}

#[tauri::command]
fn process_images_to_pdf(app: tauri::AppHandle, file_paths: Vec<String>) -> Result<Vec<u8>, String> {
    if file_paths.is_empty() {
        return Err("No images provided.".to_string());
    }

    // Validate all files exist before starting
    for path in &file_paths {
        if !Path::new(path).exists() {
            return Err(format!("Image file no longer exists: {path}"));
        }
    }

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut page_ids: Vec<ObjectId> = Vec::new();
    let total = file_paths.len();

    for (idx, file_path) in file_paths.iter().enumerate() {
        let raw_bytes = fs::read(file_path)
            .map_err(|e| format!("Failed to read `{file_path}`: {e}"))?;
        let img = image::load_from_memory(&raw_bytes)
            .map_err(|e| format!("Failed to decode `{file_path}`: {e}"))?;
        let (w, h) = img.dimensions();

        // JPEG files embedded directly; PNG re-encoded as JPEG
        let path_lower = file_path.to_lowercase();
        let jpeg_bytes = if path_lower.ends_with(".jpg") || path_lower.ends_with(".jpeg") {
            raw_bytes
        } else {
            let rgb = image::DynamicImage::ImageRgb8(img.to_rgb8());
            let mut cursor = std::io::Cursor::new(Vec::new());
            rgb.write_to(&mut cursor, image::ImageFormat::Jpeg)
                .map_err(|e| format!("JPEG encode error: {e}"))?;
            cursor.into_inner()
        };

        // XObject image with DCTDecode (JPEG)
        let img_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => w as i64,
                "Height" => h as i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8_i64,
                "Filter" => "DCTDecode",
            },
            jpeg_bytes,
        );
        let img_id = doc.new_object_id();
        doc.objects.insert(img_id, Object::Stream(img_stream));

        // Content stream: place image filling the page
        let ops = content::Content {
            operations: vec![
                content::Operation::new("q", vec![]),
                content::Operation::new("cm", vec![
                    Object::Integer(w as i64), Object::Integer(0),
                    Object::Integer(0), Object::Integer(h as i64),
                    Object::Integer(0), Object::Integer(0),
                ]),
                content::Operation::new("Do", vec![Object::Name(b"Im0".to_vec())]),
                content::Operation::new("Q", vec![]),
            ],
        };
        let encoded = ops.encode().map_err(|e| format!("Content encode error: {e}"))?;
        let content_stream = Stream::new(dictionary! {}, encoded);
        let content_id = doc.new_object_id();
        doc.objects.insert(content_id, Object::Stream(content_stream));

        // Page object
        let page_id = doc.new_object_id();
        doc.objects.insert(
            page_id,
            Object::Dictionary(dictionary! {
                "Type" => "Page",
                "Parent" => Object::Reference(pages_id),
                "MediaBox" => Object::Array(vec![
                    Object::Integer(0), Object::Integer(0),
                    Object::Integer(w as i64), Object::Integer(h as i64),
                ]),
                "Contents" => Object::Reference(content_id),
                "Resources" => dictionary! {
                    "XObject" => dictionary! {
                        "Im0" => Object::Reference(img_id),
                    },
                },
            }),
        );
        page_ids.push(page_id);

        let _ = app.emit("processing-progress", json!({
            "progress": ((idx + 1) as f64 / total as f64 * 100.0) as u32,
            "message": format!("Processed image {}/{}", idx + 1, total),
        }));
    }

    // Pages node
    let kids: Vec<Object> = page_ids.iter().map(|id| Object::Reference(*id)).collect();
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => Object::Array(kids),
            "Count" => page_ids.len() as i64,
        }),
    );

    // Catalog
    let catalog_id = doc.new_object_id();
    doc.objects.insert(
        catalog_id,
        Object::Dictionary(dictionary! {
            "Type" => "Catalog",
            "Pages" => Object::Reference(pages_id),
        }),
    );

    doc.trailer.set("Root", Object::Reference(catalog_id));

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| format!("Failed to save PDF: {e}"))?;
    Ok(out)
}

#[tauri::command]
fn process_watermark_pdf(app: tauri::AppHandle, file_path: String, text: String) -> Result<Vec<u8>, String> {
    if text.is_empty() {
        return Err("Watermark text cannot be empty.".to_string());
    }
    if !Path::new(&file_path).exists() {
        return Err(format!("File no longer exists: {file_path}"));
    }

    let mut doc = Document::load(&file_path)
        .map_err(|e| format!("Failed to load PDF `{file_path}`: {e}"))?;

    // Embed Helvetica-Bold as a standard font (available in all PDF readers)
    let font_id = doc.new_object_id();
    doc.objects.insert(
        font_id,
        Object::Dictionary(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica-Bold",
        }),
    );

    // ExtGState for 35% opacity
    let gs_id = doc.new_object_id();
    doc.objects.insert(
        gs_id,
        Object::Dictionary(dictionary! {
            "Type" => "ExtGState",
            "CA" => Object::Real(0.35),
            "ca" => Object::Real(0.35),
        }),
    );

    let pages = doc.get_pages();
    let total = pages.len();

    for (idx, (_, page_id)) in pages.into_iter().enumerate() {
        // Get page dimensions from MediaBox
        let (w, h) = {
            let page_dict = doc.get_object(page_id)
                .and_then(|o| o.as_dict())
                .map_err(|e| format!("Page dict error: {e}"))?;
            let media_box = page_dict.get(b"MediaBox")
                .and_then(|o| o.as_array())
                .ok();
            match media_box {
                Some(arr) if arr.len() >= 4 => {
                    let w = arr[2].as_f32().unwrap_or(612.0) as f64;
                    let h = arr[3].as_f32().unwrap_or(792.0) as f64;
                    (w, h)
                }
                _ => (612.0, 792.0), // US Letter default
            }
        };

        let diagonal = (w * w + h * h).sqrt();
        let font_size = (diagonal * 0.06).min(72.0);
        let angle_rad = -h.atan2(w);
        let cos_a = angle_rad.cos();
        let sin_a = angle_rad.sin();

        // Approximate text width: Helvetica-Bold ~0.6 * fontSize per char
        let text_width = text.len() as f64 * font_size * 0.6;
        let cx = w / 2.0;
        let cy = h / 2.0;
        // Translate so text is centered after rotation
        let tx = cx - (text_width / 2.0) * cos_a + (font_size / 2.0) * sin_a;
        let ty = cy - (text_width / 2.0) * sin_a - (font_size / 2.0) * cos_a;

        // Escape PDF string special chars
        let escaped_text = text.replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)");

        // Build watermark content stream
        let wm_content = format!(
            "q\n/GS0 gs\n{cos} {sin} {neg_sin} {cos2} {tx} {ty} cm\nBT\n/F0 {fs} Tf\n0.75 0.75 0.75 rg\n({text}) Tj\nET\nQ\n",
            cos = cos_a, sin = sin_a, neg_sin = -sin_a, cos2 = cos_a,
            tx = tx, ty = ty, fs = font_size, text = escaped_text
        );

        let wm_stream = Stream::new(dictionary! {}, wm_content.into_bytes());
        let wm_id = doc.new_object_id();
        doc.objects.insert(wm_id, Object::Stream(wm_stream));

        // Add watermark stream to page's Contents array and add font/gs resources
        let page_dict = doc.get_object_mut(page_id)
            .and_then(|o| o.as_dict_mut())
            .map_err(|e| format!("Page dict error: {e}"))?;

        // Append to Contents
        let existing_contents = page_dict.get(b"Contents").ok().cloned();
        let new_contents = match existing_contents {
            Some(Object::Reference(ref_id)) => {
                Object::Array(vec![Object::Reference(ref_id), Object::Reference(wm_id)])
            }
            Some(Object::Array(mut arr)) => {
                arr.push(Object::Reference(wm_id));
                Object::Array(arr)
            }
            _ => Object::Reference(wm_id),
        };
        page_dict.set("Contents", new_contents);

        // Ensure Resources dict exists with Font and ExtGState
        if let Ok(resources) = page_dict.get_mut(b"Resources").and_then(|o| o.as_dict_mut()) {
            // Add font entry
            if let Ok(font_dict) = resources.get_mut(b"Font").and_then(|o: &mut Object| o.as_dict_mut()) {
                font_dict.set("F0", Object::Reference(font_id));
            } else {
                resources.set("Font", dictionary! { "F0" => Object::Reference(font_id) });
            }
            // Add ExtGState entry
            if let Ok(gs_dict) = resources.get_mut(b"ExtGState").and_then(|o: &mut Object| o.as_dict_mut()) {
                gs_dict.set("GS0", Object::Reference(gs_id));
            } else {
                resources.set("ExtGState", dictionary! { "GS0" => Object::Reference(gs_id) });
            }
        } else {
            page_dict.set("Resources", dictionary! {
                "Font" => dictionary! { "F0" => Object::Reference(font_id) },
                "ExtGState" => dictionary! { "GS0" => Object::Reference(gs_id) },
            });
        }

        let _ = app.emit("processing-progress", json!({
            "progress": ((idx + 1) as f64 / total as f64 * 100.0) as u32,
            "message": format!("Watermarking page {}/{}", idx + 1, total),
        }));
    }

    doc.compress();

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| format!("Failed to save watermarked PDF: {e}"))?;
    Ok(out)
}

#[tauri::command]
fn process_compress_pdf(app: tauri::AppHandle, file_path: String) -> Result<Vec<u8>, String> {
    if !Path::new(&file_path).exists() {
        return Err(format!("File no longer exists: {file_path}"));
    }

    let mut doc = Document::load(&file_path)
        .map_err(|e| format!("Failed to load PDF `{file_path}`: {e}"))?;

    let _ = app.emit("processing-progress", json!({
        "progress": 10,
        "message": "Analyzing PDF objects...",
    }));

    // Collect IDs of image XObjects to re-compress
    let image_ids: Vec<ObjectId> = doc.objects.keys()
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .filter(|id| {
            if let Some(Object::Stream(stream)) = doc.objects.get(id) {
                let dict = &stream.dict;
                let is_xobject = dict.get(b"Subtype")
                    .ok()
                    .and_then(|o| o.as_name().ok())
                    .map(|n| n == b"Image")
                    .unwrap_or(false);
                let is_large = stream.content.len() > 50_000; // Only re-compress images > 50KB
                is_xobject && is_large
            } else {
                false
            }
        })
        .collect();

    let total_images = image_ids.len();

    let _ = app.emit("processing-progress", json!({
        "progress": 20,
        "message": format!("Found {} large images to optimize", total_images),
    }));

    for (idx, img_id) in image_ids.into_iter().enumerate() {
        // Extract image data and dimensions
        let (raw_data, width, height, filter) = {
            let stream = match doc.objects.get(&img_id) {
                Some(Object::Stream(s)) => s,
                _ => continue,
            };
            let w = stream.dict.get(b"Width")
                .ok()
                .and_then(|o| o.as_i64().ok())
                .unwrap_or(0) as u32;
            let h = stream.dict.get(b"Height")
                .ok()
                .and_then(|o| o.as_i64().ok())
                .unwrap_or(0) as u32;
            let filter_name = stream.dict.get(b"Filter")
                .ok()
                .and_then(|o| o.as_name().ok())
                .unwrap_or(b"")
                .to_vec();

            if w == 0 || h == 0 { continue; }

            // Get decompressed content
            let data = stream.content.clone();
            (data, w, h, filter_name)
        };

        // Try to decode as image and re-encode at lower quality
        let re_encoded = if filter == b"DCTDecode" {
            // Already JPEG -- decode and re-encode at reduced quality
            match image::load_from_memory(&raw_data) {
                Ok(img) => {
                    let rgb = image::DynamicImage::ImageRgb8(img.to_rgb8());
                    let mut cursor = std::io::Cursor::new(Vec::new());
                    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 55);
                    match rgb.write_with_encoder(encoder) {
                        Ok(_) => {
                            let new_data = cursor.into_inner();
                            // Only keep if actually smaller
                            if new_data.len() < raw_data.len() {
                                Some(new_data)
                            } else {
                                None
                            }
                        }
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            }
        } else {
            // Non-JPEG image (FlateDecode/raw) -- try to decode as raw RGB and encode as JPEG
            let bpc = {
                if let Some(Object::Stream(s)) = doc.objects.get(&img_id) {
                    s.dict.get(b"BitsPerComponent")
                        .ok()
                        .and_then(|o| o.as_i64().ok())
                        .unwrap_or(8) as u32
                } else {
                    8
                }
            };

            if bpc == 8 && (raw_data.len() as u32) >= width * height * 3 {
                // Looks like raw RGB data, encode as JPEG
                match image::RgbImage::from_raw(width, height, raw_data[..(width * height * 3) as usize].to_vec()) {
                    Some(rgb_img) => {
                        let dyn_img = image::DynamicImage::ImageRgb8(rgb_img);
                        let mut cursor = std::io::Cursor::new(Vec::new());
                        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 55);
                        match dyn_img.write_with_encoder(encoder) {
                            Ok(_) => Some(cursor.into_inner()),
                            Err(_) => None,
                        }
                    }
                    None => None,
                }
            } else {
                None
            }
        };

        if let Some(new_jpeg_data) = re_encoded {
            if let Some(Object::Stream(stream)) = doc.objects.get_mut(&img_id) {
                stream.dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
                stream.dict.set("Width", Object::Integer(width as i64));
                stream.dict.set("Height", Object::Integer(height as i64));
                stream.dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
                stream.dict.set("BitsPerComponent", Object::Integer(8));
                // Remove FlateDecode-related entries if present
                stream.dict.remove(b"DecodeParms");
                stream.dict.remove(b"Length");
                stream.content = new_jpeg_data;
                stream.allows_compression = false; // Already compressed as JPEG
            }
        }

        let progress = 20 + ((idx + 1) as f64 / total_images.max(1) as f64 * 60.0) as u32;
        let _ = app.emit("processing-progress", json!({
            "progress": progress,
            "message": format!("Optimized image {}/{}", idx + 1, total_images),
        }));
    }

    let _ = app.emit("processing-progress", json!({
        "progress": 85,
        "message": "Compressing streams...",
    }));

    // Apply FlateDecode to all remaining compressible streams
    doc.compress();

    // Remove unreferenced objects
    doc.prune_objects();

    let _ = app.emit("processing-progress", json!({
        "progress": 95,
        "message": "Saving optimized PDF...",
    }));

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| format!("Failed to save compressed PDF: {e}"))?;
    Ok(out)
}

/// Resolve the pdfium.dll path -- works in both dev and production builds.
fn resolve_pdfium_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // Production: bundled as a Tauri resource
    if let Ok(resource_dir) = app.path().resource_dir() {
        let resource_path = resource_dir.join("pdfium.dll");
        if resource_path.exists() {
            return Ok(resource_path);
        }
    }
    // Dev fallback: sits in src-tauri working directory
    let cwd = std::env::current_dir().unwrap_or_default();
    let dev_path = cwd.join("pdfium.dll");
    if dev_path.exists() {
        return Ok(dev_path);
    }
    Err(
        "pdfium.dll not found. Place it in the src-tauri directory for development, \
         or ensure it is bundled as a Tauri resource for production."
            .to_string(),
    )
}

/// Render PDF pages to JPEG images via PDFium natively.
/// Returns Vec of { base64, pageNumber } matching the frontend `convertPdfToImages` contract.
#[tauri::command]
async fn process_pdf_to_images(
    app: tauri::AppHandle,
    file_path: String,
    max_pages: Option<u32>,
    enhance_for_ocr: Option<bool>,
    scale: Option<f32>,
) -> Result<Vec<Value>, String> {
    use pdfium_render::prelude::*;

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let pdfium_path = resolve_pdfium_path(&app)?;

    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(pdfium_path.to_str().unwrap_or_default())
            .map_err(|e| format!("Failed to bind to PDFium: {e}"))?,
    );

    let document = pdfium
        .load_pdf_from_file(&file_path, None)
        .map_err(|e| format!("Failed to open PDF: {e}"))?;

    let page_count = document.pages().len() as u32;
    let limit = max_pages.unwrap_or(200).min(page_count);
    let render_scale = scale.unwrap_or(3.0);
    let do_enhance = enhance_for_ocr.unwrap_or(false);

    let _ = app.emit(
        "processing-progress",
        json!({
            "progress": 5,
            "message": format!("Rendering {} pages via PDFium...", limit),
        }),
    );

    let mut results: Vec<Value> = Vec::with_capacity(limit as usize);

    for i in 0..limit {
        let page = document
            .pages()
            .get(i as u16)
            .map_err(|e| format!("Failed to get page {}: {e}", i + 1))?;

        let width_px = (page.width().value * render_scale) as i32;
        let height_px = (page.height().value * render_scale) as i32;

        let config = PdfRenderConfig::new()
            .set_target_width(width_px)
            .set_target_height(height_px);

        let bitmap = page
            .render_with_config(&config)
            .map_err(|e| format!("Failed to render page {}: {e}", i + 1))?;

        let dyn_image = bitmap.as_image();

        // Optional OCR enhancement: convert to grayscale and boost contrast
        let final_image = if do_enhance {
            let gray = image::DynamicImage::ImageLuma8(dyn_image.to_luma8());
            image::DynamicImage::ImageLuma8(
                image::imageops::contrast(&gray.to_luma8(), 20.0),
            )
        } else {
            dyn_image
        };

        // Encode to JPEG
        let mut cursor = std::io::Cursor::new(Vec::new());
        let quality = if do_enhance { 92 } else { 85 };
        let encoder =
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
        final_image
            .write_with_encoder(encoder)
            .map_err(|e| format!("Failed to encode page {} to JPEG: {e}", i + 1))?;

        let jpeg_bytes = cursor.into_inner();
        use base64::Engine as _;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);

        results.push(json!({
            "base64": b64,
            "pageNumber": i + 1,
        }));

        let progress = 5 + ((i + 1) as f64 / limit as f64 * 90.0) as u32;
        let _ = app.emit(
            "processing-progress",
            json!({
                "progress": progress,
                "message": format!("Rendered page {}/{}", i + 1, limit),
            }),
        );
    }

    let _ = app.emit(
        "processing-progress",
        json!({ "progress": 100, "message": "Rendering complete" }),
    );

    Ok(results)
}

/// Render PDF pages directly to JPEG byte arrays for the pdf-to-jpg tool.
/// Returns raw JPEG data per page, avoiding base64 overhead for direct file output.
#[tauri::command]
async fn process_pdf_to_jpg(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<Vec<Value>, String> {
    use pdfium_render::prelude::*;

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let pdfium_path = resolve_pdfium_path(&app)?;

    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(pdfium_path.to_str().unwrap_or_default())
            .map_err(|e| format!("Failed to bind to PDFium: {e}"))?,
    );

    let document = pdfium
        .load_pdf_from_file(&file_path, None)
        .map_err(|e| format!("Failed to open PDF: {e}"))?;

    let page_count = document.pages().len() as u32;

    let _ = app.emit(
        "processing-progress",
        json!({
            "progress": 5,
            "message": format!("Converting {} pages to JPG...", page_count),
        }),
    );

    let mut results: Vec<Value> = Vec::with_capacity(page_count as usize);

    for i in 0..page_count {
        let page = document
            .pages()
            .get(i as u16)
            .map_err(|e| format!("Failed to get page {}: {e}", i + 1))?;

        let width_px = (page.width().value * 3.0) as i32;
        let height_px = (page.height().value * 3.0) as i32;

        let config = PdfRenderConfig::new()
            .set_target_width(width_px)
            .set_target_height(height_px);

        let bitmap = page
            .render_with_config(&config)
            .map_err(|e| format!("Failed to render page {}: {e}", i + 1))?;

        let dyn_image = bitmap.as_image();

        let mut cursor = std::io::Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 90);
        dyn_image
            .write_with_encoder(encoder)
            .map_err(|e| format!("Failed to encode page {} to JPEG: {e}", i + 1))?;

        let jpeg_bytes = cursor.into_inner();

        results.push(json!({
            "fileName": format!("Page_{}.jpg", i + 1),
            "data": jpeg_bytes,
        }));

        let progress = 5 + ((i + 1) as f64 / page_count as f64 * 90.0) as u32;
        let _ = app.emit(
            "processing-progress",
            json!({
                "progress": progress,
                "message": format!("Converted page {}/{}", i + 1, page_count),
            }),
        );
    }

    Ok(results)
}

// --- Hot Folder Processing Engine ---

/// Process a single file that landed in the hot folder using the configured tool.
fn hot_folder_process_file(app: &tauri::AppHandle, file_path: &Path, config: &HotFolderConfig) {
    let tool = match &config.tool {
        Some(t) => t.clone(),
        None => {
            log::warn!("Hot folder: no tool configured, skipping {}", file_path.display());
            return;
        }
    };

    let output_dir = match &config.output_path {
        Some(p) => PathBuf::from(p),
        None => file_path.parent().unwrap_or(Path::new(".")).join("Completed"),
    };

    if let Err(e) = fs::create_dir_all(&output_dir) {
        log::error!("Hot folder: cannot create output dir: {e}");
        return;
    }

    let file_path_str = file_path.to_string_lossy().to_string();
    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let stem = file_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let _ = app.emit("hot-folder-activity", json!({
        "status": "processing",
        "fileName": file_name,
        "tool": tool,
    }));

    let result: Result<(Vec<u8>, String), String> = match tool.as_str() {
        "compress" => {
            process_compress_pdf_sync(app, &file_path_str)
                .map(|data| (data, format!("Compressed_{}.pdf", stem)))
        }
        "watermark" => {
            let text = config.tool_options.get("watermarkText")
                .and_then(|v| v.as_str())
                .unwrap_or("CONFIDENTIAL")
                .to_string();
            process_watermark_pdf_sync(app, &file_path_str, &text)
                .map(|data| (data, format!("Stamped_{}.pdf", stem)))
        }
        "rotate" => {
            let angle = config.tool_options.get("rotationAngle")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(90);
            process_rotate_pdf_sync(&file_path_str, angle)
                .map(|data| (data, format!("Rotated_{}.pdf", stem)))
        }
        "merge" => {
            // For merge in hot folder, just copy the file through (single file merge is identity)
            fs::read(&file_path_str)
                .map_err(|e| e.to_string())
                .map(|data| (data, format!("{}.pdf", stem)))
        }
        _ => Err(format!("Tool '{}' is not supported for hot folder processing", tool)),
    };

    match result {
        Ok((data, out_name)) => {
            let out_path = output_dir.join(&out_name);
            if let Err(e) = fs::write(&out_path, &data) {
                log::error!("Hot folder: failed to write output: {e}");
                let _ = app.emit("hot-folder-activity", json!({
                    "status": "error",
                    "fileName": file_name,
                    "error": format!("Failed to save: {e}"),
                }));
            } else {
                log::info!("Hot folder: processed {} -> {}", file_name, out_path.display());
                let _ = app.emit("hot-folder-activity", json!({
                    "status": "completed",
                    "fileName": file_name,
                    "outputPath": out_path.to_string_lossy(),
                }));
            }
        }
        Err(e) => {
            log::error!("Hot folder: processing failed for {}: {e}", file_name);
            let _ = app.emit("hot-folder-activity", json!({
                "status": "error",
                "fileName": file_name,
                "error": e,
            }));
        }
    }
}

/// Synchronous wrapper for compress (hot folder runs on a background thread)
fn process_compress_pdf_sync(app: &tauri::AppHandle, file_path: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let mut doc = Document::load(file_path)
        .map_err(|e| format!("Failed to open PDF: {e}"))?;

    // Find and re-compress large image XObjects
    let image_ids: Vec<ObjectId> = doc.objects.keys()
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .filter(|id| {
            if let Some(Object::Stream(stream)) = doc.objects.get(id) {
                let dict = &stream.dict;
                let is_xobject = dict.get(b"Subtype")
                    .ok()
                    .and_then(|o| o.as_name().ok())
                    .map(|n| n == b"Image")
                    .unwrap_or(false);
                let is_large = stream.content.len() > 50_000;
                is_xobject && is_large
            } else {
                false
            }
        })
        .collect();

    for img_id in &image_ids {
        let (raw_data, width, height, filter) = {
            let stream = match doc.objects.get(img_id) {
                Some(Object::Stream(s)) => s,
                _ => continue,
            };
            let w = stream.dict.get(b"Width").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0) as u32;
            let h = stream.dict.get(b"Height").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0) as u32;
            let f = stream.dict.get(b"Filter").ok().and_then(|o| o.as_name().ok()).unwrap_or(b"").to_vec();
            if w == 0 || h == 0 { continue; }
            (stream.content.clone(), w, h, f)
        };

        let re_encoded = if filter == b"DCTDecode" {
            match image::load_from_memory(&raw_data) {
                Ok(img) => {
                    let rgb = image::DynamicImage::ImageRgb8(img.to_rgb8());
                    let mut cursor = std::io::Cursor::new(Vec::new());
                    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 55);
                    match rgb.write_with_encoder(encoder) {
                        Ok(_) => {
                            let new_data = cursor.into_inner();
                            if new_data.len() < raw_data.len() { Some(new_data) } else { None }
                        }
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            }
        } else { None };

        if let Some(new_jpeg_data) = re_encoded {
            if let Some(Object::Stream(stream)) = doc.objects.get_mut(img_id) {
                stream.dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
                stream.dict.set("Width", Object::Integer(width as i64));
                stream.dict.set("Height", Object::Integer(height as i64));
                stream.dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
                stream.dict.set("BitsPerComponent", Object::Integer(8));
                stream.dict.remove(b"DecodeParms");
                stream.dict.remove(b"Length");
                stream.content = new_jpeg_data;
                stream.allows_compression = false;
            }
        }
    }

    doc.compress();
    doc.prune_objects();

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| format!("Failed to save compressed PDF: {e}"))?;

    let _ = app.emit("hot-folder-activity", json!({
        "status": "progress",
        "message": "Compression complete",
    }));

    Ok(out)
}

/// Synchronous wrapper for watermark (hot folder runs on a background thread)
fn process_watermark_pdf_sync(_app: &tauri::AppHandle, file_path: &str, text: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let mut doc = Document::load(file_path)
        .map_err(|e| format!("Failed to open PDF: {e}"))?;

    // Add font and graphics state objects
    let font_dict = dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica-Bold",
    };
    let font_id = doc.add_object(font_dict);
    let gs_dict = dictionary! {
        "Type" => "ExtGState",
        "ca" => Object::Real(0.35),
        "CA" => Object::Real(0.35),
    };
    let gs_id = doc.add_object(gs_dict);

    let page_ids: Vec<ObjectId> = doc.page_iter().collect();

    for page_id in &page_ids {
        let (page_width, page_height) = {
            let page_dict = doc.get_object(*page_id)
                .and_then(|o| o.as_dict())
                .map_err(|e| format!("Failed to read page dict: {e}"))?;
            let media_box = page_dict.get(b"MediaBox")
                .ok()
                .and_then(|o| o.as_array().ok())
                .unwrap_or(&vec![])
                .clone();
            if media_box.len() >= 4 {
                let w: f64 = match &media_box[2] { Object::Real(f) => *f as f64, Object::Integer(i) => *i as f64, _ => 612.0 };
                let h: f64 = match &media_box[3] { Object::Real(f) => *f as f64, Object::Integer(i) => *i as f64, _ => 792.0 };
                (w, h)
            } else {
                (612.0, 792.0)
            }
        };

        let cx = page_width / 2.0;
        let cy = page_height / 2.0;
        let font_size: f64 = (page_width / text.len() as f64 * 1.8).clamp(24.0, 72.0);
        let angle: f64 = 45.0_f64.to_radians();
        let cos_a = angle.cos();
        let sin_a = angle.sin();

        let content_stream = format!(
            "q /GS0 gs BT /F0 {fs} Tf 0.7 0.7 0.7 rg {cos} {sin} {nsin} {cos2} {cx} {cy} Tm ({text}) Tj ET Q",
            fs = font_size, cos = cos_a, sin = sin_a, nsin = -sin_a, cos2 = cos_a, cx = cx, cy = cy, text = text
        );

        let wm_stream = Stream::new(dictionary! {}, content_stream.into_bytes());
        let wm_id = doc.add_object(wm_stream);

        let page_dict = doc.get_object_mut(*page_id)
            .and_then(|o| o.as_dict_mut())
            .map_err(|e| format!("Failed to get mutable page dict: {e}"))?;

        let existing_contents = page_dict.get(b"Contents").ok().cloned();
        let new_contents = match existing_contents {
            Some(Object::Reference(ref_id)) => Object::Array(vec![Object::Reference(ref_id), Object::Reference(wm_id)]),
            Some(Object::Array(mut arr)) => { arr.push(Object::Reference(wm_id)); Object::Array(arr) }
            _ => Object::Reference(wm_id),
        };
        page_dict.set("Contents", new_contents);

        if let Ok(resources) = page_dict.get_mut(b"Resources").and_then(|o| o.as_dict_mut()) {
            if let Ok(fd) = resources.get_mut(b"Font").and_then(|o: &mut Object| o.as_dict_mut()) {
                fd.set("F0", Object::Reference(font_id));
            } else {
                resources.set("Font", dictionary! { "F0" => Object::Reference(font_id) });
            }
            if let Ok(gsd) = resources.get_mut(b"ExtGState").and_then(|o: &mut Object| o.as_dict_mut()) {
                gsd.set("GS0", Object::Reference(gs_id));
            } else {
                resources.set("ExtGState", dictionary! { "GS0" => Object::Reference(gs_id) });
            }
        } else {
            page_dict.set("Resources", dictionary! {
                "Font" => dictionary! { "F0" => Object::Reference(font_id) },
                "ExtGState" => dictionary! { "GS0" => Object::Reference(gs_id) },
            });
        }
    }

    doc.compress();
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| format!("Failed to save watermarked PDF: {e}"))?;
    Ok(out)
}

/// Synchronous wrapper for rotate
fn process_rotate_pdf_sync(file_path: &str, angle: i64) -> Result<Vec<u8>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let mut doc = Document::load(file_path)
        .map_err(|e| format!("Failed to open PDF: {e}"))?;

    let page_ids: Vec<ObjectId> = doc.page_iter().collect();
    for page_id in &page_ids {
        if let Ok(page_dict) = doc.get_object_mut(*page_id).and_then(|o| o.as_dict_mut()) {
            let current = page_dict.get(b"Rotate").and_then(|r| r.as_i64()).unwrap_or(0);
            let new_angle = (current + angle) % 360;
            page_dict.set("Rotate", Object::Integer(new_angle));
        }
    }

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| format!("Failed to save rotated PDF: {e}"))?;
    Ok(out)
}

/// Start the file system watcher on a background thread.
fn start_hot_folder_watcher(app: tauri::AppHandle) {
    use notify_debouncer_full::{new_debouncer, DebounceEventResult};
    use std::time::Duration;

    tauri::async_runtime::spawn_blocking(move || {
        loop {
            // Read current config
            let config = {
                let state = app.state::<AppQueueState>();
                let val = lock_or_recover(&state.hot_folder).clone(); val
            };

            if !config.enabled {
                // Sleep and re-check periodically
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }

            let watch_path = match &config.watch_path {
                Some(p) if Path::new(p).is_dir() => PathBuf::from(p),
                _ => {
                    log::warn!("Hot folder: watch path is not a valid directory");
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };

            log::info!("Hot folder: watching {}", watch_path.display());

            let app_clone = app.clone();
            let config_clone = config.clone();

            let (tx, rx) = std::sync::mpsc::channel();

            let mut debouncer = match new_debouncer(
                Duration::from_secs(2),
                None,
                move |result: DebounceEventResult| {
                    if let Ok(events) = result {
                        for event in events {
                            let _ = tx.send(event);
                        }
                    }
                },
            ) {
                Ok(d) => d,
                Err(e) => {
                    log::error!("Hot folder: failed to create watcher: {e}");
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };

            if let Err(e) = debouncer.watch(&watch_path, notify::RecursiveMode::NonRecursive) {
                log::error!("Hot folder: failed to watch directory: {e}");
                std::thread::sleep(Duration::from_secs(5));
                continue;
            }

            let _ = app_clone.emit("hot-folder-activity", json!({
                "status": "watching",
                "path": watch_path.to_string_lossy(),
            }));

            // Process events until config changes
            loop {
                // Check if config changed (disabled or path changed)
                let current = {
                    let state = app_clone.state::<AppQueueState>();
                    let val = lock_or_recover(&state.hot_folder).clone(); val
                };

                if !current.enabled || current.watch_path != config_clone.watch_path {
                    log::info!("Hot folder: config changed, restarting watcher");
                    break; // Break inner loop to re-enter outer loop
                }

                // Check for new file events with a timeout
                match rx.recv_timeout(Duration::from_secs(1)) {
                    Ok(event) => {
                        for path in &event.paths {
                            // Only process PDF files
                            if path.extension().map_or(false, |ext| ext.eq_ignore_ascii_case("pdf")) {
                                // Skip if file is in the output directory
                                let output_dir = current.output_path.as_deref()
                                    .map(PathBuf::from)
                                    .unwrap_or_else(|| watch_path.join("Completed"));
                                if path.starts_with(&output_dir) {
                                    continue;
                                }
                                // Ensure file is readable and not still being written
                                // Wait briefly and check file size stability
                                if path.exists() && fs::metadata(&path).map_or(false, |m| m.len() > 0) {
                                    let size1 = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                                    std::thread::sleep(Duration::from_millis(500));
                                    let size2 = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                                    if size1 == size2 && size2 > 0 {
                                        hot_folder_process_file(&app_clone, &path, &current);
                                    }
                                }
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        // Normal timeout, loop back to check config
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        log::warn!("Hot folder: watcher channel disconnected");
                        break;
                    }
                }
            }
        }
    });
}

// --- Hot Folder Commands ---

#[tauri::command]
fn get_hot_folder_config(app: tauri::AppHandle) -> HotFolderConfig {
    let state = app.state::<AppQueueState>();
    let val = lock_or_recover(&state.hot_folder).clone(); val
}

#[tauri::command]
fn set_hot_folder_config(
    app: tauri::AppHandle,
    enabled: bool,
    watch_path: Option<String>,
    output_path: Option<String>,
    tool: Option<String>,
    tool_options: Option<Value>,
) -> Result<(), String> {
    let state = app.state::<AppQueueState>();
    let mut config = lock_or_recover(&state.hot_folder);
    config.enabled = enabled;
    if let Some(wp) = watch_path {
        config.watch_path = Some(wp);
    }
    if let Some(op) = output_path {
        config.output_path = Some(op);
    }
    if let Some(t) = tool {
        config.tool = Some(t);
    }
    if let Some(opts) = tool_options {
        config.tool_options = opts;
    }

    log::info!("Hot folder config updated: enabled={}, path={:?}, tool={:?}",
        config.enabled, config.watch_path, config.tool);

    drop(config); // Release lock before persisting
    persist_state(&app, &state);

    Ok(())
}

#[tauri::command]
fn pick_hot_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();

    match folder {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
fn save_file_dialog(app: tauri::AppHandle, data: Vec<u8>, default_name: String) -> Result<String, String> {
    let file_path = app
        .dialog()
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
        .manage(AppQueueState::default())
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

            let persisted = load_persisted_state(app.handle());
            let app_state = app.state::<AppQueueState>();

            // Filter out queue items whose files have been deleted since last session
            let valid_queue: Vec<QueueItem> = persisted.queue.into_iter().filter(|item| {
                let exists = Path::new(&item.file_path).exists();
                if !exists {
                    log::info!("Pruning missing file from restored queue: {}", item.file_path);
                }
                exists
            }).collect();

            *lock_or_recover(&app_state.queue) = valid_queue;

            *lock_or_recover(&app_state.ui_state) = UiState {
                selected_tool: persisted.selected_tool,
                tool_options: persisted.tool_options,
            };

            // Restore hot folder config (but start disabled - user re-enables)
            let mut restored_hf = persisted.hot_folder;
            restored_hf.enabled = false; // Don't auto-watch on startup until user confirms
            *lock_or_recover(&app_state.hot_folder) = restored_hf;

            // --- System Tray ---
            let open_i = tauri::menu::MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
            let sep = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Quit Engine", true, None::<&str>)?;

            let tray_menu = tauri::menu::Menu::with_items(app, &[&open_i, &sep, &quit_i])?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Prism File Hero")
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "open" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, tauri::tray::TrayIconEvent::DoubleClick { .. }) {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Start hot folder background watcher
            start_hot_folder_watcher(app.handle().clone());

            Ok(())
        })
        // --- Close-to-tray ---
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the window from closing; hide it instead
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            pick_files,
            add_files_to_queue,
            get_queue_state,
            remove_queue_item,
            clear_queue,
            update_queue_item_status,
            get_ui_state,
            save_ui_state,
            process_merge_pdfs,
            process_split_pdf,
            process_rotate_pdf,
            process_images_to_pdf,
            process_watermark_pdf,
            process_compress_pdf,
            process_pdf_to_images,
            process_pdf_to_jpg,
            save_file_dialog,
            get_hot_folder_config,
            set_hot_folder_config,
            pick_hot_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
