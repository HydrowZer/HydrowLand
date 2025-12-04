use crate::screen::{CaptureSource, CaptureSourceInfo, MonitorInfo, ScreenCapture, WindowInfo};
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

/// State for screen capture management
pub struct ScreenState {
    capture: Arc<RwLock<ScreenCapture>>,
}

impl Default for ScreenState {
    fn default() -> Self {
        Self::new()
    }
}

impl ScreenState {
    pub fn new() -> Self {
        Self {
            capture: Arc::new(RwLock::new(ScreenCapture::new())),
        }
    }

    /// Get access to the inner ScreenCapture
    pub fn capture(&self) -> &Arc<RwLock<ScreenCapture>> {
        &self.capture
    }
}

/// List all available monitors
#[tauri::command]
pub async fn screen_list_monitors() -> Result<Vec<MonitorInfo>, String> {
    ScreenCapture::list_monitors().map_err(|e| e.to_string())
}

/// List all available windows
#[tauri::command]
pub async fn screen_list_windows(include_minimized: Option<bool>) -> Result<Vec<WindowInfo>, String> {
    ScreenCapture::list_windows(include_minimized.unwrap_or(false)).map_err(|e| e.to_string())
}

/// List all available capture sources (monitors + windows)
#[tauri::command]
pub async fn screen_list_sources(include_minimized: Option<bool>) -> Result<Vec<CaptureSourceInfo>, String> {
    ScreenCapture::list_sources(include_minimized.unwrap_or(false)).map_err(|e| e.to_string())
}

/// Select a monitor for capture
#[tauri::command]
pub async fn screen_select_monitor(
    state: State<'_, ScreenState>,
    monitor_id: u32,
) -> Result<(), String> {
    let capture = state.capture.read().await;
    capture
        .select_source(CaptureSource::Monitor { id: monitor_id })
        .await;
    Ok(())
}

/// Select a window for capture
#[tauri::command]
pub async fn screen_select_window(
    state: State<'_, ScreenState>,
    window_id: u32,
) -> Result<(), String> {
    let capture = state.capture.read().await;
    capture
        .select_source(CaptureSource::Window { id: window_id })
        .await;
    Ok(())
}

/// Clear the selected source
#[tauri::command]
pub async fn screen_clear_selection(state: State<'_, ScreenState>) -> Result<(), String> {
    let capture = state.capture.read().await;
    capture.clear_source().await;
    Ok(())
}

/// Get the currently selected source
#[tauri::command]
pub async fn screen_get_selection(
    state: State<'_, ScreenState>,
) -> Result<Option<CaptureSource>, String> {
    let capture = state.capture.read().await;
    Ok(capture.get_selected_source().await)
}

/// Check if screen recording permission is granted (macOS)
#[tauri::command]
pub async fn screen_check_permission() -> Result<bool, String> {
    Ok(ScreenCapture::check_permission())
}

/// Request screen recording permission (macOS)
/// Returns true if already granted, false if dialog was shown
#[tauri::command]
pub async fn screen_request_permission() -> Result<bool, String> {
    Ok(ScreenCapture::request_permission())
}

/// Capture a preview image (scaled down, base64 PNG)
#[tauri::command]
pub async fn screen_capture_preview(
    state: State<'_, ScreenState>,
    max_width: Option<u32>,
) -> Result<String, String> {
    let capture = state.capture.read().await;
    capture
        .capture_preview(max_width.unwrap_or(400))
        .await
        .map_err(|e| e.to_string())
}

/// Start screen sharing (sets internal state)
#[tauri::command]
pub async fn screen_start_sharing(state: State<'_, ScreenState>) -> Result<(), String> {
    let capture = state.capture.read().await;

    // Check if a source is selected
    if capture.get_selected_source().await.is_none() {
        return Err("No source selected".to_string());
    }

    capture.set_capturing(true).await;
    Ok(())
}

/// Stop screen sharing
#[tauri::command]
pub async fn screen_stop_sharing(state: State<'_, ScreenState>) -> Result<(), String> {
    let capture = state.capture.read().await;
    capture.set_capturing(false).await;
    Ok(())
}

/// Check if currently sharing screen
#[tauri::command]
pub async fn screen_is_sharing(state: State<'_, ScreenState>) -> Result<bool, String> {
    let capture = state.capture.read().await;
    Ok(capture.is_capturing().await)
}

/// Capture a single frame (returns base64 PNG for now - will be video track in Phase 8)
#[tauri::command]
pub async fn screen_capture_frame(
    state: State<'_, ScreenState>,
) -> Result<String, String> {
    let capture = state.capture.read().await;
    capture
        .capture_preview(1920) // Full HD max width
        .await
        .map_err(|e| e.to_string())
}
