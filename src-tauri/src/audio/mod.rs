mod capture;
mod denoise;
mod encoder;
mod mixer;
mod playback;
mod realtime;
mod streaming;

pub use encoder::{OpusDecoder, OpusEncoder};
pub use realtime::RealtimeCapture;
pub use streaming::{AudioStreamingService, AudioPacket};

#[allow(dead_code)]
pub use capture::AudioCapture;
#[allow(dead_code, unused_imports)]
pub use denoise::{AudioDenoiser, SharedDenoiser};
#[allow(dead_code)]
pub use mixer::AudioMixer;
#[allow(dead_code)]
pub use playback::AudioPlayback;
#[allow(dead_code, unused_imports)]
pub use realtime::AudioLevelEvent;

/// Sample rate for all audio operations (48kHz is Opus native)
pub const SAMPLE_RATE: u32 = 48000;
/// Channels (mono for voice)
pub const CHANNELS: u16 = 1;
/// Frame duration in ms (20ms is optimal for Opus)
pub const FRAME_DURATION_MS: u32 = 20;
/// Samples per frame (48000 * 20 / 1000 = 960)
pub const SAMPLES_PER_FRAME: usize = (SAMPLE_RATE * FRAME_DURATION_MS / 1000) as usize;
/// Opus bitrate (64kbps good for voice)
pub const OPUS_BITRATE: i32 = 64000;

/// Encoded audio packet ready for transmission
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct EncodedAudioPacket {
    pub data: Vec<u8>,
    pub timestamp: u64,
}
