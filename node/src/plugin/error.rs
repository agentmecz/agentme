//! Plugin error types

use std::error::Error;
use std::fmt;

/// Plugin-specific error type
#[derive(Debug)]
pub enum PluginError {
    /// Plugin with this name already registered
    AlreadyRegistered(String),
    /// Plugin not found
    NotFound(String),
    /// Plugin initialization failed
    InitializationFailed { plugin: String, reason: String },
    /// Action execution failed
    ActionFailed { action: String, reason: String },
    /// Provider failed to retrieve data
    ProviderFailed { provider: String, reason: String },
    /// Service operation failed
    ServiceFailed { service: String, reason: String },
    /// Invalid configuration
    InvalidConfig { key: String, reason: String },
    /// Dependency not satisfied
    DependencyNotSatisfied { plugin: String, dependency: String },
    /// Plugin disabled
    Disabled(String),
    /// Timeout during operation
    Timeout { operation: String, duration_ms: u64 },
    /// Serialization/deserialization error
    SerdeError(String),
    /// IO error
    IoError(String),
    /// Generic error
    Other(String),
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PluginError::AlreadyRegistered(name) => {
                write!(f, "Plugin '{}' is already registered", name)
            }
            PluginError::NotFound(name) => write!(f, "Plugin '{}' not found", name),
            PluginError::InitializationFailed { plugin, reason } => {
                write!(f, "Plugin '{}' initialization failed: {}", plugin, reason)
            }
            PluginError::ActionFailed { action, reason } => {
                write!(f, "Action '{}' failed: {}", action, reason)
            }
            PluginError::ProviderFailed { provider, reason } => {
                write!(f, "Provider '{}' failed: {}", provider, reason)
            }
            PluginError::ServiceFailed { service, reason } => {
                write!(f, "Service '{}' failed: {}", service, reason)
            }
            PluginError::InvalidConfig { key, reason } => {
                write!(f, "Invalid config key '{}': {}", key, reason)
            }
            PluginError::DependencyNotSatisfied { plugin, dependency } => {
                write!(
                    f,
                    "Plugin '{}' has unsatisfied dependency: {}",
                    plugin, dependency
                )
            }
            PluginError::Disabled(name) => write!(f, "Plugin '{}' is disabled", name),
            PluginError::Timeout {
                operation,
                duration_ms,
            } => {
                write!(
                    f,
                    "Operation '{}' timed out after {}ms",
                    operation, duration_ms
                )
            }
            PluginError::SerdeError(msg) => write!(f, "Serialization error: {}", msg),
            PluginError::IoError(msg) => write!(f, "IO error: {}", msg),
            PluginError::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl Error for PluginError {}

impl From<serde_json::Error> for PluginError {
    fn from(err: serde_json::Error) -> Self {
        PluginError::SerdeError(err.to_string())
    }
}

impl From<std::io::Error> for PluginError {
    fn from(err: std::io::Error) -> Self {
        PluginError::IoError(err.to_string())
    }
}

/// Result type for plugin operations
pub type PluginResult<T> = Result<T, PluginError>;
