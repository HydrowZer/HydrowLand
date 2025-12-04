use base64::Engine;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use xcap::{Monitor, Window};

#[derive(Error, Debug)]
pub enum ScreenCaptureError {
    #[error("Failed to enumerate monitors: {0}")]
    MonitorEnumeration(String),
    #[error("Failed to enumerate windows: {0}")]
    WindowEnumeration(String),
    #[error("Failed to capture screen: {0}")]
    CaptureError(String),
    #[error("No source selected")]
    NoSourceSelected,
    #[error("Source not found: {0}")]
    SourceNotFound(String),
    #[error("Permission denied - Screen recording permission required")]
    PermissionDenied,
}

/// Information about a monitor/display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: f32,
}

/// Information about a window
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_minimized: bool,
}

/// What to capture
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CaptureSource {
    Monitor { id: u32 },
    Window { id: u32 },
}

/// Combined source info for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CaptureSourceInfo {
    Monitor(MonitorInfo),
    Window(WindowInfo),
}

/// A captured frame
#[derive(Debug, Clone)]
pub struct CapturedFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>, // RGBA pixels
}

/// Screen capture manager
pub struct ScreenCapture {
    selected_source: RwLock<Option<CaptureSource>>,
    is_capturing: RwLock<bool>,
}

impl Default for ScreenCapture {
    fn default() -> Self {
        Self::new()
    }
}

impl ScreenCapture {
    pub fn new() -> Self {
        Self {
            selected_source: RwLock::new(None),
            is_capturing: RwLock::new(false),
        }
    }

