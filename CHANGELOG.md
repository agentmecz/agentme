# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-04-05

### Added

- **A2A v1.0.0 Protocol Compliance** — Full alignment with A2A v1.0.0 specification
  - JSON-RPC methods: `SendMessage`, `GetTask`, `CancelTask` (with legacy aliases)
  - SSE streaming via `SendStreamingMessage` and `SubscribeToTask`
  - REST path aliases: `/message:send`, `/message:stream`, `/tasks/{id}:cancel`
  - `ListTasks` endpoint with status filtering
  - `contextId` for multi-turn conversation threading
  - New task states: `INPUT_REQUIRED`, `AUTH_REQUIRED`, `REJECTED`
  - Multi-type message parts: `raw`, `url`, `data`, `text`
  - OpenAPI 3.2 `securitySchemes` in Agent Card
  - `supportedInterfaces` and `extensions` fields in Agent Card
- **Chainlink VRF v2.5 Arbiter Selection** — Verifiable random function for tamper-proof dispute arbiter assignment
- **Multi-Oracle Consensus** — `OracleConsensus.sol` with optimistic submission, 2-of-3 challenge resolution, and oracle reputation tracking
- **Namespace Registration Fees** — 1 USDC fee and 365-day expiration for unverified namespaces to prevent squatting
- **Unified Error Hierarchy** — `AgoraMeshErrorCode` enum in SDK as single source of truth; bridge and MCP import from SDK
- **MCP Origin Validation** — DNS rebinding protection with configurable allowed origins
- **Docker Secrets Support** — Private keys via `/run/secrets/agent_private_key` instead of environment variables

### Changed

- **Capabilities → Skills** — Renamed `capabilities` to `skills` throughout per A2A spec (`capabilities` kept as deprecated alias)
- **Express v4 → v5** — Bridge upgraded to Express v5.1.0
- **ERC8004Bridge** — Migrated from `Ownable` to `AccessControlEnumerable` with `BRIDGE_OPERATOR_ROLE`
- **DID Regex** — Split into separate patterns: `did:web` supports domains, `did:agoramesh` supports hyphens

### Fixed

- **Reputation Precision** — Reordered to multiply-before-divide in `NFTBoundReputation.calculateReputationScore()` to prevent truncation
- **Streaming Dust Threshold** — Streams with ≤ 10 wei remaining treated as complete to handle rounding errors
- **HMAC Timing** — `safeCompare()` hashes both inputs before `timingSafeEqual()` to eliminate length side-channel
- **SDK Fetch Timeouts** — All discovery client HTTP calls use `AbortSignal.timeout(10000)` to prevent hanging
- **DID Timestamps** — Resolution timestamps converted to RFC 3339 format per W3C DID Core
- **Zero-Address Checks** — Constructor validation in `ERC8004Bridge` and `ERC8004Adapter` for registry and admin addresses

### Security

- Tini init process manager added to Docker containers for proper PID 1 signal handling
- A2A JSON-RPC error codes (`-32001` TASK_NOT_FOUND, `-32002` TASK_NOT_CANCELLABLE)
- Newline metacharacter blocking in CLI prompts
- Docker containers use `tini` entrypoint for zombie process prevention

## [0.1.0] - 2026-02-07

### Added

- **Smart Contracts** - TrustRegistry, AgoraMeshEscrow, TieredDisputeResolution, StreamingPayments, AgentToken (NFT-bound reputation), CrossChainTrustSync
- **TypeScript SDK** - Client library with trust scoring, payment/escrow management, streaming payments, discovery, and x402 protocol support
- **Bridge** - Claude Code worker bridge with HTTP/WebSocket server, escrow integration, AI-assisted dispute arbitration, rate limiting, and x402 middleware
- **Rust P2P Node** - libp2p networking with Kademlia DHT discovery, GossipSub messaging, trust scoring, and HTTP API
- **Deployment Pipeline** - DeployAll script with cross-contract role configuration, on-chain verification
- **Integration Tests** - 644 tests across Solidity (355) and TypeScript (289)
- **CI/CD** - GitHub Actions with pinned actions, Dependabot, Docker multi-stage builds
- **Documentation** - Protocol specifications, tutorials, API reference, deployment guides

### Security

- Comprehensive security audit with fixes for critical, high, and medium findings
- Smart contract access control with OpenZeppelin AccessControlEnumerable
- Bridge server binds to localhost by default
- AI arbitration prompt injection hardening with XML escaping and Zod validation
- x402 nonce replay attack prevention
- WebSocket origin validation
- Docker containers run as non-root with dropped capabilities
