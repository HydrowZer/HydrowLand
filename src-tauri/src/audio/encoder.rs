#![allow(dead_code)]

use opus::{Application, Channels, Decoder, Encoder};

use super::{OPUS_BITRATE, SAMPLES_PER_FRAME, SAMPLE_RATE};

/// Opus encoder for voice compression
pub struct OpusEncoder {
    encoder: Encoder,
}

impl OpusEncoder {
    pub fn new() -> Result<Self, String> {
        let mut encoder = Encoder::new(
            SAMPLE_RATE,
            Channels::Mono,
            Application::Voip, // Optimized for voice
        )
        .map_err(|e| format!("Failed to create Opus encoder: {}", e))?;

        // Set bitrate (64kbps is good for voice)
        encoder
            .set_bitrate(opus::Bitrate::Bits(OPUS_BITRATE))
            .map_err(|e| format!("Failed to set bitrate: {}", e))?;

        // Enable Forward Error Correction for packet loss resilience
        encoder
            .set_inband_fec(true)
            .map_err(|e| format!("Failed to enable FEC: {}", e))?;

        // Set expected packet loss percentage for FEC tuning
        encoder
            .set_packet_loss_perc(10)
            .map_err(|e| format!("Failed to set packet loss percentage: {}", e))?;

        Ok(Self { encoder })
    }

    /// Encode f32 samples to Opus bytes
    /// Input must be SAMPLES_PER_FRAME samples (960 for 20ms @ 48kHz)
    pub fn encode(&mut self, samples: &[f32]) -> Result<Vec<u8>, String> {
        if samples.len() != SAMPLES_PER_FRAME {
            return Err(format!(
                "Expected {} samples, got {}",
                SAMPLES_PER_FRAME,
                samples.len()
            ));
        }

        // Opus needs max output buffer (encoded voice is usually ~64-128 bytes)
        let mut output = vec![0u8; 256];

        let len = self
            .encoder
            .encode_float(samples, &mut output)
            .map_err(|e| format!("Encoding failed: {}", e))?;

        output.truncate(len);
        Ok(output)
    }
}

/// Opus decoder for voice decompression
pub struct OpusDecoder {
    decoder: Decoder,
}

impl OpusDecoder {
    pub fn new() -> Result<Self, String> {
        let decoder = Decoder::new(SAMPLE_RATE, Channels::Mono)
            .map_err(|e| format!("Failed to create Opus decoder: {}", e))?;

        Ok(Self { decoder })
    }

    /// Decode Opus bytes to f32 samples
    /// Returns SAMPLES_PER_FRAME samples
    pub fn decode(&mut self, data: &[u8]) -> Result<Vec<f32>, String> {
        let mut output = vec![0.0f32; SAMPLES_PER_FRAME];

        let _len = self
            .decoder
            .decode_float(data, &mut output, false)
            .map_err(|e| format!("Decoding failed: {}", e))?;

        Ok(output)
    }

    /// Decode with packet loss concealment (when packet is lost)
    pub fn decode_lost(&mut self) -> Result<Vec<f32>, String> {
        let mut output = vec![0.0f32; SAMPLES_PER_FRAME];

        // Pass empty data to trigger PLC
        let _len = self
            .decoder
            .decode_float(&[], &mut output, true) // fec=true for PLC
            .map_err(|e| format!("PLC decoding failed: {}", e))?;

        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_decode_roundtrip() {
        let mut encoder = OpusEncoder::new().unwrap();
        let mut decoder = OpusDecoder::new().unwrap();

        // Generate a simple sine wave
        let samples: Vec<f32> = (0..SAMPLES_PER_FRAME)
            .map(|i| (i as f32 * 0.1).sin() * 0.5)
            .collect();

        // Encode
        let encoded = encoder.encode(&samples).unwrap();
        assert!(!encoded.is_empty());
        assert!(encoded.len() < samples.len() * 4); // Should compress well

        // Decode
        let decoded = decoder.decode(&encoded).unwrap();
        assert_eq!(decoded.len(), SAMPLES_PER_FRAME);

        // Lossy codec - just check it's in reasonable range
        for sample in &decoded {
            assert!(sample.abs() <= 1.0);
        }
    }
}