    /// List all available monitors
    pub fn list_monitors() -> Result<Vec<MonitorInfo>, ScreenCaptureError> {
        let monitors = Monitor::all().map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("permission") || err_msg.contains("denied") {
                ScreenCaptureError::PermissionDenied
            } else {
                ScreenCaptureError::MonitorEnumeration(err_msg)
            }
        })?;

        let mut result = Vec::new();
        for (idx, monitor) in monitors.iter().enumerate() {
            result.push(MonitorInfo {
                id: idx as u32,
                name: monitor.name().unwrap_or_default(),
                x: monitor.x().unwrap_or(0),
                y: monitor.y().unwrap_or(0),
                width: monitor.width().unwrap_or(0),
                height: monitor.height().unwrap_or(0),
                is_primary: monitor.is_primary().unwrap_or(false),
                scale_factor: monitor.scale_factor().unwrap_or(1.0),
            });
        }

        Ok(result)
    }

    /// List all available windows (excluding minimized ones by default)
    pub fn list_windows(include_minimized: bool) -> Result<Vec<WindowInfo>, ScreenCaptureError> {
        let windows = Window::all().map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("permission") || err_msg.contains("denied") {
                ScreenCaptureError::PermissionDenied
            } else {
                ScreenCaptureError::WindowEnumeration(err_msg)
            }
        })?;

        let mut result = Vec::new();
        for window in windows.iter() {
            let is_minimized = window.is_minimized().unwrap_or(false);

            // Skip minimized windows unless specifically requested
            if is_minimized && !include_minimized {
                continue;
            }

            // Skip windows with empty titles or very small dimensions (likely invisible)
            let title = window.title().unwrap_or_default();
            let width = window.width().unwrap_or(0);
            let height = window.height().unwrap_or(0);

            if title.is_empty() || width < 10 || height < 10 {
                continue;
            }

            result.push(WindowInfo {
                id: window.id().unwrap_or(0),
                title,
                app_name: window.app_name().unwrap_or_default(),
                x: window.x().unwrap_or(0),
                y: window.y().unwrap_or(0),
                width,
                height,
                is_minimized,
            });
        }

        Ok(result)
    }

    /// Get all available capture sources (monitors + windows)
    pub fn list_sources(include_minimized: bool) -> Result<Vec<CaptureSourceInfo>, ScreenCaptureError> {
        let mut sources = Vec::new();

        // Add monitors first
        if let Ok(monitors) = Self::list_monitors() {
            for monitor in monitors {
                sources.push(CaptureSourceInfo::Monitor(monitor));
            }
        }

        // Then add windows
        if let Ok(windows) = Self::list_windows(include_minimized) {
            for window in windows {
                sources.push(CaptureSourceInfo::Window(window));
            }
        }

        Ok(sources)
    }

    /// Select a source for capture
    pub async fn select_source(&self, source: CaptureSource) {
        let mut selected = self.selected_source.write().await;
        *selected = Some(source);
    }

    /// Clear the selected source
    pub async fn clear_source(&self) {
        let mut selected = self.selected_source.write().await;
        *selected = None;
    }

    /// Get the currently selected source
    pub async fn get_selected_source(&self) -> Option<CaptureSource> {
        self.selected_source.read().await.clone()
    }

    /// Capture a single frame from the selected source
    pub async fn capture_frame(&self) -> Result<CapturedFrame, ScreenCaptureError> {
        let source = self.selected_source.read().await;
        let source = source
            .as_ref()
            .ok_or(ScreenCaptureError::NoSourceSelected)?;

        match source {
            CaptureSource::Monitor { id } => Self::capture_monitor(*id),
            CaptureSource::Window { id } => Self::capture_window(*id),
        }
    }

    /// Capture a specific monitor by index
    fn capture_monitor(monitor_id: u32) -> Result<CapturedFrame, ScreenCaptureError> {
        let monitors = Monitor::all().map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("permission") || err_msg.contains("denied") {
                ScreenCaptureError::PermissionDenied
            } else {
                ScreenCaptureError::MonitorEnumeration(err_msg)
            }
        })?;

        let monitor = monitors
            .get(monitor_id as usize)
            .ok_or_else(|| ScreenCaptureError::SourceNotFound(format!("Monitor {}", monitor_id)))?;

        let image = monitor.capture_image().map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("permission") || err_msg.contains("denied") {
                ScreenCaptureError::PermissionDenied
            } else {
                ScreenCaptureError::CaptureError(err_msg)
            }
        })?;

        Ok(CapturedFrame {
            width: image.width(),
            height: image.height(),
            data: image.into_raw(),
        })
    }

    /// Capture a specific window by ID
    fn capture_window(window_id: u32) -> Result<CapturedFrame, ScreenCaptureError> {
        let windows = Window::all().map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("permission") || err_msg.contains("denied") {
                ScreenCaptureError::PermissionDenied
            } else {
                ScreenCaptureError::WindowEnumeration(err_msg)
            }
        })?;

        let window = windows
            .iter()
            .find(|w| w.id().unwrap_or(0) == window_id)
            .ok_or_else(|| ScreenCaptureError::SourceNotFound(format!("Window {}", window_id)))?;

        let image = window.capture_image().map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("permission") || err_msg.contains("denied") {
                ScreenCaptureError::PermissionDenied
            } else {
                ScreenCaptureError::CaptureError(err_msg)
            }
        })?;

        Ok(CapturedFrame {
            width: image.width(),
            height: image.height(),
            data: image.into_raw(),
        })
    }

    /// Check if we have screen capture permissions (macOS-specific)
    #[cfg(target_os = "macos")]
    pub fn check_permission() -> bool {
        // Try to list monitors - if it fails with permission error, we don't have permission
        match Monitor::all() {
            Ok(monitors) => {
                // Try to capture from the first monitor to really test permission
                if let Some(monitor) = monitors.first() {
                    monitor.capture_image().is_ok()
                } else {
                    true // No monitors is unusual but not a permission issue
                }
            }
            Err(_) => false,
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn check_permission() -> bool {
        // Windows and Linux don't require special permissions
        true
    }

    /// Request screen capture permission (macOS)
    /// Returns true if permission was already granted, false if user needs to grant it
    #[cfg(target_os = "macos")]
    pub fn request_permission() -> bool {
        // On macOS, the first attempt to capture will trigger the permission dialog
        // We just check if we have it
        Self::check_permission()
    }

    #[cfg(not(target_os = "macos"))]
    pub fn request_permission() -> bool {
        true
    }

    /// Set capturing state
    pub async fn set_capturing(&self, capturing: bool) {
        let mut state = self.is_capturing.write().await;
        *state = capturing;
    }

    /// Check if currently capturing
    pub async fn is_capturing(&self) -> bool {
        *self.is_capturing.read().await
    }

    /// Capture a frame and return it as base64-encoded PNG for preview
    pub async fn capture_preview(&self, max_width: u32) -> Result<String, ScreenCaptureError> {
        let frame = self.capture_frame().await?;

        // Scale down if needed
        let scale = if frame.width > max_width {
            max_width as f32 / frame.width as f32
        } else {
            1.0
        };

        let new_width = (frame.width as f32 * scale) as u32;
        let new_height = (frame.height as f32 * scale) as u32;

        // Create image buffer
        use image::{ImageBuffer, Rgba};

        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(frame.width, frame.height, frame.data)
                .ok_or_else(|| ScreenCaptureError::CaptureError("Failed to create image buffer".into()))?;

        // Resize if needed
        let img = if scale < 1.0 {
            image::imageops::resize(&img, new_width, new_height, image::imageops::FilterType::Triangle)
        } else {
            img
        };

        // Encode as PNG using image crate's write interface
        use image::ImageEncoder;
        let mut png_data = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
        encoder.write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgba8,
        ).map_err(|e| ScreenCaptureError::CaptureError(format!("PNG encoding failed: {}", e)))?;

        // Return as base64
        Ok(base64::engine::general_purpose::STANDARD.encode(&png_data))
    }
}
