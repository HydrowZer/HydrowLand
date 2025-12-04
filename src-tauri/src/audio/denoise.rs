#![allow(dead_code)]

//! Noise reduction using nnnoiseless (RNNoise-based)
//! Provides real-time noise suppression for voice audio

use nnnoiseless::DenoiseState;
use parking_lot::Mutex;
use std::sync::Arc;

/// Frame size required by nnnoiseless (480 samples at 48kHz = 10ms)
const DENOISE_FRAME_SIZE: usize = 480;

/// Target sample rate for nnnoiseless
const DENOISE_SAMPLE_RATE: u32 = 48000;

/// Audio denoiser with resampling support
pub struct AudioDenoiser {
    /// The nnnoiseless denoiser state
    state: Box<DenoiseState<'static>>,
    /// Input buffer for accumulating samples
    input_buffer: Vec<f32>,
    /// Output buffer for processed samples
    output_buffer: Vec<f32>,
    /// Whether denoising is enabled
    enabled: bool,
    /// Source sample rate (for resampling)
    source_sample_rate: u32,
    /// Resampling buffer
    resample_buffer: Vec<f32>,
}

impl AudioDenoiser {
    /// Create a new denoiser
    pub fn new() -> Self {
        Self {
            state: DenoiseState::new(),
            input_buffer: Vec::with_capacity(DENOISE_FRAME_SIZE * 4),
            output_buffer: Vec::with_capacity(DENOISE_FRAME_SIZE * 4),
            enabled: true,
            source_sample_rate: DENOISE_SAMPLE_RATE,
            resample_buffer: Vec::with_capacity(DENOISE_FRAME_SIZE * 4),
        }
    }

    /// Set the source sample rate for resampling
    pub fn set_sample_rate(&mut self, rate: u32) {
        self.source_sample_rate = rate;
        self.input_buffer.clear();
        self.output_buffer.clear();
        self.resample_buffer.clear();
    }

    /// Enable or disable noise reduction
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            // Clear buffers when disabled
            self.input_buffer.clear();
            self.output_buffer.clear();
        }
    }

    /// Check if noise reduction is enabled
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Process audio samples through the denoiser
    /// Returns denoised samples (may be empty if buffering)
    pub fn process(&mut self, samples: &[f32]) -> Vec<f32> {
        if !self.enabled {
            return samples.to_vec();
        }

        // Resample to 48kHz if needed
        let samples_48k = if self.source_sample_rate != DENOISE_SAMPLE_RATE {
            self.resample_to_48k(samples)
        } else {
            samples.to_vec()
        };

        // Add to input buffer
        self.input_buffer.extend_from_slice(&samples_48k);

        // Process complete frames
        while self.input_buffer.len() >= DENOISE_FRAME_SIZE {
            let frame: Vec<f32> = self.input_buffer.drain(..DENOISE_FRAME_SIZE).collect();

            // nnnoiseless expects and returns [f32; DENOISE_FRAME_SIZE]
            let mut input_frame = [0.0f32; DENOISE_FRAME_SIZE];
            let mut output_frame = [0.0f32; DENOISE_FRAME_SIZE];

            input_frame.copy_from_slice(&frame);

            // Process the frame
            self.state.process_frame(&mut output_frame, &input_frame);

            self.output_buffer.extend_from_slice(&output_frame);
        }

        // Resample back to source rate if needed
        let result = if self.source_sample_rate != DENOISE_SAMPLE_RATE {
            let resampled = self.resample_from_48k(&self.output_buffer);
            self.output_buffer.clear();
            resampled
        } else {
            let result = self.output_buffer.clone();
            self.output_buffer.clear();
            result
        };

        result
    }

    /// Simple linear resampling to 48kHz
    fn resample_to_48k(&self, samples: &[f32]) -> Vec<f32> {
        if self.source_sample_rate == DENOISE_SAMPLE_RATE {
            return samples.to_vec();
        }

        let ratio = DENOISE_SAMPLE_RATE as f64 / self.source_sample_rate as f64;
        let output_len = (samples.len() as f64 * ratio).ceil() as usize;
        let mut output = Vec::with_capacity(output_len);

        for i in 0..output_len {
            let src_idx = i as f64 / ratio;
            let idx_floor = src_idx.floor() as usize;
            let idx_ceil = (idx_floor + 1).min(samples.len() - 1);
            let frac = src_idx - idx_floor as f64;

            let sample = if idx_floor < samples.len() {
                let s1 = samples[idx_floor];
                let s2 = samples[idx_ceil];
                s1 + (s2 - s1) * frac as f32
            } else {
                0.0
            };

            output.push(sample);
        }

        output
    }

    /// Simple linear resampling from 48kHz back to source rate
    fn resample_from_48k(&self, samples: &[f32]) -> Vec<f32> {
        if self.source_sample_rate == DENOISE_SAMPLE_RATE {
            return samples.to_vec();
        }

        let ratio = self.source_sample_rate as f64 / DENOISE_SAMPLE_RATE as f64;
        let output_len = (samples.len() as f64 * ratio).ceil() as usize;
        let mut output = Vec::with_capacity(output_len);

        for i in 0..output_len {
            let src_idx = i as f64 / ratio;
            let idx_floor = src_idx.floor() as usize;
            let idx_ceil = (idx_floor + 1).min(samples.len().saturating_sub(1));
            let frac = src_idx - idx_floor as f64;

            let sample = if idx_floor < samples.len() {
                let s1 = samples[idx_floor];
                let s2 = samples.get(idx_ceil).copied().unwrap_or(s1);
                s1 + (s2 - s1) * frac as f32
            } else {
                0.0
            };

            output.push(sample);
        }

        output
    }

    /// Reset the denoiser state
    pub fn reset(&mut self) {
        self.state = DenoiseState::new();
        self.input_buffer.clear();
        self.output_buffer.clear();
        self.resample_buffer.clear();
    }
}

impl Default for AudioDenoiser {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe denoiser wrapper
pub struct SharedDenoiser {
    inner: Arc<Mutex<AudioDenoiser>>,
}

impl SharedDenoiser {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(AudioDenoiser::new())),
        }
    }

    pub fn set_sample_rate(&self, rate: u32) {
        self.inner.lock().set_sample_rate(rate);
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.inner.lock().set_enabled(enabled);
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.lock().is_enabled()
    }

    pub fn process(&self, samples: &[f32]) -> Vec<f32> {
        self.inner.lock().process(samples)
    }

    pub fn reset(&self) {
        self.inner.lock().reset();
    }
}

impl Default for SharedDenoiser {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for SharedDenoiser {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}
