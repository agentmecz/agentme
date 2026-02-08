//! AgentMesh Node CLI
//!
//! Command-line interface for running an AgentMesh node.

use clap::{Parser, Subcommand};
use std::path::Path;
use tokio::signal;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use agentmesh_node::{
    ApiServer, AppState, DiscoveryService, EmbeddingService, HybridSearch, MetricsConfig,
    MetricsService, NetworkConfig, NetworkManager, NodeConfig, RateLimitConfig, RateLimitService,
    Result, TrustService,
};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

/// Health response from the API.
#[derive(Debug, serde::Deserialize)]
struct HealthResponse {
    status: String,
    version: String,
    peers: u64,
    uptime: u64,
}

#[derive(Parser)]
#[command(name = "agentmesh")]
#[command(author, version, about = "AgentMesh P2P Node", long_about = None)]
struct Cli {
    /// Path to configuration file
    #[arg(short, long, default_value = "config.toml")]
    config: String,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new node configuration
    Init {
        /// Output path for configuration file
        #[arg(short, long, default_value = "config.toml")]
        output: String,
    },

    /// Start the AgentMesh node
    Start {
        /// P2P listen address
        #[arg(long, default_value = "/ip4/0.0.0.0/tcp/9000")]
        p2p_addr: String,

        /// HTTP API listen address
        #[arg(long, default_value = "0.0.0.0:8080")]
        api_addr: String,

        /// Enable semantic search (downloads ~90MB embedding model on first use)
        #[arg(long, default_value = "false")]
        enable_semantic_search: bool,
    },

    /// Check node health
    Health {
        /// API endpoint to check
        #[arg(long, default_value = "http://localhost:8080")]
        endpoint: String,
    },
}

