//! Plugin builder for easy plugin construction

use super::{Action, Plugin, PluginConfig, PluginInfo, PluginPriority, Provider, Service};
use async_trait::async_trait;
use std::sync::Arc;

/// Builder for creating plugins
pub struct PluginBuilder {
    info: PluginInfo,
    config: PluginConfig,
    actions: Vec<Arc<dyn Action>>,
    providers: Vec<Arc<dyn Provider>>,
    services: Vec<Arc<dyn Service>>,
}

impl PluginBuilder {
    /// Create a new plugin builder
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            info: PluginInfo {
                name: name.into(),
                ..Default::default()
            },
            config: PluginConfig::default(),
            actions: Vec::new(),
            providers: Vec::new(),
            services: Vec::new(),
        }
    }

    /// Set plugin description
    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.info.description = description.into();
        self
    }

    /// Set plugin version
    pub fn version(mut self, version: impl Into<String>) -> Self {
        self.info.version = version.into();
        self
    }

    /// Set plugin author
    pub fn author(mut self, author: impl Into<String>) -> Self {
        self.info.author = Some(author.into());
        self
    }

    /// Set plugin license
    pub fn license(mut self, license: impl Into<String>) -> Self {
        self.info.license = Some(license.into());
        self
    }

    /// Set plugin homepage
    pub fn homepage(mut self, homepage: impl Into<String>) -> Self {
        self.info.homepage = Some(homepage.into());
        self
    }

    /// Add a dependency
    pub fn dependency(mut self, plugin_name: impl Into<String>) -> Self {
        self.info.dependencies.push(plugin_name.into());
        self
    }

    /// Set priority
    pub fn priority(mut self, priority: PluginPriority) -> Self {
        self.info.priority = priority;
        self
    }

    /// Add a tag
    pub fn tag(mut self, tag: impl Into<String>) -> Self {
        self.info.tags.push(tag.into());
        self
    }

    /// Add multiple tags
    pub fn tags(mut self, tags: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.info.tags.extend(tags.into_iter().map(|t| t.into()));
        self
    }

    /// Set configuration
    pub fn config(mut self, config: PluginConfig) -> Self {
        self.config = config;
        self
    }

    /// Add a configuration value
    pub fn config_value(
        mut self,
        key: impl Into<String>,
        value: impl Into<serde_json::Value>,
    ) -> Self {
        self.config.set(key, value);
        self
    }

    /// Add an action
    pub fn action(mut self, action: Arc<dyn Action>) -> Self {
        self.actions.push(action);
        self
    }

    /// Add multiple actions
    pub fn actions(mut self, actions: impl IntoIterator<Item = Arc<dyn Action>>) -> Self {
        self.actions.extend(actions);
        self
    }

    /// Add a provider
    pub fn provider(mut self, provider: Arc<dyn Provider>) -> Self {
        self.providers.push(provider);
        self
    }

    /// Add multiple providers
    pub fn providers(mut self, providers: impl IntoIterator<Item = Arc<dyn Provider>>) -> Self {
        self.providers.extend(providers);
        self
    }

    /// Add a service
    pub fn service(mut self, service: Arc<dyn Service>) -> Self {
        self.services.push(service);
        self
    }

    /// Add multiple services
    pub fn services(mut self, services: impl IntoIterator<Item = Arc<dyn Service>>) -> Self {
        self.services.extend(services);
        self
    }

    /// Build the plugin
    pub fn build(self) -> BasicPlugin {
        BasicPlugin {
            info: self.info,
            config: self.config,
            actions: self.actions,
            providers: self.providers,
            services: self.services,
        }
    }
}

/// A basic plugin implementation created by the builder
pub struct BasicPlugin {
    info: PluginInfo,
    config: PluginConfig,
    actions: Vec<Arc<dyn Action>>,
    providers: Vec<Arc<dyn Provider>>,
    services: Vec<Arc<dyn Service>>,
}

#[async_trait]
impl Plugin for BasicPlugin {
    fn info(&self) -> &PluginInfo {
        &self.info
    }

    fn config(&self) -> &PluginConfig {
        &self.config
    }

    fn actions(&self) -> Vec<Arc<dyn Action>> {
        self.actions.clone()
    }

    fn providers(&self) -> Vec<Arc<dyn Provider>> {
        self.providers.clone()
    }

    fn services(&self) -> Vec<Arc<dyn Service>> {
        self.services.clone()
    }
}
