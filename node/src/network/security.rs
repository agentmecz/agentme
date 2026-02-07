//! P2P network security module.
//!
//! Provides protection against common P2P attacks:
//! - Sybil attack protection via subnet-level connection limits
//! - Eclipse attack mitigation via bootstrap peer diversity requirements
//! - Connection rate limiting with exponential backoff
//! - Max connection enforcement

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use crate::config::NetworkConfig;
use crate::error::{Error, Result};

/// Maximum peers allowed from the same /24 subnet (Sybil protection).
pub const MAX_PEERS_PER_SUBNET_24: usize = 5;

/// Maximum peers allowed from the same /16 subnet (stricter Sybil protection).
pub const MAX_PEERS_PER_SUBNET_16: usize = 3;

/// Minimum required bootstrap peers for eclipse attack protection.
pub const MIN_BOOTSTRAP_PEERS: usize = 3;

/// Default maximum new connections per minute (global rate limit).
pub const DEFAULT_MAX_CONNECTIONS_PER_MINUTE: usize = 10;

/// Default idle connection timeout in seconds.
pub const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 300;

/// Tracks connections per /24 subnet for Sybil attack protection.
#[derive(Debug, Default)]
pub struct SubnetTracker {
    /// Map from /24 subnet prefix (first 3 octets) to connection count.
    connections: HashMap<[u8; 3], usize>,
    /// Maximum connections allowed per /24 subnet.
    max_per_subnet: usize,
}

impl SubnetTracker {
    /// Create a new subnet tracker with default limits.
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            max_per_subnet: MAX_PEERS_PER_SUBNET_24,
        }
    }

    /// Create a new subnet tracker with custom limit.
    pub fn with_limit(max_per_subnet: usize) -> Self {
        Self {
            connections: HashMap::new(),
            max_per_subnet,
        }
    }

    /// Extract /24 subnet prefix from an IP address.
    pub fn extract_subnet_24(ip: &IpAddr) -> Option<[u8; 3]> {
        match ip {
            IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();
                Some([octets[0], octets[1], octets[2]])
            }
            IpAddr::V6(_) => {
                // For IPv6, we could use the first 48 bits, but for simplicity
                // we'll return None and not apply subnet limits to IPv6.
                // In production, you'd want proper IPv6 prefix handling.
                None
            }
        }
    }

    /// Extract /16 subnet prefix from an IP address (for bootstrap diversity).
    pub fn extract_subnet_16(ip: &IpAddr) -> Option<[u8; 2]> {
        match ip {
            IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();
                Some([octets[0], octets[1]])
            }
            IpAddr::V6(_) => None,
        }
    }

    /// Check if a new connection from this IP is allowed.
    pub fn can_accept_connection(&self, ip: &IpAddr) -> bool {
        if let Some(subnet) = Self::extract_subnet_24(ip) {
            let current = self.connections.get(&subnet).copied().unwrap_or(0);
            current < self.max_per_subnet
        } else {
            // Allow IPv6 connections without subnet limits for now
            true
        }
    }

    /// Record a new connection from an IP address.
    ///
    /// Returns `Ok(())` if the connection is allowed, `Err` if subnet limit exceeded.
    pub fn add_connection(&mut self, ip: &IpAddr) -> Result<()> {
        if let Some(subnet) = Self::extract_subnet_24(ip) {
            let current = self.connections.entry(subnet).or_insert(0);
            if *current >= self.max_per_subnet {
                return Err(Error::Network(format!(
                    "Subnet limit exceeded: max {} connections from /24 subnet {:?}",
                    self.max_per_subnet, subnet
                )));
            }
            *current += 1;
        }
        Ok(())
    }

    /// Remove a connection from an IP address.
    pub fn remove_connection(&mut self, ip: &IpAddr) {
        if let Some(subnet) = Self::extract_subnet_24(ip) {
            if let Some(count) = self.connections.get_mut(&subnet) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    self.connections.remove(&subnet);
                }
            }
        }
    }

    /// Get the current connection count for a subnet.
    pub fn connection_count(&self, ip: &IpAddr) -> usize {
        if let Some(subnet) = Self::extract_subnet_24(ip) {
            self.connections.get(&subnet).copied().unwrap_or(0)
        } else {
            0
        }
    }

    /// Get total tracked connections across all subnets.
    pub fn total_connections(&self) -> usize {
        self.connections.values().sum()
    }
}

/// Tracks connections per /16 subnet for stricter Sybil attack protection.
///
/// A /16 subnet includes the first two octets (e.g., 192.168.x.x).
/// This provides stronger protection against attackers who control
/// multiple IPs within a larger network range.
#[derive(Debug, Default)]
pub struct Subnet16Tracker {
    /// Map from /16 subnet prefix (first 2 octets) to connection count.
    connections: HashMap<[u8; 2], usize>,
    /// Maximum connections allowed per /16 subnet.
    max_per_subnet: usize,
}

