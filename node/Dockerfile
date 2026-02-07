# AgentMesh Node Dockerfile
# Multi-stage build for security and minimal image size
#
# Build: docker build -t agentmesh-node .
# Run:   docker run -p 8080:8080 -p 4001:4001 agentmesh-node

# ==============================================================================
# Build Stage - Rust compilation
# ==============================================================================
FROM rust:1.83-alpine AS builder

# Install build dependencies for static linking
RUN apk add --no-cache \
    musl-dev \
    pkgconfig \
    openssl-dev \
    openssl-libs-static \
    cmake \
    make \
    perl \
    linux-headers \
    clang \
    llvm \
    git

# Create build directory
WORKDIR /build

# Copy manifests first for layer caching
COPY Cargo.toml Cargo.lock ./

# Create dummy src to compile dependencies
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    echo "pub fn lib() {}" > src/lib.rs

# Build dependencies (cached layer)
RUN cargo build --release && \
    rm -rf src target/release/agentmesh* target/release/deps/agentmesh*

# Copy actual source
COPY src/ ./src/

# Build the application
RUN cargo build --release --locked

# Verify the binary exists
RUN ls -la target/release/agentmesh

# ==============================================================================
# Production Stage - Minimal runtime
# ==============================================================================
FROM alpine:3.21 AS production

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    libgcc \
    tini

# Security: Create non-root user and group
RUN addgroup -g 1001 -S agentmesh && \
    adduser -u 1001 -S agentmesh -G agentmesh

# Create directories
RUN mkdir -p /app/data /app/config && \
    chown -R agentmesh:agentmesh /app

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/target/release/agentmesh ./

# Copy default configuration (optional)
# COPY config/default.toml ./config/

# Set ownership
RUN chown agentmesh:agentmesh ./agentmesh && \
    chmod +x ./agentmesh

# Switch to non-root user
USER agentmesh

# Environment variables with defaults
ENV RUST_LOG=info \
    AGENTMESH_API_LISTEN=0.0.0.0:8080 \
    AGENTMESH_P2P_LISTEN=/ip4/0.0.0.0/tcp/4001 \
    AGENTMESH_DATA_DIR=/app/data \
    AGENTMESH_NETWORK=mainnet \
    AGENTMESH_CHAIN_RPC=https://mainnet.base.org

# Expose ports
# 8080 - HTTP API
# 4001 - P2P libp2p
EXPOSE 8080 4001

# Persistent data volume
VOLUME ["/app/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the node
CMD ["./agentmesh"]
