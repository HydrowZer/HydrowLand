//! Video module for screen sharing
//! Handles VP8 encoding and WebRTC video tracks

mod track;
mod encoder;

pub use track::{LocalVideoTrack, VP8_PAYLOAD_TYPE, VP8_CLOCK_RATE};
pub use encoder::{VideoEncoder, VideoFrame, EncoderConfig, EncodedFrame};
