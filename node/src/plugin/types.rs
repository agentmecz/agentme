//! Core plugin types

use super::error::PluginResult;
use super::{Action, Provider, Service};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// Plugin priority for load ordering
/// Lower numbers load first
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PluginPriority(pub u32);

impl Default for PluginPriority {
    fn default() -> Self {
        PluginPriority(100) // Default middle priority
    }
}

impl PluginPriority {
    /// Highest priority (loads first)
    pub const HIGHEST: PluginPriority = PluginPriority(0);
    /// High priority
    pub const HIGH: PluginPriority = PluginPriority(25);
    /// Normal priority
    pub const NORMAL: PluginPriority = PluginPriority(50);
    /// Default priority
    pub const DEFAULT: PluginPriority = PluginPriority(100);
    /// Low priority
    pub const LOW: PluginPriority = PluginPriority(150);
    /// Lowest priority (loads last)
    pub const LOWEST: PluginPriority = PluginPriority(200);
}

/// Plugin configuration from environment or config file
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginConfig {
    /// Configuration values
    #[serde(flatten)]
    pub values: HashMap<String, serde_json::Value>,
}

impl PluginConfig {
    /// Create a new empty config
    pub fn new() -> Self {
        Self {
            values: HashMap::new(),
        }
    }

    /// Get a string value
    pub fn get_string(&self, key: &str) -> Option<String> {
        self.values
            .get(key)
            .and_then(|v| v.as_str())
            .map(String::from)
    }

    /// Get a boolean value
    pub fn get_bool(&self, key: &str) -> Option<bool> {
        self.values.get(key).and_then(|v| v.as_bool())
    }

    /// Get an integer value
    pub fn get_i64(&self, key: &str) -> Option<i64> {
        self.values.get(key).and_then(|v| v.as_i64())
    }

    /// Get a float value
    pub fn get_f64(&self, key: &str) -> Option<f64> {
        self.values.get(key).and_then(|v| v.as_f64())
    }

    /// Get a raw JSON value
    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.values.get(key)
    }

    /// Set a value
    pub fn set(&mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) {
        self.values.insert(key.into(), value.into());
    }

    /// Check if a key exists
    pub fn contains(&self, key: &str) -> bool {
        self.values.contains_key(key)
    }
}

/// Plugin information (metadata)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    /// Unique plugin name (e.g., "openai-provider", "web-search")
    pub name: String,
    /// Human-readable description
    pub description: String,
    /// Semantic version
    pub version: String,
    /// Plugin author
    pub author: Option<String>,
    /// License
    pub license: Option<String>,
    /// Plugin homepage/repository
    pub homepage: Option<String>,
    /// Required dependencies (other plugin names)
    pub dependencies: Vec<String>,
    /// Load priority
    pub priority: PluginPriority,
    /// Tags for categorization
    pub tags: Vec<String>,
}

impl Default for PluginInfo {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: String::new(),
            version: String::from("0.1.0"),
            author: None,
            license: None,
            homepage: None,
            dependencies: Vec::new(),
            priority: PluginPriority::default(),
            tags: Vec::new(),
        }
    }
}

/// The core Plugin trait
///
/// Plugins are modular bundles that extend agent capabilities with:
/// - Actions: executable capabilities
/// - Providers: data sources
/// - Services: external system integrations
#[async_trait]
pub trait Plugin: Send + Sync {
    /// Get plugin information
    fn info(&self) -> &PluginInfo;

    /// Get plugin configuration
    fn config(&self) -> &PluginConfig;

    /// Initialize the plugin
    /// Called during registration
    async fn init(&mut self) -> PluginResult<()> {
        Ok(())
    }

    /// Shutdown the plugin
    /// Called during unregistration
    async fn shutdown(&mut self) -> PluginResult<()> {
        Ok(())
    }

    /// Get all actions provided by this plugin
    fn actions(&self) -> Vec<Arc<dyn Action>> {
        Vec::new()
    }

    /// Get all providers provided by this plugin
    fn providers(&self) -> Vec<Arc<dyn Provider>> {
        Vec::new()
    }

    /// Get all services provided by this plugin
    fn services(&self) -> Vec<Arc<dyn Service>> {
        Vec::new()
    }

    /// Check if the plugin is enabled
    /// Can use config to determine this
    fn is_enabled(&self) -> bool {
        true
    }
}
