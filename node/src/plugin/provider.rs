//! Plugin Provider trait and types
//!
//! Providers are data sources that agents can access.

use super::error::PluginResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;

/// Provider metadata for discovery and documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderMetadata {
    /// Unique provider name (e.g., "weather", "market_data")
    pub name: String,
    /// Human-readable description
    pub description: String,
    /// Data type this provider returns
    pub data_type: String,
    /// JSON Schema for the provided data
    pub schema: Option<JsonValue>,
    /// Whether the provider supports real-time updates
    pub supports_streaming: bool,
    /// Cache TTL in seconds (0 = no caching)
    pub cache_ttl_seconds: u64,
    /// Tags for categorization
    pub tags: Vec<String>,
}

impl Default for ProviderMetadata {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: String::new(),
            data_type: "json".to_string(),
            schema: None,
            supports_streaming: false,
            cache_ttl_seconds: 0,
            tags: Vec::new(),
        }
    }
}

/// Context for provider data retrieval
#[derive(Debug, Clone)]
pub struct ProviderContext {
    /// Agent DID requesting data
    pub agent_did: String,
    /// Request ID for tracing
    pub request_id: String,
    /// Query parameters
    pub params: HashMap<String, JsonValue>,
    /// Whether to force refresh (bypass cache)
    pub force_refresh: bool,
}

impl Default for ProviderContext {
    fn default() -> Self {
        Self {
            agent_did: String::new(),
            request_id: uuid::Uuid::new_v4().to_string(),
            params: HashMap::new(),
            force_refresh: false,
        }
    }
}

impl ProviderContext {
    /// Create a new context for an agent
    pub fn new(agent_did: impl Into<String>) -> Self {
        Self {
            agent_did: agent_did.into(),
            ..Default::default()
        }
    }

    /// Add a parameter
    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<JsonValue>) -> Self {
        self.params.insert(key.into(), value.into());
        self
    }

    /// Set force refresh
    pub fn with_force_refresh(mut self, force: bool) -> Self {
        self.force_refresh = force;
        self
    }
}

/// Result of a provider data retrieval
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderData {
    /// The provided data
    pub data: JsonValue,
    /// When the data was fetched
    pub timestamp: u64,
    /// Whether the data came from cache
    pub from_cache: bool,
    /// Data freshness (how old in seconds)
    pub age_seconds: u64,
    /// Additional metadata
    pub metadata: HashMap<String, JsonValue>,
}

impl ProviderData {
    /// Create new provider data
    pub fn new(data: impl Into<JsonValue>) -> Self {
        Self {
            data: data.into(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            from_cache: false,
            age_seconds: 0,
            metadata: HashMap::new(),
        }
    }

    /// Mark as from cache
    pub fn cached(mut self, age_seconds: u64) -> Self {
        self.from_cache = true;
        self.age_seconds = age_seconds;
        self
    }

    /// Add metadata
    pub fn with_metadata(mut self, key: impl Into<String>, value: impl Into<JsonValue>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }
}

/// The Provider trait
///
/// Providers are data sources that agents can access.
/// They retrieve and optionally cache data from various sources.
///
/// # Example
///
/// ```rust,ignore
/// struct WeatherProvider {
///     api_key: String,
/// }
///
/// #[async_trait]
/// impl Provider for WeatherProvider {
///     fn metadata(&self) -> ProviderMetadata {
///         ProviderMetadata {
///             name: "weather".to_string(),
///             description: "Current weather data".to_string(),
///             cache_ttl_seconds: 300, // 5 minutes
///             ..Default::default()
///         }
///     }
///
///     async fn get(&self, ctx: &ProviderContext) -> PluginResult<ProviderData> {
///         let location = ctx.params.get("location")
///             .and_then(|v| v.as_str())
///             .unwrap_or("London");
///
///         // Fetch weather data...
///         let weather = serde_json::json!({
///             "location": location,
///             "temperature": 20,
///             "condition": "sunny"
///         });
///
///         Ok(ProviderData::new(weather))
///     }
/// }
/// ```
#[async_trait]
pub trait Provider: Send + Sync {
    /// Get provider metadata
    fn metadata(&self) -> ProviderMetadata;

    /// Get data from the provider
    ///
    /// # Arguments
    /// * `ctx` - Provider context with agent info and parameters
    ///
    /// # Returns
    /// Provider data with the requested information
    async fn get(&self, ctx: &ProviderContext) -> PluginResult<ProviderData>;

    /// Check if the provider is available
    ///
    /// Override to add availability checks (e.g., API reachability).
    async fn is_available(&self) -> bool {
        true
    }

    /// Get the provider's current status
    async fn health_check(&self) -> ProviderHealth {
        ProviderHealth {
            available: self.is_available().await,
            latency_ms: None,
            last_error: None,
        }
    }
}

/// Provider health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    /// Whether the provider is available
    pub available: bool,
    /// Response latency in milliseconds
    pub latency_ms: Option<u64>,
    /// Last error message if any
    pub last_error: Option<String>,
}

/// Wrapper for provider with caching
pub struct CachedProvider {
    inner: std::sync::Arc<dyn Provider>,
    cache: tokio::sync::RwLock<Option<CacheEntry>>,
}

struct CacheEntry {
    data: ProviderData,
    expires_at: std::time::Instant,
}

impl CachedProvider {
    /// Create a new cached provider wrapper
    pub fn new(provider: std::sync::Arc<dyn Provider>) -> Self {
        Self {
            inner: provider,
            cache: tokio::sync::RwLock::new(None),
        }
    }

    /// Get data with caching
    pub async fn get_cached(&self, ctx: &ProviderContext) -> PluginResult<ProviderData> {
        // Check cache unless force refresh
        if !ctx.force_refresh {
            let cache = self.cache.read().await;
            if let Some(entry) = &*cache {
                if entry.expires_at > std::time::Instant::now() {
                    let age = std::time::Instant::now()
                        .duration_since(
                            entry.expires_at
                                - std::time::Duration::from_secs(
                                    self.inner.metadata().cache_ttl_seconds,
                                ),
                        )
                        .as_secs();
                    return Ok(entry.data.clone().cached(age));
                }
            }
        }

        // Fetch fresh data
        let data = self.inner.get(ctx).await?;

        // Update cache if TTL > 0
        let ttl = self.inner.metadata().cache_ttl_seconds;
        if ttl > 0 {
            let mut cache = self.cache.write().await;
            *cache = Some(CacheEntry {
                data: data.clone(),
                expires_at: std::time::Instant::now() + std::time::Duration::from_secs(ttl),
            });
        }

        Ok(data)
    }

    /// Invalidate the cache
    pub async fn invalidate(&self) {
        let mut cache = self.cache.write().await;
        *cache = None;
    }
}
