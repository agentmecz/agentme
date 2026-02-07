//! Plugin Service trait and types
//!
//! Services are external system integrations that run as background processes.

use super::error::PluginResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::watch;

/// Service status
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServiceStatus {
    /// Service is stopped
    #[default]
    Stopped,
    /// Service is starting
    Starting,
    /// Service is running
    Running,
    /// Service is stopping
    Stopping,
    /// Service encountered an error
    Error,
}

/// Service metadata for discovery and documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceMetadata {
    /// Unique service name (e.g., "discord_bot", "telegram_bot")
    pub name: String,
    /// Human-readable description
    pub description: String,
    /// Service type (e.g., "bot", "webhook", "scheduler")
    pub service_type: String,
    /// Whether the service should auto-start
    pub auto_start: bool,
    /// Tags for categorization
    pub tags: Vec<String>,
}

impl Default for ServiceMetadata {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: String::new(),
            service_type: "generic".to_string(),
            auto_start: false,
            tags: Vec::new(),
        }
    }
}

/// Context for service operations
#[derive(Debug, Clone, Default)]
pub struct ServiceContext {
    /// Agent DID that owns this service
    pub agent_did: String,
    /// Service configuration
    pub config: HashMap<String, serde_json::Value>,
    /// Shutdown signal receiver
    shutdown_rx: Option<watch::Receiver<bool>>,
}

impl ServiceContext {
    /// Create a new service context
    pub fn new(agent_did: impl Into<String>) -> Self {
        Self {
            agent_did: agent_did.into(),
            ..Default::default()
        }
    }

    /// Add configuration
    pub fn with_config(
        mut self,
        key: impl Into<String>,
        value: impl Into<serde_json::Value>,
    ) -> Self {
        self.config.insert(key.into(), value.into());
        self
    }

    /// Add shutdown signal
    pub fn with_shutdown_signal(mut self, rx: watch::Receiver<bool>) -> Self {
        self.shutdown_rx = Some(rx);
        self
    }

    /// Check if shutdown was requested
    pub fn is_shutdown_requested(&self) -> bool {
        self.shutdown_rx
            .as_ref()
            .map(|rx| *rx.borrow())
            .unwrap_or(false)
    }

    /// Wait for shutdown signal
    pub async fn wait_for_shutdown(&mut self) {
        if let Some(ref mut rx) = self.shutdown_rx {
            while !*rx.borrow() {
                let _ = rx.changed().await;
            }
        }
    }
}

/// Service health information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealth {
    /// Current status
    pub status: ServiceStatus,
    /// Uptime in seconds (if running)
    pub uptime_seconds: Option<u64>,
    /// Last error message
    pub last_error: Option<String>,
    /// Additional metrics
    pub metrics: HashMap<String, serde_json::Value>,
}

/// The Service trait
///
/// Services are long-running processes that integrate with external systems.
/// They run in the background and can be started/stopped.
///
/// # Example
///
/// ```rust,ignore
/// struct DiscordBotService {
///     token: String,
///     status: ServiceStatus,
/// }
///
/// #[async_trait]
/// impl Service for DiscordBotService {
///     fn metadata(&self) -> ServiceMetadata {
///         ServiceMetadata {
///             name: "discord_bot".to_string(),
///             description: "Discord bot integration".to_string(),
///             service_type: "bot".to_string(),
///             auto_start: true,
///             ..Default::default()
///         }
///     }
///
///     fn status(&self) -> ServiceStatus {
///         self.status
///     }
///
///     async fn start(&mut self, ctx: ServiceContext) -> PluginResult<()> {
///         self.status = ServiceStatus::Starting;
///         // Connect to Discord...
///         self.status = ServiceStatus::Running;
///         Ok(())
///     }
///
///     async fn stop(&mut self) -> PluginResult<()> {
///         self.status = ServiceStatus::Stopping;
///         // Disconnect from Discord...
///         self.status = ServiceStatus::Stopped;
///         Ok(())
///     }
/// }
/// ```
#[async_trait]
pub trait Service: Send + Sync {
    /// Get service metadata
    fn metadata(&self) -> ServiceMetadata;

    /// Get current service status
    fn status(&self) -> ServiceStatus;

    /// Start the service
    ///
    /// This should be non-blocking. Use the context's shutdown signal
    /// to know when to stop.
    async fn start(&mut self, ctx: ServiceContext) -> PluginResult<()>;

    /// Stop the service
    ///
    /// Should gracefully stop any running operations.
    async fn stop(&mut self) -> PluginResult<()>;

    /// Restart the service
    ///
    /// Default implementation stops then starts.
    async fn restart(&mut self, ctx: ServiceContext) -> PluginResult<()> {
        self.stop().await?;
        self.start(ctx).await
    }

    /// Get service health information
    async fn health(&self) -> ServiceHealth {
        ServiceHealth {
            status: self.status(),
            uptime_seconds: None,
            last_error: None,
            metrics: HashMap::new(),
        }
    }
}

/// Managed service wrapper with lifecycle tracking
pub struct ManagedService {
    inner: std::sync::Arc<dyn Service>,
    started_at: tokio::sync::RwLock<Option<std::time::Instant>>,
    shutdown_tx: watch::Sender<bool>,
    /// Receiver for shutdown signal - kept for future use
    #[allow(dead_code)]
    shutdown_rx: watch::Receiver<bool>,
}

impl ManagedService {
    /// Create a new managed service from a service instance
    pub fn new(service: impl Service + 'static) -> Self {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        Self {
            inner: std::sync::Arc::new(service),
            started_at: tokio::sync::RwLock::new(None),
            shutdown_tx,
            shutdown_rx,
        }
    }

    /// Wrap an existing Arc<dyn Service>
    pub fn wrap(service: std::sync::Arc<dyn Service>) -> Self {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        Self {
            inner: service,
            started_at: tokio::sync::RwLock::new(None),
            shutdown_tx,
            shutdown_rx,
        }
    }

    /// Start the service
    /// Note: This is a no-op for now as services should be started by the plugin
    pub async fn start(&self, ctx: ServiceContext) -> PluginResult<()> {
        // Mark as started
        let mut started = self.started_at.write().await;
        *started = Some(std::time::Instant::now());
        let _ = ctx; // Context used by actual service implementation
        Ok(())
    }

    /// Stop the service
    pub async fn stop(&self) -> PluginResult<()> {
        // Send shutdown signal
        let _ = self.shutdown_tx.send(true);

        let mut started = self.started_at.write().await;
        *started = None;

        Ok(())
    }

    /// Get uptime in seconds
    pub async fn uptime_seconds(&self) -> Option<u64> {
        let started = self.started_at.read().await;
        started.map(|s| s.elapsed().as_secs())
    }

    /// Get service status
    pub async fn status(&self) -> ServiceStatus {
        self.inner.status()
    }

    /// Get metadata
    pub async fn metadata(&self) -> ServiceMetadata {
        self.inner.metadata()
    }
}