fn init_logging(verbose: bool) {
    let filter = if verbose {
        EnvFilter::new("debug")
    } else {
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
    };

    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(filter)
        .init();
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    init_logging(cli.verbose);

    match cli.command {
        Commands::Init { output } => {
            info!("Initializing new node configuration at: {}", output);
            let config = NodeConfig::default();
            config.save(&output)?;
            info!("Configuration saved successfully");
        }

        Commands::Start {
            p2p_addr,
            api_addr,
            enable_semantic_search,
        } => {
            info!("Starting AgentMesh node...");

            // 1. Load configuration (or use defaults with CLI overrides)
            let config = if Path::new(&cli.config).exists() {
                info!("Loading configuration from: {}", cli.config);
                NodeConfig::load(&cli.config)?
            } else {
                info!("Using default configuration");
                NodeConfig::default()
            };

            // Create network config with CLI overrides
            let network_config = NetworkConfig {
                listen_addresses: vec![p2p_addr.clone()],
                bootstrap_peers: config.network.bootstrap_peers.clone(),
                max_connections: config.network.max_connections,
            };

            info!("P2P address: {}", p2p_addr);
            info!("API address: {}", api_addr);

            // 2. Initialize P2P network
            info!("Initializing P2P network...");
            let mut network = NetworkManager::new(network_config)?;
            info!("Network started with peer ID: {}", network.local_peer_id());

            // 3. Take event receiver for processing network events
            let mut event_rx = network.take_event_receiver();

            // 4. Initialize semantic search if enabled
            let hybrid_search = if enable_semantic_search {
                info!("Initializing semantic search (downloading ~90MB model if needed)...");
                match EmbeddingService::new() {
                    Ok(embedding_service) => {
                        let hybrid = HybridSearch::new(embedding_service);
                        info!("Semantic search initialized successfully");
                        Some(Arc::new(RwLock::new(hybrid)))
                    }
                    Err(e) => {
                        warn!("Failed to initialize semantic search: {}", e);
                        warn!("Semantic search will be disabled, using keyword search only");
                        None
                    }
                }
            } else {
                None
            };

            // 5. Create shared state for API server with DHT-enabled discovery
            let peer_count = Arc::new(AtomicU64::new(0));
            let discovery = match hybrid_search {
                Some(hs) => {
                    DiscoveryService::with_network_and_shared_search(network.command_channel(), hs)
                }
                None => DiscoveryService::with_network(network.command_channel()),
            };
            // Get the shared hybrid search reference from discovery so both
            // the API semantic-search handler and discovery indexing use the
            // same instance.
            let shared_hybrid_search = discovery.hybrid_search();
            let app_state = AppState {
                discovery: Arc::new(discovery),
                trust: Arc::new(TrustService::new(
                    "https://sepolia.base.org".to_string(),
                    None,
                )),
                start_time: Instant::now(),
                peer_count: peer_count.clone(),
                node_info: config.get_node_info(),
                rate_limiter: Arc::new(RateLimitService::new(RateLimitConfig::default())),
                metrics: Arc::new(MetricsService::new(MetricsConfig::default())),
                hybrid_search: shared_hybrid_search,
            };

            // 6. Start HTTP API server in background with shared state
            let api_config = agentmesh_node::ApiConfig {
                listen_address: api_addr.clone(),
                cors_enabled: config.api.cors_enabled,
                cors_origins: config.api.cors_origins.clone(),
            };
            let api_server = ApiServer::with_state(api_config, app_state);
            let api_addr_clone = api_addr.clone();

            tokio::spawn(async move {
                if let Err(e) = api_server.run(&api_addr_clone).await {
                    error!("API server error: {}", e);
                }
            });

            info!("AgentMesh node started successfully");
            info!("Press Ctrl+C to stop");

            // 7. Run event loop - process network events and handle shutdown
            loop {
                tokio::select! {
                    // Handle network events
                    Some(event) = async {
                        if let Some(ref mut rx) = event_rx {
                            rx.recv().await
                        } else {
                            None
                        }
                    } => {
                        match event {
                            agentmesh_node::NetworkEvent::PeerConnected(peer_id) => {
                                peer_count.fetch_add(1, Ordering::SeqCst);
                                info!("Peer connected: {} (total: {})", peer_id, peer_count.load(Ordering::SeqCst));
                            }
                            agentmesh_node::NetworkEvent::PeerDisconnected(peer_id) => {
                                peer_count.fetch_sub(1, Ordering::SeqCst);
                                info!("Peer disconnected: {} (total: {})", peer_id, peer_count.load(Ordering::SeqCst));
                            }
                            agentmesh_node::NetworkEvent::PeerDiscovered(peer_id) => {
                                info!("Peer discovered via mDNS: {}", peer_id);
                            }
                            agentmesh_node::NetworkEvent::Message { topic, source, data, .. } => {
                                info!(
                                    "Message on {}: {} bytes from {:?}",
                                    topic,
                                    data.len(),
                                    source
                                );
                            }
                            agentmesh_node::NetworkEvent::BootstrapComplete => {
                                info!("DHT bootstrap complete");
                            }
                            agentmesh_node::NetworkEvent::RecordFound { key, value } => {
                                info!(
                                    "DHT record found: key={} bytes, value={:?}",
                                    key.len(),
                                    value.as_ref().map(|v| v.len())
                                );
                            }
                            agentmesh_node::NetworkEvent::RecordStored { key } => {
                                info!("DHT record stored: key={} bytes", key.len());
                            }
                        }
                    }

                    // Handle shutdown signal
                    _ = signal::ctrl_c() => {
                        info!("Received shutdown signal");
                        if let Err(e) = network.shutdown().await {
                            warn!("Error during shutdown: {}", e);
                        }
                        info!("Node stopped");
                        break;
                    }
                }
            }
        }

        Commands::Health { endpoint } => {
            info!("Checking node health at: {}", endpoint);

            // Simple health check using a basic HTTP client
            let health_url = format!("{}/health", endpoint.trim_end_matches('/'));

            // Use tokio's TCP stream for a simple HTTP GET request
            match tokio::time::timeout(std::time::Duration::from_secs(5), check_health(&health_url))
                .await
            {
                Ok(Ok(response)) => {
                    info!("Node status: {}", response.status);
                    info!("Version: {}", response.version);
                    info!("Connected peers: {}", response.peers);
                    info!("Uptime: {} seconds", response.uptime);
                }
                Ok(Err(e)) => {
                    error!("Health check failed: {}", e);
                    std::process::exit(1);
                }
                Err(_) => {
                    error!("Health check timed out");
                    std::process::exit(1);
                }
            }
        }
    }

    Ok(())
}

/// Perform a health check against the API endpoint.
async fn check_health(url: &str) -> Result<HealthResponse> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    // Parse URL to extract host and path
    let url = url.trim_start_matches("http://");
    let (host_port, path) = url
        .split_once('/')
        .map(|(h, p)| (h, format!("/{}", p)))
        .unwrap_or((url, "/health".to_string()));

    // Connect to server
    let mut stream = TcpStream::connect(host_port)
        .await
        .map_err(|e| agentmesh_node::Error::Api(format!("Connection failed: {}", e)))?;

    // Send HTTP GET request
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        path, host_port
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| agentmesh_node::Error::Api(format!("Write failed: {}", e)))?;

    // Read response
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .await
        .map_err(|e| agentmesh_node::Error::Api(format!("Read failed: {}", e)))?;

    let response_str = String::from_utf8_lossy(&response);

    // Find body (after \r\n\r\n)
    let body = response_str
        .split("\r\n\r\n")
        .nth(1)
        .ok_or_else(|| agentmesh_node::Error::Api("Invalid HTTP response".to_string()))?;

    // Parse JSON
    serde_json::from_str(body)
        .map_err(|e| agentmesh_node::Error::Api(format!("JSON parse error: {}", e)))
}
