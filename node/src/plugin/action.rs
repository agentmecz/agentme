//! Plugin Action trait and types
//!
//! Actions are executable capabilities that agents can perform.

use super::error::PluginResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Action metadata for discovery and documentation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ActionMetadata {
    /// Unique action name (e.g., "web_search", "send_email")
    pub name: String,
    /// Human-readable description
    pub description: String,
    /// JSON Schema for input parameters
    pub input_schema: Option<JsonValue>,
    /// JSON Schema for output
    pub output_schema: Option<JsonValue>,
    /// Example inputs
    pub examples: Vec<ActionExample>,
    /// Tags for categorization
    pub tags: Vec<String>,
    /// Whether the action requires confirmation before execution
    pub requires_confirmation: bool,
    /// Estimated execution time in milliseconds (for planning)
    pub estimated_duration_ms: Option<u64>,
}

/// Example input/output for an action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionExample {
    /// Example description
    pub description: String,
    /// Example input
    pub input: JsonValue,
    /// Expected output
    pub expected_output: Option<JsonValue>,
}

/// Context passed to action execution
///
/// Contains runtime information and utilities for the action.
#[derive(Debug, Clone)]
pub struct ActionContext {
    /// Agent DID executing the action
    pub agent_did: String,
    /// Request ID for tracing
    pub request_id: String,
    /// Timeout for this execution (milliseconds)
    pub timeout_ms: u64,
    /// Additional context values
    pub values: HashMap<String, JsonValue>,
}

impl Default for ActionContext {
    fn default() -> Self {
        Self {
            agent_did: String::new(),
            request_id: uuid::Uuid::new_v4().to_string(),
            timeout_ms: 30_000, // 30 seconds default
            values: HashMap::new(),
        }
    }
}

impl ActionContext {
    /// Create a new context for an agent
    pub fn new(agent_did: impl Into<String>) -> Self {
        Self {
            agent_did: agent_did.into(),
            ..Default::default()
        }
    }

    /// Set timeout
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }

    /// Add a context value
    pub fn with_value(mut self, key: impl Into<String>, value: impl Into<JsonValue>) -> Self {
        self.values.insert(key.into(), value.into());
        self
    }

    /// Get a context value
    pub fn get(&self, key: &str) -> Option<&JsonValue> {
        self.values.get(key)
    }
}

/// Result of an action execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResult {
    /// Whether the action succeeded
    pub success: bool,
    /// Output data
    pub output: JsonValue,
    /// Execution duration in milliseconds
    pub duration_ms: u64,
    /// Optional error message
    pub error: Option<String>,
    /// Additional metadata
    pub metadata: HashMap<String, JsonValue>,
}

impl ActionResult {
    /// Create a successful result
    pub fn success(output: impl Into<JsonValue>) -> Self {
        Self {
            success: true,
            output: output.into(),
            duration_ms: 0,
            error: None,
            metadata: HashMap::new(),
        }
    }

    /// Create a failed result
    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            output: JsonValue::Null,
            duration_ms: 0,
            error: Some(error.into()),
            metadata: HashMap::new(),
        }
    }

    /// Set duration
    pub fn with_duration(mut self, duration_ms: u64) -> Self {
        self.duration_ms = duration_ms;
        self
    }

    /// Add metadata
    pub fn with_metadata(mut self, key: impl Into<String>, value: impl Into<JsonValue>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }
}

/// The Action trait
///
/// Actions are executable capabilities that agents can perform.
/// They receive input, execute logic, and return output.
///
/// # Example
///
/// ```rust,ignore
/// struct WebSearchAction;
///
/// #[async_trait]
/// impl Action for WebSearchAction {
///     fn metadata(&self) -> ActionMetadata {
///         ActionMetadata {
///             name: "web_search".to_string(),
///             description: "Search the web for information".to_string(),
///             ..Default::default()
///         }
///     }
///
///     async fn execute(&self, ctx: &ActionContext, input: JsonValue)
///         -> PluginResult<ActionResult>
///     {
///         let query = input["query"].as_str()
///             .ok_or_else(|| PluginError::ActionFailed {
///                 action: "web_search".to_string(),
///                 reason: "Missing 'query' parameter".to_string(),
///             })?;
///
///         // Perform search...
///         let results = vec!["result1", "result2"];
///
///         Ok(ActionResult::success(serde_json::json!({
///             "results": results
///         })))
///     }
/// }
/// ```
#[async_trait]
pub trait Action: Send + Sync {
    /// Get action metadata
    fn metadata(&self) -> ActionMetadata;

    /// Execute the action
    ///
    /// # Arguments
    /// * `ctx` - Execution context with agent info and timeout
    /// * `input` - JSON input parameters
    ///
    /// # Returns
    /// Action result with output data
    async fn execute(&self, ctx: &ActionContext, input: JsonValue) -> PluginResult<ActionResult>;

    /// Validate input before execution
    ///
    /// Override to add custom validation logic.
    fn validate_input(&self, input: &JsonValue) -> PluginResult<()> {
        let _ = input; // Default: accept any input
        Ok(())
    }

    /// Check if this action can be executed in the current context
    ///
    /// Override to add context-based restrictions.
    fn can_execute(&self, ctx: &ActionContext) -> bool {
        let _ = ctx; // Default: always allowed
        true
    }
}

/// Wrapper for action with usage statistics
pub struct TrackedAction {
    inner: Arc<dyn Action>,
    execution_count: RwLock<u64>,
    total_duration_ms: RwLock<u64>,
    error_count: RwLock<u64>,
}

impl TrackedAction {
    /// Create a new tracked action
    pub fn new(action: Arc<dyn Action>) -> Self {
        Self {
            inner: action,
            execution_count: RwLock::new(0),
            total_duration_ms: RwLock::new(0),
            error_count: RwLock::new(0),
        }
    }

    /// Get the underlying action
    pub fn inner(&self) -> &Arc<dyn Action> {
        &self.inner
    }

    /// Execute with tracking
    pub async fn execute_tracked(
        &self,
        ctx: &ActionContext,
        input: JsonValue,
    ) -> PluginResult<ActionResult> {
        let start = std::time::Instant::now();
        let result = self.inner.execute(ctx, input).await;
        let duration = start.elapsed().as_millis() as u64;

        // Update stats
        {
            let mut count = self.execution_count.write().await;
            *count += 1;
        }
        {
            let mut total = self.total_duration_ms.write().await;
            *total += duration;
        }

        if result.is_err() {
            let mut errors = self.error_count.write().await;
            *errors += 1;
        }

        // Add duration to result
        result.map(|r| r.with_duration(duration))
    }

    /// Get execution statistics
    pub async fn stats(&self) -> ActionStats {
        let execution_count = *self.execution_count.read().await;
        let total_duration_ms = *self.total_duration_ms.read().await;
        let error_count = *self.error_count.read().await;

        ActionStats {
            execution_count,
            average_duration_ms: if execution_count > 0 {
                total_duration_ms / execution_count
            } else {
                0
            },
            error_count,
            success_rate: if execution_count > 0 {
                ((execution_count - error_count) as f64 / execution_count as f64) * 100.0
            } else {
                100.0
            },
        }
    }
}

/// Action execution statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionStats {
    /// Total number of executions
    pub execution_count: u64,
    /// Average execution duration in milliseconds
    pub average_duration_ms: u64,
    /// Number of failed executions
    pub error_count: u64,
    /// Success rate percentage (0-100)
    pub success_rate: f64,
}
