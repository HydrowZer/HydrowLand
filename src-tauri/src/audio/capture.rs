use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Host, Stream, StreamConfig};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::Arc;

use super::{CHANNELS, SAMPLES_PER_FRAME, SAMPLE_RATE};

/// Audio capture from microphone using cpal
pub struct AudioCapture {
    host: Host,
    device: Option<Device>,
    stream: Option<Stream>,
    /// Simple buffer for captured samples
    buffer: Arc<Mutex<VecDeque<f32>>>,
}

impl AudioCapture {
    pub fn new() -> Result<Self, String> {
        let host = cpal::default_host();

        Ok(Self {
            host,
            device: None,
            stream: None,
            buffer: Arc::new(Mutex::new(VecDeque::with_capacity(SAMPLES_PER_FRAME * 10))),
        })
    }

    /// List available input devices
    pub fn list_devices() -> Result<Vec<String>, String> {
        let host = cpal::default_host();
        let devices = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;

        let names: Vec<String> = devices
            .filter_map(|d| d.name().ok())
            .collect();

        Ok(names)
    }

    /// Select input device by name (None for default)
    pub fn select_device(&mut self, name: Option<&str>) -> Result<(), String> {
        self.device = match name {
            Some(device_name) => {
                let devices = self.host.input_devices()
                    .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

                devices
                    .filter(|d| d.name().map(|n| n == device_name).unwrap_or(false))
                    .next()
                    .ok_or_else(|| format!("Device '{}' not found", device_name))?
                    .into()
            }
            None => self.host.default_input_device(),
        };

        Ok(())
    }

    /// Start capturing audio
    /// Callback receives chunks of f32 samples
    pub fn start<F>(&mut self, mut callback: F) -> Result<(), String>
    where
        F: FnMut(Vec<f32>) + Send + 'static,
    {
        let device = self.device.take()
            .or_else(|| self.host.default_input_device())
            .ok_or("No input device available")?;

        tracing::info!("Using input device: {}", device.name().unwrap_or_default());

        let config = StreamConfig {
            channels: CHANNELS,
            sample_rate: cpal::SampleRate(SAMPLE_RATE),
            buffer_size: cpal::BufferSize::Fixed(SAMPLES_PER_FRAME as u32),
        };

        let buffer = self.buffer.clone();

        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Push samples to buffer
                let mut buf = buffer.lock();
                for &sample in data {
                    buf.push_back(sample);
                }

                // When we have enough samples for a frame, send them
                while buf.len() >= SAMPLES_PER_FRAME {
                    let samples: Vec<f32> = buf.drain(..SAMPLES_PER_FRAME).collect();
                    callback(samples);
                }
            },
            move |err| {
                tracing::error!("Audio input error: {}", err);
            },
            None,
        ).map_err(|e| format!("Failed to build input stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start stream: {}", e))?;

        self.device = Some(device);
        self.stream = Some(stream);

        Ok(())
    }

    /// Stop capturing
    pub fn stop(self) {
        // Stream is dropped, stopping capture
        drop(self.stream);
    }

    /// Get the buffer for direct access
    pub fn get_buffer(&self) -> Arc<Mutex<VecDeque<f32>>> {
        self.buffer.clone()
    }
}

impl Default for AudioCapture {
    fn default() -> Self {
        Self::new().expect("Failed to create AudioCapture")
    }
}