impl Subnet16Tracker {
    /// Create a new /16 subnet tracker with default limits (3 per subnet).
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            max_per_subnet: MAX_PEERS_PER_SUBNET_16,
        }
    }

    /// Create a new /16 subnet tracker with custom limit.
    pub fn with_limit(max_per_subnet: usize) -> Self {
        Self {
            connections: HashMap::new(),
            max_per_subnet,
        }
    }

    /// Check if a new connection from this IP is allowed.
    pub fn can_accept_connection(&self, ip: &IpAddr) -> bool {
        if let Some(subnet) = SubnetTracker::extract_subnet_16(ip) {
            let current = self.connections.get(&subnet).copied().unwrap_or(0);
            current < self.max_per_subnet
        } else {
            // Allow IPv6 connections without /16 subnet limits for now
            true
        }
    }

    /// Record a new connection from an IP address.
    ///
    /// Returns `Ok(())` if the connection is allowed, `Err` if /16 subnet limit exceeded.
    pub fn add_connection(&mut self, ip: &IpAddr) -> Result<()> {
        if let Some(subnet) = SubnetTracker::extract_subnet_16(ip) {
            let current = self.connections.entry(subnet).or_insert(0);
            if *current >= self.max_per_subnet {
                return Err(Error::Network(format!(
                    "/16 subnet limit exceeded: max {} connections from subnet {}.{}.*.*",
                    self.max_per_subnet, subnet[0], subnet[1]
                )));
            }
            *current += 1;
        }
        Ok(())
    }

    /// Remove a connection from an IP address.
    pub fn remove_connection(&mut self, ip: &IpAddr) {
        if let Some(subnet) = SubnetTracker::extract_subnet_16(ip) {
            if let Some(count) = self.connections.get_mut(&subnet) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    self.connections.remove(&subnet);
                }
            }
        }
    }

    /// Get the current connection count for a /16 subnet.
    pub fn connection_count(&self, ip: &IpAddr) -> usize {
        if let Some(subnet) = SubnetTracker::extract_subnet_16(ip) {
            self.connections.get(&subnet).copied().unwrap_or(0)
        } else {
            0
        }
    }

    /// Get total tracked connections across all /16 subnets.
    pub fn total_connections(&self) -> usize {
        self.connections.values().sum()
    }
}

/// Connection rate limiter with exponential backoff.
#[derive(Debug)]
pub struct ConnectionRateLimiter {
    /// Map from IP to (last_attempt, failure_count).
    attempts: HashMap<IpAddr, (Instant, u32)>,
    /// Base delay between connection attempts.
    base_delay: Duration,
    /// Maximum delay (cap for exponential backoff).
    max_delay: Duration,
    /// Maximum failure count before permanent block for this session.
    max_failures: u32,
}

impl Default for ConnectionRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionRateLimiter {
    /// Create a new rate limiter with default settings.
    pub fn new() -> Self {
        Self {
            attempts: HashMap::new(),
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(300), // 5 minutes max
            max_failures: 10,
        }
    }

    /// Create a rate limiter with custom settings.
    pub fn with_config(base_delay: Duration, max_delay: Duration, max_failures: u32) -> Self {
        Self {
            attempts: HashMap::new(),
            base_delay,
            max_delay,
            max_failures,
        }
    }

    /// Check if a connection attempt is allowed from this IP.
    pub fn can_attempt(&self, ip: &IpAddr) -> bool {
        if let Some((last_attempt, failures)) = self.attempts.get(ip) {
            if *failures >= self.max_failures {
                return false;
            }
            let required_delay = self.calculate_delay(*failures);
            last_attempt.elapsed() >= required_delay
        } else {
            true
        }
    }

    /// Calculate delay based on failure count (exponential backoff).
    fn calculate_delay(&self, failures: u32) -> Duration {
        if failures == 0 {
            return Duration::ZERO;
        }
        let multiplier = 2u64.saturating_pow(failures - 1);
        let delay = self.base_delay.saturating_mul(multiplier as u32);
        std::cmp::min(delay, self.max_delay)
    }

    /// Get the delay until next allowed attempt.
    pub fn time_until_allowed(&self, ip: &IpAddr) -> Duration {
        if let Some((last_attempt, failures)) = self.attempts.get(ip) {
            if *failures >= self.max_failures {
                return Duration::MAX;
            }
            let required_delay = self.calculate_delay(*failures);
            let elapsed = last_attempt.elapsed();
            if elapsed >= required_delay {
                Duration::ZERO
            } else {
                required_delay - elapsed
            }
        } else {
            Duration::ZERO
        }
    }

    /// Record a connection attempt from an IP.
    pub fn record_attempt(&mut self, ip: IpAddr) {
        let entry = self.attempts.entry(ip).or_insert((Instant::now(), 0));
        entry.0 = Instant::now();
    }

    /// Record a failed connection attempt (increments failure count).
    pub fn record_failure(&mut self, ip: IpAddr) {
        let entry = self.attempts.entry(ip).or_insert((Instant::now(), 0));
        entry.0 = Instant::now();
        entry.1 = entry.1.saturating_add(1);
    }

    /// Record a successful connection (resets failure count).
    pub fn record_success(&mut self, ip: &IpAddr) {
        self.attempts.remove(ip);
    }

    /// Get the failure count for an IP.
    pub fn failure_count(&self, ip: &IpAddr) -> u32 {
        self.attempts.get(ip).map(|(_, f)| *f).unwrap_or(0)
    }

