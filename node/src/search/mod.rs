//! Semantic search module for agent discovery.
//!
//! Provides vector-based semantic search using:
//! - FastEmbed for embedding generation (ONNX-based, lightweight)
//! - Qdrant for vector storage and similarity search
//! - Hybrid search combining BM25 keyword matching with vector similarity
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────┐     ┌────────────────┐
//! │ Capability Card │────▶│ EmbeddingService│
//! │   (text data)   │     │   (FastEmbed)  │
//! └─────────────────┘     └───────┬────────┘
//!                                 │
//!                                 ▼
//!                         ┌──────────────┐
//!                         │   Embedding  │
//!                         │  [f32; 384]  │
//!                         └──────┬───────┘
//!                                │
//!                   ┌────────────┼────────────┐
//!                   │            │            │
//!                   ▼            ▼            ▼
//!             ┌──────────┐ ┌──────────┐ ┌──────────┐
//!             │  Qdrant  │ │  Cache   │ │  BM25    │
//!             │  Index   │ │ (memory) │ │  Index   │
//!             └──────────┘ └──────────┘ └──────────┘
//!                   │            │            │
//!                   └────────────┼────────────┘
//!                                │
//!                                ▼
//!                        ┌──────────────┐
//!                        │ HybridSearch │
//!                        │   Results    │
//!                        └──────────────┘
//! ```

mod embedding;
mod hybrid;

pub use embedding::{Embedding, EmbeddingService, EmbeddingServiceConfig};
pub use hybrid::{HybridSearch, HybridSearchConfig, SearchResult};

/// Default embedding model (all-MiniLM-L6-v2 - 384 dimensions, good balance of speed/quality)
pub const DEFAULT_MODEL: &str = "all-MiniLM-L6-v2";

/// Embedding dimension for the default model
pub const EMBEDDING_DIM: usize = 384;
