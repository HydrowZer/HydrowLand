#![allow(dead_code)]

//! WebRTC video track for screen sharing

use std::sync::Arc;
use parking_lot::Mutex;
use webrtc::api::media_engine::MediaEngine;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType};
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocalWriter;
use webrtc::rtp::packet::Packet as RtpPacket;

/// VP8 payload type (dynamic, typically 96)
pub const VP8_PAYLOAD_TYPE: u8 = 96;

/// RTP clock rate for VP8 is 90000 Hz
pub const VP8_CLOCK_RATE: u32 = 90000;

/// Video track for sending screen share via WebRTC
pub struct LocalVideoTrack {
    track: Arc<TrackLocalStaticRTP>,
    sequence_number: Mutex<u16>,
    timestamp: Mutex<u32>,
    ssrc: u32,
    frame_duration: u32, // in clock ticks (90000 Hz)
}

impl LocalVideoTrack {
    /// Create a new local video track
    /// fps: target frames per second (e.g., 15)
    pub fn new(track_id: &str, stream_id: &str, fps: u32) -> Result<Self, String> {
        let track = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: "video/VP8".to_owned(),
                clock_rate: VP8_CLOCK_RATE,
                channels: 0,
                sdp_fmtp_line: "".to_owned(),
                rtcp_feedback: vec![],
            },
            track_id.to_string(),
            stream_id.to_string(),
        ));

        // Generate random SSRC
        let ssrc = rand::random::<u32>();

        // Calculate frame duration in RTP clock ticks
        // At 90000 Hz and 15 fps: 90000 / 15 = 6000 ticks per frame
        let frame_duration = VP8_CLOCK_RATE / fps.max(1);

        Ok(Self {
            track,
            sequence_number: Mutex::new(0),
            timestamp: Mutex::new(rand::random::<u32>()),
            ssrc,
            frame_duration,
        })
    }

    /// Get the underlying track for adding to peer connection
    pub fn track(&self) -> Arc<TrackLocalStaticRTP> {
        self.track.clone()
    }

    /// Send encoded VP8 video frame
    /// For large frames, this handles fragmentation into multiple RTP packets
    pub async fn send_frame(&self, vp8_data: &[u8], is_keyframe: bool) -> Result<(), String> {
        if vp8_data.is_empty() {
            return Ok(());
        }

        // VP8 RTP payload max size (leave room for VP8 payload descriptor)
        const MAX_PAYLOAD_SIZE: usize = 1200;

        let chunks: Vec<&[u8]> = vp8_data.chunks(MAX_PAYLOAD_SIZE).collect();
        let num_chunks = chunks.len();

        for (i, chunk) in chunks.iter().enumerate() {
            let is_first = i == 0;
            let is_last = i == num_chunks - 1;

            // Build VP8 payload with descriptor
            let payload = Self::build_vp8_payload(chunk, is_first, is_keyframe);

            let packet = {
                let mut seq = self.sequence_number.lock();
                let ts = self.timestamp.lock();

                let packet = RtpPacket {
                    header: webrtc::rtp::header::Header {
                        version: 2,
                        padding: false,
                        extension: false,
                        marker: is_last, // Marker bit indicates end of frame
                        payload_type: VP8_PAYLOAD_TYPE,
                        sequence_number: *seq,
                        timestamp: *ts,
                        ssrc: self.ssrc,
                        ..Default::default()
                    },
                    payload: bytes::Bytes::from(payload),
                };

                *seq = seq.wrapping_add(1);
                packet
            };

            self.track
                .write_rtp(&packet)
                .await
                .map_err(|e| format!("Failed to write RTP video packet: {}", e))?;
        }

        // Increment timestamp for next frame
        {
            let mut ts = self.timestamp.lock();
            *ts = ts.wrapping_add(self.frame_duration);
        }

        Ok(())
    }

    /// Build VP8 RTP payload descriptor + data
    /// See RFC 7741 for VP8 RTP payload format
    fn build_vp8_payload(data: &[u8], is_start: bool, _is_keyframe: bool) -> Vec<u8> {
        // Simple VP8 payload descriptor (1 byte)
        // X: 0 (no extensions)
        // R: 0 (reserved)
        // N: 0 (no non-reference frame)
        // S: 1 if start of partition
        // PID: 0 (partition ID)
        let mut descriptor: u8 = 0;
        if is_start {
            descriptor |= 0x10; // S bit (start of partition)
        }

        // For keyframes, we don't set any special bits in the simple descriptor
        // The keyframe indication is in the VP8 bitstream itself

        let mut payload = Vec::with_capacity(1 + data.len());
        payload.push(descriptor);
        payload.extend_from_slice(data);
        payload
    }

    /// Get current timestamp (for synchronization)
    pub fn current_timestamp(&self) -> u32 {
        *self.timestamp.lock()
    }
}

/// Configure MediaEngine with VP8 codec for video
pub fn register_video_codec(m: &mut MediaEngine) -> Result<(), String> {
    m.register_codec(
        RTCRtpCodecParameters {
            capability: RTCRtpCodecCapability {
                mime_type: "video/VP8".to_owned(),
                clock_rate: VP8_CLOCK_RATE,
                channels: 0,
                sdp_fmtp_line: "".to_owned(),
                rtcp_feedback: vec![],
            },
            payload_type: VP8_PAYLOAD_TYPE,
            ..Default::default()
        },
        RTPCodecType::Video,
    )
    .map_err(|e| format!("Failed to register VP8 codec: {}", e))?;

    Ok(())
}
