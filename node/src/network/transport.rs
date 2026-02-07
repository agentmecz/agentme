//! libp2p transport configuration.
//!
//! Configures the transport stack with:
//! - TCP with Noise encryption and Yamux multiplexing
//! - QUIC transport (when available)
//! - DNS resolution layer

use libp2p::{
    core::{muxing::StreamMuxerBox, transport::Boxed, upgrade},
    identity::Keypair,
    noise, tcp, yamux, PeerId, Transport,
};
use std::time::Duration;

/// Boxed transport type used by the swarm.
pub type BoxedTransport = Boxed<(PeerId, StreamMuxerBox)>;

/// Connection timeout for TCP connections.
const TCP_TIMEOUT: Duration = Duration::from_secs(30);

/// Build the libp2p transport stack.
///
/// Creates a TCP transport with:
/// - Noise protocol for encryption
/// - Yamux for multiplexing
///
/// # Arguments
///
/// * `keypair` - The node's identity keypair for Noise handshake
///
/// # Returns
///
/// A boxed transport ready for use with the swarm.
///
/// # Errors
///
/// Returns an error if transport creation fails.
pub fn build_transport(keypair: &Keypair) -> std::io::Result<BoxedTransport> {
    // Build TCP transport with system DNS resolution
    let tcp_config = tcp::Config::default().nodelay(true);
    let tcp_transport = tcp::tokio::Transport::new(tcp_config);

    // Configure Noise for authenticated encryption
    let noise_config = noise::Config::new(keypair).map_err(std::io::Error::other)?;

    // Configure Yamux for stream multiplexing
    let yamux_config = yamux::Config::default();

    // Build the full transport stack
    let transport = tcp_transport
        .upgrade(upgrade::Version::V1Lazy)
        .authenticate(noise_config)
        .multiplex(yamux_config)
        .timeout(TCP_TIMEOUT)
        .boxed();

    Ok(transport)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_transport() {
        let keypair = Keypair::generate_ed25519();
        let transport = build_transport(&keypair);
        assert!(transport.is_ok());
    }
}