    /// Clean up old entries (call periodically).
    pub fn cleanup(&mut self, max_age: Duration) {
        self.attempts
            .retain(|_, (instant, _)| instant.elapsed() < max_age);
    }
}

/// Global connection rate limiter with sliding window.
///
/// Limits the total number of new connections accepted across all IPs
/// within a time window (default: 1 minute). This prevents connection
/// flood attacks.
#[derive(Debug)]
pub struct GlobalConnectionRateLimiter {
    /// Timestamps of recent connections within the window.
    connection_times: Vec<Instant>,
    /// Maximum connections allowed per window.
    max_per_window: usize,
    /// Time window duration.
    window_duration: Duration,
}

impl GlobalConnectionRateLimiter {
    /// Create a new global rate limiter with specified max connections per minute.
    pub fn new(max_per_minute: usize) -> Self {
        Self {
            connection_times: Vec::new(),
            max_per_window: max_per_minute,
            window_duration: Duration::from_secs(60),
        }
    }

    /// Create a global rate limiter with custom window duration.
    pub fn with_window(max_per_window: usize, window_duration: Duration) -> Self {
        Self {
            connection_times: Vec::new(),
            max_per_window,
            window_duration,
        }
    }

    /// Clean up expired connection timestamps.
    fn cleanup_expired(&mut self) {
        let now = Instant::now();
        self.connection_times
            .retain(|&t| now.duration_since(t) < self.window_duration);
    }

    /// Check if a new connection can be accepted.
    pub fn can_accept_new_connection(&self) -> bool {
        let now = Instant::now();
        let active_count = self
            .connection_times
            .iter()
            .filter(|&&t| now.duration_since(t) < self.window_duration)
            .count();
        active_count < self.max_per_window
    }

    /// Record a new connection. Returns true if accepted, false if rate limited.
    pub fn record_new_connection(&mut self) -> bool {
        self.cleanup_expired();

        if self.connection_times.len() >= self.max_per_window {
            return false;
        }

        self.connection_times.push(Instant::now());
        true
    }

    /// Get the number of connections in the current window.
    pub fn current_count(&self) -> usize {
        let now = Instant::now();
        self.connection_times
            .iter()
            .filter(|&&t| now.duration_since(t) < self.window_duration)
            .count()
    }

    /// Get remaining capacity in the current window.
    pub fn remaining_capacity(&self) -> usize {
        self.max_per_window.saturating_sub(self.current_count())
    }
}

/// Tracks total connections and enforces a hard limit.
///
/// Unlike subnet trackers, this enforces a global maximum regardless
/// of subnet distribution.
#[derive(Debug)]
pub struct ConnectionTracker {
    /// Set of currently connected peer IPs.
    connections: std::collections::HashSet<IpAddr>,
    /// Maximum total connections allowed.
    max_connections: usize,
}

impl ConnectionTracker {
    /// Create a new connection tracker with specified maximum.
    pub fn new(max_connections: usize) -> Self {
        Self {
            connections: std::collections::HashSet::new(),
            max_connections,
        }
    }

    /// Check if a new connection can be accepted.
    pub fn can_accept_connection(&self) -> bool {
        self.connections.len() < self.max_connections
    }

    /// Add a connection. Returns Ok if added, Err if at maximum.
    pub fn add_connection(&mut self, ip: &IpAddr) -> Result<()> {
        // If already connected, this is idempotent
        if self.connections.contains(ip) {
            return Ok(());
        }

        if self.connections.len() >= self.max_connections {
            return Err(Error::Network(format!(
                "Connection limit exceeded: maximum {} connections allowed",
                self.max_connections
            )));
        }

        self.connections.insert(*ip);
        Ok(())
    }

    /// Remove a connection.
    pub fn remove_connection(&mut self, ip: &IpAddr) {
        self.connections.remove(ip);
    }

    /// Check if an IP is currently connected.
    pub fn has_connection(&self, ip: &IpAddr) -> bool {
        self.connections.contains(ip)
    }

    /// Get the current connection count.
    pub fn current_count(&self) -> usize {
        self.connections.len()
    }

    /// Get remaining capacity.
    pub fn remaining_capacity(&self) -> usize {
        self.max_connections.saturating_sub(self.connections.len())
    }
}

/// Validates bootstrap peer configuration for eclipse attack protection.
pub fn validate_bootstrap_peers(peers: &[String]) -> Result<()> {
    // Check minimum count
    if peers.len() < MIN_BOOTSTRAP_PEERS {
        return Err(Error::Config(format!(
            "Minimum {} bootstrap peers required for eclipse attack protection, got {}",
            MIN_BOOTSTRAP_PEERS,
            peers.len()
        )));
    }

    // Extract unique /16 subnets
    let mut subnets_16 = std::collections::HashSet::new();
    for peer in peers {
        if let Some(ip) = extract_ip_from_multiaddr(peer) {
            if let Some(subnet) = SubnetTracker::extract_subnet_16(&ip) {
                subnets_16.insert(subnet);
            }
        }
    }

    // Require diverse subnets
    if subnets_16.len() < MIN_BOOTSTRAP_PEERS {
        return Err(Error::Config(format!(
            "Bootstrap peers must be from at least {} different /16 subnets for eclipse attack protection, got {}",
            MIN_BOOTSTRAP_PEERS,
            subnets_16.len()
        )));
    }

    Ok(())
}

