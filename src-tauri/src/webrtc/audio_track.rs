use std::sync::Arc;
use parking_lot::Mutex;
use tokio::sync::mpsc;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_OPUS};
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType};
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocalWriter;
use webrtc::rtp::packet::Packet as RtpPacket;

use crate::audio::CHANNELS;

/// Opus payload type (dynamic, typically 111)
pub const OPUS_PAYLOAD_TYPE: u8 = 111;

/// RTP clock rate for Opus is always 48000
pub const OPUS_CLOCK_RATE: u32 = 48000;

/// Samples per RTP packet (20ms at 48kHz = 960 samples)
pub const SAMPLES_PER_RTP_PACKET: u32 = 960;

/// Audio track for sending local audio via WebRTC
pub struct LocalAudioTrack {
    track: Arc<TrackLocalStaticRTP>,
    sequence_number: Mutex<u16>,
    timestamp: Mutex<u32>,
    ssrc: u32,
}

impl LocalAudioTrack {
    /// Create a new local audio track
    pub fn new(track_id: &str, stream_id: &str) -> Result<Self, String> {
        let track = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_OPUS.to_owned(),
                clock_rate: OPUS_CLOCK_RATE,
                channels: CHANNELS,
                sdp_fmtp_line: "minptime=10;useinbandfec=1".to_owned(),
                rtcp_feedback: vec![],
            },
            track_id.to_string(),
            stream_id.to_string(),
        ));

        // Generate random SSRC
        let ssrc = rand::random::<u32>();

        Ok(Self {
            track,
            sequence_number: Mutex::new(0),
            timestamp: Mutex::new(rand::random::<u32>()),
            ssrc,
        })
    }

    /// Get the underlying track for adding to peer connection
    pub fn track(&self) -> Arc<TrackLocalStaticRTP> {
        self.track.clone()
    }

    /// Send encoded Opus audio data
    /// `opus_data` should be the output from OpusEncoder::encode()
    pub async fn send_audio(&self, opus_data: &[u8]) -> Result<(), String> {
        // Build RTP packet without holding locks across await
        let packet = {
            let mut seq = self.sequence_number.lock();
            let mut ts = self.timestamp.lock();

            let packet = RtpPacket {
                header: webrtc::rtp::header::Header {
                    version: 2,
                    padding: false,
                    extension: false,
                    marker: false, // Opus doesn't use marker bit typically
                    payload_type: OPUS_PAYLOAD_TYPE,
                    sequence_number: *seq,
                    timestamp: *ts,
                    ssrc: self.ssrc,
                    ..Default::default()
                },
                payload: bytes::Bytes::copy_from_slice(opus_data),
            };

            // Increment sequence number and timestamp
            *seq = seq.wrapping_add(1);
            *ts = ts.wrapping_add(SAMPLES_PER_RTP_PACKET);

            packet
        }; // locks released here

        // Send via track (without holding any locks)
        self.track
            .write_rtp(&packet)
            .await
            .map_err(|e| format!("Failed to write RTP packet: {}", e))?;

        Ok(())
    }

    /// Get current timestamp (for synchronization)
    pub fn current_timestamp(&self) -> u32 {
        *self.timestamp.lock()
    }
}

/// Audio track receiver for handling incoming audio from a peer
pub struct RemoteAudioTrack {
    peer_id: String,
    /// Channel to send decoded audio samples to the mixer
    audio_tx: mpsc::UnboundedSender<(String, Vec<u8>)>,
}

impl RemoteAudioTrack {
    pub fn new(peer_id: &str, audio_tx: mpsc::UnboundedSender<(String, Vec<u8>)>) -> Self {
        Self {
            peer_id: peer_id.to_string(),
            audio_tx,
        }
    }

    /// Called when RTP packet is received
    pub fn on_rtp_packet(&self, payload: Vec<u8>) {
        // Send to audio processing (payload is Opus encoded data)
        let _ = self.audio_tx.send((self.peer_id.clone(), payload));
    }
}

/// Configure MediaEngine with Opus codec for audio
pub fn register_audio_codec(m: &mut MediaEngine) -> Result<(), String> {
    // Register Opus codec
    m.register_codec(
        RTCRtpCodecParameters {
            capability: RTCRtpCodecCapability {
                mime_type: MIME_TYPE_OPUS.to_owned(),
                clock_rate: OPUS_CLOCK_RATE,
                channels: CHANNELS,
                sdp_fmtp_line: "minptime=10;useinbandfec=1".to_owned(),
                rtcp_feedback: vec![],
            },
            payload_type: OPUS_PAYLOAD_TYPE,
            ..Default::default()
        },
        RTPCodecType::Audio,
    )
    .map_err(|e| format!("Failed to register Opus codec: {}", e))?;

    Ok(())
}

/// Audio level calculation from samples (for UI metering)
pub fn calculate_audio_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    // Calculate RMS (Root Mean Square)
    let sum_squares: f32 = samples.iter().map(|s| s * s).sum();
    let rms = (sum_squares / samples.len() as f32).sqrt();

    // Convert to dB scale and normalize to 0.0-1.0
    // -60dB to 0dB range
    let db = 20.0 * rms.max(1e-10).log10();
    let normalized = (db + 60.0) / 60.0;
    normalized.clamp(0.0, 1.0)
}

/// Audio level in dB
pub fn calculate_audio_level_db(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return -60.0;
    }

    let sum_squares: f32 = samples.iter().map(|s| s * s).sum();
    let rms = (sum_squares / samples.len() as f32).sqrt();
    20.0 * rms.max(1e-10).log10()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_level_silent() {
        let samples = vec![0.0f32; 960];
        let level = calculate_audio_level(&samples);
        assert!(level < 0.01, "Silent audio should have near-zero level");
    }

    #[test]
    fn test_audio_level_loud() {
        let samples = vec![0.5f32; 960];
        let level = calculate_audio_level(&samples);
        assert!(level > 0.8, "Loud audio should have high level");
    }

    #[test]
    fn test_audio_level_db_silent() {
        let samples = vec![0.0f32; 960];
        let db = calculate_audio_level_db(&samples);
        assert!(db <= -60.0, "Silent audio should be at or below -60dB");
    }
}
