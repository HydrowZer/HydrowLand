#![allow(dead_code)]

//! Video frame encoding for screen sharing
//!
//! Uses JPEG encoding for simplicity and cross-platform compatibility.
//! This avoids the need for libvpx system dependencies while still providing
//! efficient video compression for screen sharing.

use image::{ImageBuffer, Rgba, ImageEncoder};
use std::io::Cursor;

/// Video frame to be encoded
#[derive(Debug, Clone)]
pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>, // RGBA pixels
}

impl VideoFrame {
    /// Create a new video frame from RGBA data
    pub fn new(width: u32, height: u32, data: Vec<u8>) -> Self {
        Self { width, height, data }
    }

    /// Get the frame size in bytes (RGBA)
    pub fn size(&self) -> usize {
        self.data.len()
    }
}

/// Video encoder configuration
#[derive(Debug, Clone)]
pub struct EncoderConfig {
    /// Target bitrate in kbps (approximate for JPEG quality mapping)
    pub bitrate_kbps: u32,
    /// Target frame rate
    pub fps: u32,
    /// Maximum width (frames will be downscaled if larger)
    pub max_width: u32,
    /// Maximum height (frames will be downscaled if larger)
    pub max_height: u32,
    /// JPEG quality (1-100)
    pub quality: u8,
}

impl Default for EncoderConfig {
    fn default() -> Self {
        Self {
            bitrate_kbps: 4000,
            fps: 30,
            max_width: 1920,
            max_height: 1080,
            quality: 85, // High quality for sharp screen content
        }
    }
}

/// Video encoder for screen sharing
/// Uses JPEG encoding for cross-platform compatibility
pub struct VideoEncoder {
    config: EncoderConfig,
    frame_count: u64,
    keyframe_interval: u64,
}

impl VideoEncoder {
    /// Create a new video encoder with the given configuration
    pub fn new(config: EncoderConfig) -> Self {
        // Send keyframe every ~2 seconds
        let keyframe_interval = (config.fps * 2) as u64;

        Self {
            config,
            frame_count: 0,
            keyframe_interval,
        }
    }

    /// Create with default settings (2Mbps, 15fps)
    pub fn with_defaults() -> Self {
        Self::new(EncoderConfig::default())
    }

    /// Get the target FPS
    pub fn fps(&self) -> u32 {
        self.config.fps
    }

    /// Get the frame interval in milliseconds
    pub fn frame_interval_ms(&self) -> u64 {
        1000 / self.config.fps as u64
    }

    /// Check if the next frame should be a keyframe
    pub fn should_be_keyframe(&self) -> bool {
        self.frame_count % self.keyframe_interval == 0
    }

    /// Encode a video frame
    /// Returns the encoded data and whether it's a keyframe
    pub fn encode(&mut self, frame: &VideoFrame) -> Result<EncodedFrame, String> {
        let is_keyframe = self.should_be_keyframe();
        self.frame_count += 1;

        // Create image buffer from RGBA data
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(frame.width, frame.height, frame.data.clone())
                .ok_or_else(|| "Failed to create image buffer from frame data".to_string())?;

        // Resize if needed
        let (target_width, target_height) = self.calculate_target_size(frame.width, frame.height);

        let img = if target_width != frame.width || target_height != frame.height {
            image::imageops::resize(&img, target_width, target_height, image::imageops::FilterType::Triangle)
        } else {
            img
        };

        // Convert RGBA to RGB for JPEG encoding
        let rgb_img = image::DynamicImage::ImageRgba8(img).to_rgb8();

        // Encode as JPEG
        let mut jpeg_data = Vec::new();
        let mut cursor = Cursor::new(&mut jpeg_data);

        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, self.config.quality);
        encoder.write_image(
            rgb_img.as_raw(),
            rgb_img.width(),
            rgb_img.height(),
            image::ExtendedColorType::Rgb8,
        ).map_err(|e| format!("JPEG encoding failed: {}", e))?;