/// Extract IP address from a multiaddr string.
pub fn extract_ip_from_multiaddr(addr: &str) -> Option<IpAddr> {
    // Parse multiaddr format: /ip4/192.168.1.1/tcp/9000/p2p/...
    for part in addr.split('/') {
        if let Ok(ip) = part.parse::<IpAddr>() {
            return Some(ip);
        }
    }
    None
}

/// Extended network configuration with security settings.
#[derive(Debug, Clone)]
pub struct SecurityConfig {
    /// Maximum peers per /24 subnet.
    pub max_peers_per_subnet: usize,
    /// Idle connection timeout.
    pub idle_timeout: Duration,
    /// Enable bootstrap peer validation.
    pub validate_bootstrap_peers: bool,
    /// Rate limiting base delay.
    pub rate_limit_base_delay: Duration,
    /// Rate limiting max delay.
    pub rate_limit_max_delay: Duration,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            max_peers_per_subnet: MAX_PEERS_PER_SUBNET_24,
            idle_timeout: Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS),
            validate_bootstrap_peers: true,
            rate_limit_base_delay: Duration::from_secs(1),
            rate_limit_max_delay: Duration::from_secs(300),
        }
    }
}

/// Validate network configuration with security checks.
pub fn validate_network_config(config: &NetworkConfig) -> Result<()> {
    // Validate bootstrap peers if any are configured
    if !config.bootstrap_peers.is_empty() {
        validate_bootstrap_peers(&config.bootstrap_peers)?;
    }

    // Validate max_connections is reasonable
    if config.max_connections == 0 {
        return Err(Error::Config(
            "max_connections must be greater than 0".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ================================================================
    // Sybil Attack Protection Tests - Subnet Limits
    // ================================================================

    #[test]
    fn test_rejects_too_many_peers_from_same_subnet() {
        // RED: After 5 peers from 192.168.1.0/24, reject new connections
        let mut tracker = SubnetTracker::new();
        let base_ip = "192.168.1.";

        // Add 5 connections from same /24 subnet (should succeed)
        for i in 1..=5 {
            let ip: IpAddr = format!("{}{}", base_ip, i).parse().unwrap();
            assert!(
                tracker.add_connection(&ip).is_ok(),
                "Connection {} should be allowed",
                i
            );
        }

        // 6th connection from same /24 should be rejected
        let ip_6: IpAddr = format!("{}6", base_ip).parse().unwrap();
        let result = tracker.add_connection(&ip_6);
        assert!(
            result.is_err(),
            "6th connection from same /24 subnet should be rejected"
        );

        // Verify error message mentions subnet limit
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("Subnet limit exceeded"),
            "Error should mention subnet limit"
        );
    }

    #[test]
    fn test_allows_connections_from_different_subnets() {
        let mut tracker = SubnetTracker::new();

        // Add max connections from multiple different /24 subnets
        for subnet in 1..=10 {
            for host in 1..=5 {
                let ip: IpAddr = format!("192.168.{}.{}", subnet, host).parse().unwrap();
                assert!(
                    tracker.add_connection(&ip).is_ok(),
                    "Connection from 192.168.{}.{} should be allowed",
                    subnet,
                    host
                );
            }
        }

        // Total should be 50 connections
        assert_eq!(tracker.total_connections(), 50);
    }

    #[test]
    fn test_can_accept_connection_returns_false_at_limit() {
        let mut tracker = SubnetTracker::new();

        // Fill up the subnet
        for i in 1..=5 {
            let peer_ip: IpAddr = format!("10.0.0.{}", i).parse().unwrap();
            tracker.add_connection(&peer_ip).unwrap();
        }

        // Check returns false for same subnet
        let new_ip: IpAddr = "10.0.0.100".parse().unwrap();
        assert!(
            !tracker.can_accept_connection(&new_ip),
            "Should not accept connection when subnet is at limit"
        );

        // But different subnet should be fine
        let different_subnet: IpAddr = "10.0.1.1".parse().unwrap();
        assert!(
            tracker.can_accept_connection(&different_subnet),
            "Should accept connection from different subnet"
        );
    }

    #[test]
    fn test_remove_connection_frees_slot() {
        let mut tracker = SubnetTracker::new();

        // Fill up subnet
        for i in 1..=5 {
            let ip: IpAddr = format!("172.16.0.{}", i).parse().unwrap();
            tracker.add_connection(&ip).unwrap();
        }

        // Remove one connection
        let removed_ip: IpAddr = "172.16.0.3".parse().unwrap();
        tracker.remove_connection(&removed_ip);

        // Now should be able to add another
        let new_ip: IpAddr = "172.16.0.100".parse().unwrap();
        assert!(
            tracker.add_connection(&new_ip).is_ok(),
            "Should allow connection after removing one"
        );
    }

    #[test]
    fn test_extract_subnet_24_correct() {
        let ip: IpAddr = "192.168.100.50".parse().unwrap();
        let subnet = SubnetTracker::extract_subnet_24(&ip);
        assert_eq!(subnet, Some([192, 168, 100]));
    }

    #[test]
    fn test_extract_subnet_16_correct() {
        let ip: IpAddr = "10.20.30.40".parse().unwrap();
        let subnet = SubnetTracker::extract_subnet_16(&ip);
        assert_eq!(subnet, Some([10, 20]));
    }

    // ================================================================
    // Eclipse Attack Mitigation Tests - Bootstrap Peer Diversity
    // ================================================================

    #[test]
    fn test_requires_minimum_bootstrap_peers() {
        // RED: Config with < 3 bootstrap peers should error
        let peers_0: Vec<String> = vec![];
        let result_0 = validate_bootstrap_peers(&peers_0);
        assert!(
            result_0.is_err(),
            "Should require at least 3 bootstrap peers"
        );

        let peers_1 = vec!["/ip4/192.168.1.1/tcp/9000/p2p/12D3KooWTest1".to_string()];
        let result_1 = validate_bootstrap_peers(&peers_1);
        assert!(result_1.is_err(), "1 bootstrap peer should fail");

        let peers_2 = vec![
            "/ip4/192.168.1.1/tcp/9000/p2p/12D3KooWTest1".to_string(),
            "/ip4/10.0.1.1/tcp/9000/p2p/12D3KooWTest2".to_string(),
        ];
        let result_2 = validate_bootstrap_peers(&peers_2);
        assert!(result_2.is_err(), "2 bootstrap peers should fail");

        // Verify error message
        let err = result_2.unwrap_err();
        assert!(
            err.to_string().contains("Minimum") && err.to_string().contains("bootstrap"),
            "Error should mention minimum bootstrap peers requirement"
        );
    }

    #[test]
    fn test_bootstrap_peers_must_be_diverse() {
        // RED: All bootstrap peers from same /16 should error
        let same_subnet_peers = vec![
            "/ip4/192.168.1.1/tcp/9000/p2p/12D3KooWTest1".to_string(),
            "/ip4/192.168.1.2/tcp/9000/p2p/12D3KooWTest2".to_string(),
            "/ip4/192.168.1.3/tcp/9000/p2p/12D3KooWTest3".to_string(),
        ];
        let result = validate_bootstrap_peers(&same_subnet_peers);
        assert!(
            result.is_err(),
            "Bootstrap peers from same /16 subnet should fail"
        );

        // Verify error message mentions diversity
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("/16") && err.to_string().contains("different"),
            "Error should mention /16 subnet diversity requirement"
        );
    }

    #[test]
    fn test_accepts_diverse_bootstrap_peers() {
        // Bootstrap peers from different /16 subnets should pass
        let diverse_peers = vec![
            "/ip4/192.168.1.1/tcp/9000/p2p/12D3KooWTest1".to_string(),
            "/ip4/10.0.1.1/tcp/9000/p2p/12D3KooWTest2".to_string(),
            "/ip4/172.16.1.1/tcp/9000/p2p/12D3KooWTest3".to_string(),
        ];
        let result = validate_bootstrap_peers(&diverse_peers);
        assert!(
            result.is_ok(),
            "Diverse bootstrap peers should be accepted: {:?}",
            result
        );
    }

    #[test]
    fn test_bootstrap_peers_partially_diverse_fails() {
        // Only 2 unique /16 subnets among 3 peers should fail
        let partial_peers = vec![
            "/ip4/192.168.1.1/tcp/9000/p2p/12D3KooWTest1".to_string(),
            "/ip4/192.168.2.1/tcp/9000/p2p/12D3KooWTest2".to_string(), // Same /16 as first
            "/ip4/10.0.1.1/tcp/9000/p2p/12D3KooWTest3".to_string(),
        ];
        let result = validate_bootstrap_peers(&partial_peers);
        assert!(
            result.is_err(),
            "Only 2 unique /16 subnets among 3 peers should fail"
        );
    }

    // ================================================================
    // Connection Rate Limiting Tests
    // ================================================================

    #[test]
    fn test_connection_rate_limiting_allows_first_attempt() {
        let limiter = ConnectionRateLimiter::new();
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        assert!(
            limiter.can_attempt(&ip),
            "First connection attempt should be allowed"
        );
    }

    #[test]
    fn test_connection_rate_limiting_exponential_backoff() {
        let mut limiter = ConnectionRateLimiter::with_config(
            Duration::from_millis(100),
            Duration::from_secs(10),
            10,
        );
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        // First attempt should be immediate
        assert!(limiter.can_attempt(&ip));

        // Record a failure
        limiter.record_failure(ip);

        // After 1 failure, need to wait base_delay (100ms)
        assert!(
            !limiter.can_attempt(&ip),
            "Should not allow immediate retry after failure"
        );

        // After waiting
        std::thread::sleep(Duration::from_millis(150));
        assert!(
            limiter.can_attempt(&ip),
            "Should allow retry after waiting base delay"
        );

        // Record more failures for exponential backoff
        limiter.record_failure(ip);
        assert!(!limiter.can_attempt(&ip));

        // 2nd failure = 200ms delay
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            !limiter.can_attempt(&ip),
            "Should still be blocked during exponential backoff"
        );

        std::thread::sleep(Duration::from_millis(150));
        assert!(
            limiter.can_attempt(&ip),
            "Should allow retry after exponential delay"
        );
    }

    #[test]
    fn test_connection_rate_limiting_success_resets() {
        let mut limiter = ConnectionRateLimiter::new();
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        // Record some failures
        limiter.record_failure(ip);
        limiter.record_failure(ip);
        assert_eq!(limiter.failure_count(&ip), 2);

        // Success should reset
        limiter.record_success(&ip);
        assert_eq!(limiter.failure_count(&ip), 0);
        assert!(limiter.can_attempt(&ip));
    }

    #[test]
    fn test_connection_rate_limiting_max_failures_blocks() {
        let mut limiter = ConnectionRateLimiter::with_config(
            Duration::from_millis(1),
            Duration::from_millis(10),
            3, // Low max for testing
        );
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        // Record max failures
        for _ in 0..3 {
            limiter.record_failure(ip);
        }

        // Should be permanently blocked for this session
        assert!(
            !limiter.can_attempt(&ip),
            "Should be blocked after max failures"
        );

        // Even after waiting
        std::thread::sleep(Duration::from_millis(50));
        assert!(
            !limiter.can_attempt(&ip),
            "Should remain blocked after max failures"
        );
    }

    // ================================================================
    // Max Connections Enforcement Tests
    // ================================================================

    #[test]
    fn test_enforces_max_connections() {
        // RED: After max_connections reached, new connections should be rejected
        // This test validates the configuration validation and tracking

        let config = NetworkConfig {
            listen_addresses: vec!["/ip4/0.0.0.0/tcp/9000".to_string()],
            bootstrap_peers: vec![],
            max_connections: 10,
        };

        // Test that max_connections of 0 is rejected
        let invalid_config = NetworkConfig {
            listen_addresses: vec!["/ip4/0.0.0.0/tcp/9000".to_string()],
            bootstrap_peers: vec![],
            max_connections: 0,
        };

        let result = validate_network_config(&invalid_config);
        assert!(result.is_err(), "max_connections of 0 should be rejected");

        // Valid config should pass
        let result = validate_network_config(&config);
        assert!(
            result.is_ok(),
            "Valid max_connections should pass: {:?}",
            result
        );
    }

    #[test]
    fn test_max_connections_with_subnet_tracker() {
        // Use subnet tracker to enforce a global max
        let max_total = 10;
        let mut tracker = SubnetTracker::new();

        // Add connections from different subnets until we hit max
        for i in 0..max_total {
            let ip: IpAddr = format!("{}.0.0.1", i + 1).parse().unwrap();
            tracker.add_connection(&ip).unwrap();
        }

        assert_eq!(tracker.total_connections(), max_total);
    }

    // ================================================================
    // Idle Connection Timeout Tests
    // ================================================================

    #[test]
    fn test_idle_connection_timeout_config() {
        let config = SecurityConfig::default();
        assert_eq!(
            config.idle_timeout,
            Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS),
            "Default idle timeout should be {} seconds",
            DEFAULT_IDLE_TIMEOUT_SECS
        );
    }

    #[test]
    fn test_custom_idle_timeout() {
        let config = SecurityConfig {
            idle_timeout: Duration::from_secs(60),
            ..Default::default()
        };
        assert_eq!(config.idle_timeout, Duration::from_secs(60));
    }

    // ================================================================
    // IP Extraction Tests
    // ================================================================

    #[test]
    fn test_extract_ip_from_multiaddr() {
        let addr = "/ip4/192.168.1.100/tcp/9000/p2p/12D3KooWTest";
        let ip = extract_ip_from_multiaddr(addr);
        assert_eq!(ip, Some("192.168.1.100".parse().unwrap()));

        let addr_v6 = "/ip6/::1/tcp/9000/p2p/12D3KooWTest";
        let ip_v6 = extract_ip_from_multiaddr(addr_v6);
        assert_eq!(ip_v6, Some("::1".parse().unwrap()));

        let invalid = "/dns4/example.com/tcp/9000";
        let ip_invalid = extract_ip_from_multiaddr(invalid);
        assert_eq!(ip_invalid, None);
    }

    // ================================================================
    // Integration Tests - Full Config Validation
    // ================================================================

    #[test]
    fn test_validate_network_config_empty_bootstrap_ok() {
        // Empty bootstrap peers is OK for local development
        let config = NetworkConfig {
            listen_addresses: vec!["/ip4/0.0.0.0/tcp/9000".to_string()],
            bootstrap_peers: vec![],
            max_connections: 50,
        };

        let result = validate_network_config(&config);
        assert!(
            result.is_ok(),
            "Empty bootstrap peers should be OK: {:?}",
            result
        );
    }

    #[test]
    fn test_validate_network_config_with_diverse_bootstrap() {
        let config = NetworkConfig {
            listen_addresses: vec!["/ip4/0.0.0.0/tcp/9000".to_string()],
            bootstrap_peers: vec![
                "/ip4/192.168.1.1/tcp/9000/p2p/12D3KooWTest1".to_string(),
                "/ip4/10.0.1.1/tcp/9000/p2p/12D3KooWTest2".to_string(),
                "/ip4/172.16.1.1/tcp/9000/p2p/12D3KooWTest3".to_string(),
            ],
            max_connections: 50,
        };

        let result = validate_network_config(&config);
        assert!(
            result.is_ok(),
            "Diverse bootstrap peers should pass: {:?}",
            result
        );
    }

    #[test]
    fn test_validate_network_config_rejects_non_diverse_bootstrap() {
        let config = NetworkConfig {
            listen_addresses: vec!["/ip4/0.0.0.0/tcp/9000".to_string()],
            bootstrap_peers: vec![
                "/ip4/192.168.1.1/tcp/9000/p2p/12D3KooWTest1".to_string(),
                "/ip4/192.168.2.1/tcp/9000/p2p/12D3KooWTest2".to_string(),
                "/ip4/192.168.3.1/tcp/9000/p2p/12D3KooWTest3".to_string(),
            ],
            max_connections: 50,
        };

        let result = validate_network_config(&config);
        assert!(result.is_err(), "Non-diverse bootstrap peers should fail");
    }

    // ================================================================
    // RED PHASE: /16 Subnet Limits for Sybil Attack Protection
    // ================================================================

    #[test]
    fn test_subnet16_rejects_too_many_peers_from_same_subnet() {
        // RED: After 3 peers from same /16 subnet, reject new connections
        let mut tracker = Subnet16Tracker::new();
        let base_subnet = "192.168.";

        // Add 3 connections from same /16 subnet (should succeed)
        for i in 1..=3 {
            let ip: IpAddr = format!("{}{}.{}", base_subnet, i, i).parse().unwrap();
            assert!(
                tracker.add_connection(&ip).is_ok(),
                "Connection {} should be allowed from /16 subnet",
                i
            );
        }

        // 4th connection from same /16 should be rejected
        let ip_4: IpAddr = format!("{}4.4", base_subnet).parse().unwrap();
        let result = tracker.add_connection(&ip_4);
        assert!(
            result.is_err(),
            "4th connection from same /16 subnet should be rejected"
        );

        // Verify error message mentions /16 subnet limit
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("/16") && err.to_string().contains("limit"),
            "Error should mention /16 subnet limit: {}",
            err
        );
    }

    #[test]
    fn test_subnet16_allows_connections_from_different_subnets() {
        let mut tracker = Subnet16Tracker::new();

        // Add max connections from multiple different /16 subnets
        for subnet in 1..=10 {
            for host in 1..=3 {
                let ip: IpAddr = format!("{}.{}.1.1", subnet, host).parse().unwrap();
                assert!(
                    tracker.add_connection(&ip).is_ok(),
                    "Connection from {}.{}.1.1 should be allowed",
                    subnet,
                    host
                );
            }
        }

        // Total should be 30 connections (10 subnets * 3 each)
        assert_eq!(tracker.total_connections(), 30);
    }

    #[test]
    fn test_subnet16_can_accept_returns_false_at_limit() {
        let mut tracker = Subnet16Tracker::new();

        // Fill up the /16 subnet with 3 peers
        for i in 1..=3 {
            let peer_ip: IpAddr = format!("10.20.{}.1", i).parse().unwrap();
            tracker.add_connection(&peer_ip).unwrap();
        }

        // Check returns false for same /16 subnet
        let new_ip: IpAddr = "10.20.100.1".parse().unwrap();
        assert!(
            !tracker.can_accept_connection(&new_ip),
            "Should not accept connection when /16 subnet is at limit"
        );

        // But different /16 subnet should be fine
        let different_subnet: IpAddr = "10.21.1.1".parse().unwrap();
        assert!(
            tracker.can_accept_connection(&different_subnet),
            "Should accept connection from different /16 subnet"
        );
    }

    #[test]
    fn test_subnet16_remove_connection_frees_slot() {
        let mut tracker = Subnet16Tracker::new();

        // Fill up /16 subnet with 3 peers
        for i in 1..=3 {
            let ip: IpAddr = format!("172.16.{}.1", i).parse().unwrap();
            tracker.add_connection(&ip).unwrap();
        }

        // Remove one connection
        let removed_ip: IpAddr = "172.16.2.1".parse().unwrap();
        tracker.remove_connection(&removed_ip);

        // Now should be able to add another
        let new_ip: IpAddr = "172.16.100.1".parse().unwrap();
        assert!(
            tracker.add_connection(&new_ip).is_ok(),
            "Should allow connection after removing one from /16 subnet"
        );
    }

    #[test]
    fn test_subnet16_with_custom_limit() {
        // Allow custom limit (e.g., 5 peers per /16)
        let mut tracker = Subnet16Tracker::with_limit(5);

        for i in 1..=5 {
            let ip: IpAddr = format!("10.0.{}.1", i).parse().unwrap();
            assert!(tracker.add_connection(&ip).is_ok());
        }

        // 6th should fail
        let ip_6: IpAddr = "10.0.100.1".parse().unwrap();
        assert!(tracker.add_connection(&ip_6).is_err());
    }

    // ================================================================
    // RED PHASE: Global Connection Rate Limiting (per minute)
    // ================================================================

    #[test]
    fn test_global_rate_limiter_allows_initial_connections() {
        let limiter = GlobalConnectionRateLimiter::new(10); // 10 per minute

        // First connection should be allowed
        assert!(
            limiter.can_accept_new_connection(),
            "Should allow first connection"
        );
    }

    #[test]
    fn test_global_rate_limiter_enforces_per_minute_limit() {
        let mut limiter = GlobalConnectionRateLimiter::new(3); // 3 per minute for testing

        // First 3 should succeed
        for i in 1..=3 {
            assert!(
                limiter.record_new_connection(),
                "Connection {} should be allowed",
                i
            );
        }

        // 4th should be rejected (exceeds per-minute limit)
        assert!(
            !limiter.record_new_connection(),
            "4th connection should be rejected (per-minute limit)"
        );
    }

    #[test]
    fn test_global_rate_limiter_resets_after_window() {
        let mut limiter = GlobalConnectionRateLimiter::with_window(
            3,                          // 3 per window
            Duration::from_millis(100), // 100ms window for testing
        );

        // Use up the limit
        for _ in 0..3 {
            assert!(limiter.record_new_connection());
        }
        assert!(!limiter.record_new_connection());

        // Wait for window to reset
        std::thread::sleep(Duration::from_millis(150));

        // Should be allowed again
        assert!(
            limiter.record_new_connection(),
            "Should allow connection after window reset"
        );
    }

    #[test]
    fn test_global_rate_limiter_sliding_window() {
        // Tests that the limiter uses a sliding window, not fixed buckets
        let mut limiter = GlobalConnectionRateLimiter::with_window(3, Duration::from_millis(100));

        // Record 2 connections
        assert!(limiter.record_new_connection());
        assert!(limiter.record_new_connection());

        // Wait half the window
        std::thread::sleep(Duration::from_millis(60));

        // Record 1 more (total 3, should work)
        assert!(limiter.record_new_connection());

        // 4th should fail
        assert!(!limiter.record_new_connection());

        // Wait for first 2 to expire
        std::thread::sleep(Duration::from_millis(60));

        // Now should be able to add 2 more (the one from 60ms ago still counts)
        assert!(limiter.record_new_connection());
        assert!(limiter.record_new_connection());
        assert!(!limiter.record_new_connection());
    }

    // ================================================================
    // RED PHASE: Total Connection Enforcement
    // ================================================================

    #[test]
    fn test_connection_tracker_enforces_max_total() {
        let mut tracker = ConnectionTracker::new(5); // max 5 total

        // Add 5 connections
        for i in 1..=5 {
            let ip: IpAddr = format!("{}.0.0.1", i).parse().unwrap();
            assert!(
                tracker.add_connection(&ip).is_ok(),
                "Connection {} should be allowed",
                i
            );
        }

        // 6th should be rejected
        let ip_6: IpAddr = "6.0.0.1".parse().unwrap();
        let result = tracker.add_connection(&ip_6);
        assert!(
            result.is_err(),
            "6th connection should be rejected (max total)"
        );

        // Verify error message
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("maximum") || err.to_string().contains("limit"),
            "Error should mention max connections: {}",
            err
        );
    }

    #[test]
    fn test_connection_tracker_remove_allows_new() {
        let mut tracker = ConnectionTracker::new(3);

        // Fill up
        for i in 1..=3 {
            let ip: IpAddr = format!("{}.0.0.1", i).parse().unwrap();
            tracker.add_connection(&ip).unwrap();
        }

        assert_eq!(tracker.current_count(), 3);

        // Remove one
        let removed_ip: IpAddr = "2.0.0.1".parse().unwrap();
        tracker.remove_connection(&removed_ip);

        assert_eq!(tracker.current_count(), 2);

        // Now can add another
        let new_ip: IpAddr = "4.0.0.1".parse().unwrap();
        assert!(
            tracker.add_connection(&new_ip).is_ok(),
            "Should allow new connection after removal"
        );
    }

    #[test]
    fn test_connection_tracker_tracks_peer_ips() {
        let mut tracker = ConnectionTracker::new(10);

        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        tracker.add_connection(&ip).unwrap();

        assert!(
            tracker.has_connection(&ip),
            "Should track connected peer IP"
        );

        let other_ip: IpAddr = "5.6.7.8".parse().unwrap();
        assert!(
            !tracker.has_connection(&other_ip),
            "Should not have unconnected IP"
        );
    }

    #[test]
    fn test_connection_tracker_prevents_duplicate_tracking() {
        let mut tracker = ConnectionTracker::new(10);

        let ip: IpAddr = "1.2.3.4".parse().unwrap();
        tracker.add_connection(&ip).unwrap();

        // Adding same IP again should not increase count
        // (it's the same connection, not a new one)
        let _result = tracker.add_connection(&ip);

        // Could either succeed (idempotent) or fail (duplicate)
        // Either way, count should be 1
        assert_eq!(
            tracker.current_count(),
            1,
            "Should not double-count same IP"
        );
    }
}
