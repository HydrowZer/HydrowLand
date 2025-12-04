//! Screen streaming commands
//! Handles continuous screen capture, encoding, and WebRTC transmission

use std::sync::Arc;
use parking_lot::RwLock;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::video::{VideoEncoder, VideoFrame, EncoderConfig};

/// State for screen streaming
pub struct ScreenStreamState {
    inner: Arc<ScreenStreamInner>,
}

struct ScreenStreamInner {
    /// Whether streaming is active
    is_streaming: RwLock<bool>,
    /// Stop signal sender
    stop_tx: RwLock<Option<mpsc::Sender<()>>>,
    /// Current FPS
    fps: RwLock<u32>,
    /// Current encoded frame (for viewers)
    current_frame: RwLock<Option<EncodedFrameData>>,
    /// Statistics
    stats: RwLock<StreamStats>,
}

#[derive(Debug, Clone, Default)]
struct StreamStats {
    frames_sent: u64,
    total_bytes: u64,
    avg_frame_size: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EncodedFrameData {
    /// Base64 encoded JPEG data
    pub data: String,
    /// Frame width
    pub width: u32,
    /// Frame height
    pub height: u32,
    /// Whether this is a keyframe
    pub is_keyframe: bool,
    /// Frame number
    pub frame_number: u64,
    /// Timestamp in milliseconds
    pub timestamp: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamStatsResponse {
    pub is_streaming: bool,
    pub fps: u32,
    pub frames_sent: u64,
    pub total_bytes: u64,
    pub avg_frame_size: u64,
}

impl Default for ScreenStreamState {
    fn default() -> Self {
        Self {
            inner: Arc::new(ScreenStreamInner {
                is_streaming: RwLock::new(false),
                stop_tx: RwLock::new(None),
                fps: RwLock::new(15),
                current_frame: RwLock::new(None),
                stats: RwLock::new(StreamStats::default()),
            }),
        }
    }
}

/// Start screen streaming at the specified FPS
/// Emits "screen-frame" events to the frontend with encoded frame data
#[tauri::command]
pub async fn screen_stream_start(
    app: AppHandle,
    screen_state: State<'_, crate::commands::screen::ScreenState>,
    stream_state: State<'_, ScreenStreamState>,
    fps: Option<u32>,
) -> Result<(), String> {
    let inner = stream_state.inner.clone();

    // Check if already streaming
    if *inner.is_streaming.read() {
        return Err("Already streaming".to_string());
    }

    // Get the screen capture instance
    let capture = screen_state.capture().clone();

    // Check if a source is selected
    {
        let cap = capture.read().await;
        if cap.get_selected_source().await.is_none() {
            return Err("No screen source selected".to_string());
        }
    }

    // Set FPS
    let target_fps = fps.unwrap_or(15).clamp(5, 30);
    *inner.fps.write() = target_fps;

    // Create stop channel
    let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
    *inner.stop_tx.write() = Some(stop_tx);

    // Mark as streaming
    *inner.is_streaming.write() = true;

    // Reset stats
    *inner.stats.write() = StreamStats::default();

    // Clone for the async task
    let inner_clone = inner.clone();
    let app_clone = app.clone();

    // Spawn streaming task
    tokio::spawn(async move {
        let mut encoder = VideoEncoder::new(EncoderConfig {
            fps: target_fps,
            bitrate_kbps: 4000,
            max_width: 1920,
            max_height: 1080,
            quality: 85,
        });

        let frame_interval = std::time::Duration::from_millis(1000 / target_fps as u64);
        let start_time = std::time::Instant::now();

        loop {
            // Check for stop signal
            if stop_rx.try_recv().is_ok() || !*inner_clone.is_streaming.read() {
                tracing::info!("Screen streaming stopped");
                break;
            }

            let frame_start = std::time::Instant::now();

            // Capture frame
            let cap = capture.read().await;
            match cap.capture_frame().await {
                Ok(captured) => {
                    drop(cap); // Release the lock early

                    let video_frame = VideoFrame::new(
                        captured.width,
                        captured.height,
                        captured.data,
                    );

                    // Encode frame
                    match encoder.encode(&video_frame) {
                        Ok(encoded) => {
                            // Adapt quality based on frame size
                            encoder.adapt_quality(encoded.size());

                            // Create encoded frame data
                            use base64::Engine;
                            let frame_data = EncodedFrameData {
                                data: base64::engine::general_purpose::STANDARD.encode(&encoded.data),
                                width: encoded.width,
                                height: encoded.height,
                                is_keyframe: encoded.is_keyframe,
                                frame_number: encoded.frame_number,
                                timestamp: start_time.elapsed().as_millis() as u64,
                            };

                            // Update stats
                            {
                                let mut stats = inner_clone.stats.write();
                                stats.frames_sent += 1;
                                stats.total_bytes += encoded.size() as u64;
                                stats.avg_frame_size = stats.total_bytes / stats.frames_sent;
                            }

                            // Store current frame for late joiners
                            *inner_clone.current_frame.write() = Some(frame_data.clone());

                            // Emit to frontend
                            if let Err(e) = app_clone.emit("screen-frame", frame_data) {
                                tracing::warn!("Failed to emit screen frame: {}", e);
                            }
                        }
                        Err(e) => {
                            tracing::warn!("Failed to encode frame: {}", e);
                        }
                    }
                }
                Err(e) => {
                    drop(cap); // Release the lock
                    tracing::warn!("Failed to capture frame: {}", e);
                }
            }

            // Sleep to maintain frame rate
            let elapsed = frame_start.elapsed();
            if elapsed < frame_interval {
                tokio::time::sleep(frame_interval - elapsed).await;
            }
        }

        // Cleanup
        *inner_clone.is_streaming.write() = false;
        *inner_clone.stop_tx.write() = None;
        *inner_clone.current_frame.write() = None;
    });

    Ok(())
}

/// Stop screen streaming
#[tauri::command]
pub async fn screen_stream_stop(
    stream_state: State<'_, ScreenStreamState>,
) -> Result<(), String> {
    let inner = &stream_state.inner;

    // Get the sender without holding the lock across await
    let tx = inner.stop_tx.read().clone();

    // Send stop signal
    if let Some(tx) = tx {
        let _ = tx.send(()).await;
    }

    // Mark as not streaming
    *inner.is_streaming.write() = false;
    *inner.stop_tx.write() = None;

    Ok(())
}

/// Check if screen streaming is active
#[tauri::command]
pub fn screen_stream_is_active(
    stream_state: State<'_, ScreenStreamState>,
) -> bool {
    *stream_state.inner.is_streaming.read()
}

/// Get streaming statistics
#[tauri::command]
pub fn screen_stream_get_stats(
    stream_state: State<'_, ScreenStreamState>,
) -> StreamStatsResponse {
    let inner = &stream_state.inner;
    let stats = inner.stats.read();

    StreamStatsResponse {
        is_streaming: *inner.is_streaming.read(),
        fps: *inner.fps.read(),
        frames_sent: stats.frames_sent,
        total_bytes: stats.total_bytes,
        avg_frame_size: stats.avg_frame_size,
    }
}

/// Get the current frame (for viewers joining mid-stream)
#[tauri::command]
pub fn screen_stream_get_current_frame(
    stream_state: State<'_, ScreenStreamState>,
) -> Option<EncodedFrameData> {
    stream_state.inner.current_frame.read().clone()
}

/// Set streaming FPS (will take effect on next stream start)
#[tauri::command]
pub fn screen_stream_set_fps(
    stream_state: State<'_, ScreenStreamState>,
    fps: u32,
) -> Result<(), String> {
    let target_fps = fps.clamp(5, 30);
    *stream_state.inner.fps.write() = target_fps;
    Ok(())
}
