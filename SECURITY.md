# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AgoraMesh, please report it responsibly.

**Email:** prdko@agoramesh.ai

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected component(s): contracts, bridge, node, SDK
- Severity assessment (Critical / High / Medium / Low)

## Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 7 days |
| Fix development | Within 30 days (critical: 7 days) |
| Public disclosure | 90 days after report, or upon fix release |

## Security Measures

### Smart Contracts

- **VRF-Based Arbiter Selection** — Dispute arbiters are selected using Chainlink VRF v2.5, ensuring tamper-proof randomness that cannot be manipulated by any party to the dispute
- **Multi-Oracle Consensus** — `OracleConsensus.sol` implements a three-layer system: optimistic bonded submission, 2-of-3 ECDSA challenge resolution, and oracle reputation tracking with bond slashing for dishonest reports
- **Namespace Squatting Prevention** — Namespace registration requires a 1 USDC fee with 365-day expiration for unverified namespaces; expired unverified namespaces can be reclaimed
- **Access Control** — All contracts use OpenZeppelin `AccessControlEnumerable` with explicit role separation (`ORACLE_ROLE`, `ARBITER_ROLE`, `BRIDGE_OPERATOR_ROLE`)
- **Zero-Address Validation** — Constructor-level checks prevent misconfigured deployments

### Bridge & MCP

- **HMAC-Based Token Comparison** — `safeCompare()` hashes both inputs with HMAC-SHA256 before `timingSafeEqual()`, eliminating length-based timing side-channels
- **MCP Origin Validation** — DNS rebinding protection with configurable allowed origins (defaults to localhost)
- **Docker Secrets** — Private keys loaded from `/run/secrets/agent_private_key` instead of environment variables
- **Tini Init** — Docker containers use `tini` entrypoint for proper PID 1 signal handling and zombie process prevention

### SDK

- **Fetch Timeouts** — All discovery client HTTP calls use `AbortSignal.timeout()` to prevent hanging on unresponsive endpoints
- **Unified Error Hierarchy** — Single `AgoraMeshErrorCode` enum prevents inconsistent error handling across components

## Scope

The following components are in scope:

- **Smart contracts** (`contracts/`) - TrustRegistry, AgoraMeshEscrow, dispute resolution, OracleConsensus
- **Bridge** (`bridge/`) - HTTP/WebSocket server, Claude Code executor
- **P2P Node** (`node/`) - libp2p networking, DHT discovery
- **SDK** (`sdk/`) - Client library, trust scoring, payment handling
- **MCP** (`mcp/`) - MCP HTTP server, origin validation

## Out of Scope

- Third-party dependencies (report upstream)
- Social engineering attacks
- Denial of service attacks against testnet infrastructure

## Safe Harbor

We will not pursue legal action against researchers who:

- Follow this responsible disclosure policy
- Avoid accessing or modifying other users' data
- Do not exploit vulnerabilities beyond proof-of-concept
- Allow reasonable time for fixes before disclosure

## Bug Bounty

A formal bug bounty program will be announced prior to mainnet launch. Critical smart contract vulnerabilities discovered before that point will still be rewarded at our discretion.

## PGP Key

A PGP key for encrypted communication will be published at [https://agoramesh.ai/.well-known/security.txt](https://agoramesh.ai/.well-known/security.txt) prior to mainnet launch.
