use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Host, Stream, StreamConfig};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::Arc;

use super::{CHANNELS, SAMPLES_PER_FRAME, SAMPLE_RATE};

/// Audio playback to speakers using cpal
pub struct AudioPlayback {
    host: Host,
    device: Option<Device>,
    stream: Option<Stream>,
    /// Buffer for samples to play
    buffer: Arc<Mutex<VecDeque<f32>>>,
}

impl AudioPlayback {
    pub fn new() -> Result<Self, String> {
        let host = cpal::default_host();

        Ok(Self {
            host,
            device: None,
            stream: None,
            buffer: Arc::new(Mutex::new(VecDeque::with_capacity(SAMPLES_PER_FRAME * 10))),
        })
    }

    /// List available output devices
    pub fn list_devices() -> Result<Vec<String>, String> {
        let host = cpal::default_host();
        let devices = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {}", e))?;

        let names: Vec<String> = devices
            .filter_map(|d| d.name().ok())
            .collect();

        Ok(names)
    }

    /// Select output device by name (None for default)
    pub fn select_device(&mut self, name: Option<&str>) -> Result<(), String> {
        self.device = match name {
            Some(device_name) => {
                let devices = self.host.output_devices()
                    .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

                devices
                    .filter(|d| d.name().map(|n| n == device_name).unwrap_or(false))
                    .next()
                    .ok_or_else(|| format!("Device '{}' not found", device_name))?
                    .into()
            }
            None => self.host.default_output_device(),
        };

        Ok(())
    }

    /// Start playback
    /// Callback should return samples to play
    pub fn start<F>(&mut self, get_samples: F) -> Result<(), String>
    where
        F: Fn() -> Vec<f32> + Send + 'static,
    {
        let device = self.device.take()
            .or_else(|| self.host.default_output_device())
            .ok_or("No output device available")?;

        tracing::info!("Using output device: {}", device.name().unwrap_or_default());

        let config = StreamConfig {
            channels: CHANNELS,
            sample_rate: cpal::SampleRate(SAMPLE_RATE),
            buffer_size: cpal::BufferSize::Fixed(SAMPLES_PER_FRAME as u32),
        };

        let buffer = self.buffer.clone();

        let stream = device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let mut buf = buffer.lock();

                // If buffer has samples, use them
                if buf.len() >= data.len() {
                    for sample in data.iter_mut() {
                        *sample = buf.pop_front().unwrap_or(0.0);
                    }
                } else {
                    // Otherwise, get from callback and buffer excess
                    let samples = get_samples();

                    if samples.is_empty() {
                        // Silence
                        data.fill(0.0);
                    } else {
                        // Copy what we need
                        let copy_len = samples.len().min(data.len());
                        data[..copy_len].copy_from_slice(&samples[..copy_len]);

                        // Silence the rest if needed
                        if copy_len < data.len() {
                            data[copy_len..].fill(0.0);
                        }

                        // Buffer excess
                        if samples.len() > data.len() {
                            for &sample in &samples[data.len()..] {
                                buf.push_back(sample);
                            }
                        }
                    }
                }
            },
            move |err| {
                tracing::error!("Audio output error: {}", err);
            },
            None,
        ).map_err(|e| format!("Failed to build output stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start stream: {}", e))?;

        self.device = Some(device);
        self.stream = Some(stream);

        Ok(())
    }

    /// Push samples to the playback buffer
    pub fn push_samples(&self, samples: &[f32]) {
        let mut buf = self.buffer.lock();
        for &sample in samples {
            buf.push_back(sample);
        }
    }

    /// Stop playback
    pub fn stop(self) {
        drop(self.stream);
    }

    /// Get the buffer for direct access
    pub fn get_buffer(&self) -> Arc<Mutex<VecDeque<f32>>> {
        self.buffer.clone()
    }
}

impl Default for AudioPlayback {
    fn default() -> Self {
        Self::new().expect("Failed to create AudioPlayback")
    }
}
