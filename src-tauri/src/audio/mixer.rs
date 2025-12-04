#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};

use super::SAMPLES_PER_FRAME;

/// Jitter buffer size in frames (50ms = ~2-3 frames at 20ms/frame)
const JITTER_BUFFER_FRAMES: usize = 3;
const JITTER_BUFFER_SAMPLES: usize = SAMPLES_PER_FRAME * JITTER_BUFFER_FRAMES;

/// Per-peer audio buffer
struct PeerBuffer {
    /// Queue holding decoded samples
    samples: VecDeque<f32>,
    /// Volume multiplier (0.0 - 1.0)
    volume: f32,
    /// Is this peer muted locally?
    muted: bool,
    /// Last activity timestamp (for detecting silence)
    last_activity: std::time::Instant,
}

impl PeerBuffer {
    fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(JITTER_BUFFER_SAMPLES * 2),
            volume: 1.0,
            muted: false,
            last_activity: std::time::Instant::now(),
        }
    }
}

/// Audio mixer that combines audio from multiple peers
pub struct AudioMixer {
    peers: HashMap<String, PeerBuffer>,
    /// Master volume (0.0 - 1.0)
    master_volume: f32,
}

impl AudioMixer {
    pub fn new() -> Self {
        Self {
            peers: HashMap::new(),
            master_volume: 1.0,
        }
    }

    /// Add decoded samples from a peer
    pub fn add_peer_samples(&mut self, peer_id: &str, samples: Vec<f32>) {
        let buffer = self.peers.entry(peer_id.to_string()).or_insert_with(PeerBuffer::new);

        buffer.last_activity = std::time::Instant::now();

        // Push samples to the peer's buffer
        for sample in samples {
            buffer.samples.push_back(sample);
        }

        // Limit buffer size to prevent memory growth
        while buffer.samples.len() > JITTER_BUFFER_SAMPLES * 2 {
            buffer.samples.pop_front();
        }
    }

    /// Get mixed samples for playback
    /// Returns SAMPLES_PER_FRAME samples
    pub fn get_mixed_samples(&mut self) -> Vec<f32> {
        let mut mixed = vec![0.0f32; SAMPLES_PER_FRAME];
        self.mix_into(&mut mixed);
        mixed
    }

    /// Actually mix samples into provided buffer
    pub fn mix_into(&mut self, output: &mut [f32]) {
        output.fill(0.0);

        let peer_count = self.peers.len();
        if peer_count == 0 {
            return;
        }

        // Normalization factor to prevent clipping when many peers
        let norm_factor = if peer_count > 1 {
            1.0 / (peer_count as f32).sqrt()
        } else {
            1.0
        };

        for buffer in self.peers.values_mut() {
            if buffer.muted {
                continue;
            }

            // Check if we have enough samples (jitter buffer)
            if buffer.samples.len() < SAMPLES_PER_FRAME {
                // Not enough samples yet - skip this peer for now
                // This provides jitter buffering
                continue;
            }

            // Mix this peer's samples
            for i in 0..output.len().min(SAMPLES_PER_FRAME) {
                if let Some(sample) = buffer.samples.pop_front() {
                    output[i] += sample * buffer.volume * norm_factor;
                }
            }
        }

        // Apply master volume and clamp
        for sample in output.iter_mut() {
            *sample = (*sample * self.master_volume).clamp(-1.0, 1.0);
        }
    }

    /// Set volume for a specific peer (0.0 - 1.0)
    pub fn set_peer_volume(&mut self, peer_id: &str, volume: f32) {
        if let Some(buffer) = self.peers.get_mut(peer_id) {
            buffer.volume = volume.clamp(0.0, 1.0);
        }
    }

    /// Mute/unmute a specific peer
    pub fn set_peer_muted(&mut self, peer_id: &str, muted: bool) {
        if let Some(buffer) = self.peers.get_mut(peer_id) {
            buffer.muted = muted;
        }
    }

    /// Set master volume (0.0 - 1.0)
    pub fn set_master_volume(&mut self, volume: f32) {
        self.master_volume = volume.clamp(0.0, 1.0);
    }

    /// Get master volume
    pub fn get_master_volume(&self) -> f32 {
        self.master_volume
    }

    /// Remove a peer from the mixer
    pub fn remove_peer(&mut self, peer_id: &str) {
        self.peers.remove(peer_id);
    }

    /// Clear all peers
    pub fn clear(&mut self) {
        self.peers.clear();
    }

    /// Get list of active peers
    pub fn get_peers(&self) -> Vec<String> {
        self.peers.keys().cloned().collect()
    }

    /// Check if a peer has audio data
    pub fn peer_has_audio(&self, peer_id: &str) -> bool {
        self.peers.get(peer_id)
            .map(|b| !b.samples.is_empty())
            .unwrap_or(false)
    }

    /// Get audio level for a peer (0.0 - 1.0) for UI metering
    pub fn get_peer_level(&self, peer_id: &str) -> f32 {
        // Calculate RMS of recent samples
        self.peers.get(peer_id)
            .map(|buffer| {
                if buffer.samples.is_empty() {
                    return 0.0;
                }

                // Calculate RMS from recent samples
                let sample_count = buffer.samples.len().min(SAMPLES_PER_FRAME);
                let sum_squares: f32 = buffer.samples.iter()
                    .take(sample_count)
                    .map(|s| s * s)
                    .sum();
                (sum_squares / sample_count as f32).sqrt()
            })
            .unwrap_or(0.0)
    }
}

impl Default for AudioMixer {
    fn default() -> Self {
        Self::new()
    }
}
