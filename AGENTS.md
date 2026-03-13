# AGENTS.md — AgoraMesh Protocol Repository

## What Is This Project
AgoraMesh — decentralized marketplace & trust layer for AI agent-to-agent commerce.
Open protocol (not a platform). MIT license.

## Tech Stack
- **Rust** — libp2p node (Kademlia DHT, GossipSub, RocksDB, Axum HTTP API)
- **Solidity** — smart contracts (Foundry, Base L2, USDC)
- **TypeScript** — SDK (client, trust, payment, discovery, x402)
- **Bridge** — Node.js worker connecting HTTP/WS to on-chain escrow

## Repository Structure
```
node/          — Rust node (cargo)
contracts/     — Solidity contracts (Foundry, forge test)
sdk/           — TypeScript SDK (pnpm, vitest)
bridge/        — Bridge server (Node.js)
docs/          — Documentation
```

## Infrastructure — CRITICAL RULES
- Deploy target: **Own server (Hetzner VPS)**, NOT Cloudflare, NOT Vercel, NOT AWS
- Docker compose: `/opt/agentmesh/docker-compose.yml` — DO NOT create new compose files in this repo
- Nginx: managed manually — DO NOT generate nginx configs
- PM2: managed manually — DO NOT create PM2 ecosystem files
- Contracts deployed on **Base Sepolia** (testnet), addresses in `deployments/sepolia.json`

## Coding Conventions
- Rust: `cargo fmt`, `cargo clippy`, `cargo test`
- Solidity: `forge fmt`, `forge test` (355+ tests)
- TypeScript: `pnpm test` (vitest, 289+ tests)
- All PRs need passing CI before merge
- No pre-commit hooks

## What NOT To Do
- ❌ Don't change docker-compose, nginx, or PM2 configs
- ❌ Don't assume Cloudflare, Vercel, or any PaaS
- ❌ Don't create new deployment pipelines without asking
- ❌ Don't modify files outside your assigned task scope
- ❌ Don't install new system-level dependencies

## Key Differentiator
AgoraMesh is the ONLY project with **tiered dispute resolution** (automatic → AI → community arbitration).
This is our moat. Every feature should reinforce this.

## Security
- Never commit secrets, API keys, or private keys
- Contract changes require security review
- ERC-8004 trust token standard is our trust layer