        Ok(EncodedFrame {
            data: jpeg_data,
            width: target_width,
            height: target_height,
            is_keyframe,
            frame_number: self.frame_count - 1,
        })
    }

    /// Calculate target size maintaining aspect ratio
    fn calculate_target_size(&self, width: u32, height: u32) -> (u32, u32) {
        let max_w = self.config.max_width;
        let max_h = self.config.max_height;

        if width <= max_w && height <= max_h {
            return (width, height);
        }

        let scale_w = max_w as f32 / width as f32;
        let scale_h = max_h as f32 / height as f32;
        let scale = scale_w.min(scale_h);

        let new_width = (width as f32 * scale) as u32;
        let new_height = (height as f32 * scale) as u32;

        (new_width.max(1), new_height.max(1))
    }

    /// Adjust quality based on encoded frame size
    /// Returns true if quality was changed
    pub fn adapt_quality(&mut self, encoded_size: usize) {
        // Target ~130KB per frame for 2Mbps at 15fps
        // (2000 kbps / 8 / 15 = ~16.6 KB, but JPEG is I-frame only so higher)
        let target_size = (self.config.bitrate_kbps as usize * 1000 / 8 / self.config.fps as usize) * 8;

        if encoded_size > target_size * 2 && self.config.quality > 30 {
            self.config.quality = self.config.quality.saturating_sub(5);
        } else if encoded_size < target_size / 2 && self.config.quality < 90 {
            self.config.quality = self.config.quality.saturating_add(5);
        }
    }

    /// Reset frame counter (call when starting a new stream)
    pub fn reset(&mut self) {
        self.frame_count = 0;
    }
}

/// Encoded video frame
#[derive(Debug, Clone)]
pub struct EncodedFrame {
    /// Encoded frame data (JPEG)
    pub data: Vec<u8>,
    /// Frame width
    pub width: u32,
    /// Frame height
    pub height: u32,
    /// Whether this is a keyframe
    pub is_keyframe: bool,
    /// Frame number in sequence
    pub frame_number: u64,
}

impl EncodedFrame {
    /// Get the encoded size in bytes
    pub fn size(&self) -> usize {
        self.data.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encoder_creation() {
        let encoder = VideoEncoder::with_defaults();
        assert_eq!(encoder.fps(), 15);
        assert_eq!(encoder.frame_interval_ms(), 66);
    }

    #[test]
    fn test_encode_frame() {
        let mut encoder = VideoEncoder::with_defaults();

        // Create a simple 100x100 red frame
        let mut data = Vec::with_capacity(100 * 100 * 4);
        for _ in 0..(100 * 100) {
            data.extend_from_slice(&[255, 0, 0, 255]); // RGBA red
        }

        let frame = VideoFrame::new(100, 100, data);
        let encoded = encoder.encode(&frame).expect("Encoding should succeed");

        assert!(encoded.is_keyframe); // First frame should be keyframe
        assert!(!encoded.data.is_empty());
        assert_eq!(encoded.width, 100);
        assert_eq!(encoded.height, 100);
    }

    #[test]
    fn test_keyframe_interval() {
        let mut encoder = VideoEncoder::new(EncoderConfig {
            fps: 15,
            ..Default::default()
        });

        // Create a minimal frame
        let frame = VideoFrame::new(10, 10, vec![128; 10 * 10 * 4]);

        // Frame 0 should be keyframe
        assert!(encoder.should_be_keyframe());
        let _ = encoder.encode(&frame);

        // Frames 1-29 should not be keyframes
        for _ in 1..30 {
            assert!(!encoder.should_be_keyframe());
            let _ = encoder.encode(&frame);
        }

        // Frame 30 should be keyframe (at 15fps, every 2 seconds)
        assert!(encoder.should_be_keyframe());
    }

    #[test]
    fn test_resize_large_frame() {
        let mut encoder = VideoEncoder::new(EncoderConfig {
            max_width: 1280,
            max_height: 720,
            ..Default::default()
        });

        // Create 4K frame
        let frame = VideoFrame::new(3840, 2160, vec![128; 3840 * 2160 * 4]);
        let encoded = encoder.encode(&frame).expect("Encoding should succeed");

        // Should be resized to fit within 1280x720 while maintaining aspect ratio
        assert!(encoded.width <= 1280);
        assert!(encoded.height <= 720);
    }
}
