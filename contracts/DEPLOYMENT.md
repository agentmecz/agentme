# AgoraMesh Smart Contract Deployment Guide

This guide covers deploying the AgoraMesh smart contracts to Base L2.

## Prerequisites

1. **Foundry** installed (`forge`, `cast`, `anvil`)
2. **Environment variables** configured
3. **Sufficient ETH** for gas on the target network
4. **USDC** for testing (on testnet)

## Environment Setup

Create a `.env` file in the `contracts/` directory:

```bash
# Deployer private key (without 0x prefix works, with 0x also works)
DEPLOYER_PRIVATE_KEY=your_private_key_here

# Optional: Etherscan API key for verification
BASESCAN_API_KEY=your_basescan_api_key
```

Load environment variables:

```bash
source .env
```

## Deployed Contracts

The deployment script deploys 9 contracts in the following order:

| # | Contract | Description |
|---|----------|-------------|
| 1 | TrustRegistry | Core identity & reputation registry |
| 2 | ChainRegistry | Multi-chain configuration |
| 3 | AgoraMeshEscrow | One-time payment escrow |
| 4 | TieredDisputeResolution | Dispute resolution system |
| 5 | StreamingPayments | Sablier-style payment streams |
| 6 | CrossChainTrustSync | LayerZero V2 cross-chain messaging |
| 7 | VerifiedNamespaces | ENS-inspired namespace registry |
| 8 | AgentToken | ERC-721 + ERC-2981 agent NFTs |
| 9 | NFTBoundReputation | Reputation bound to agent NFTs |

## Network Addresses

### USDC
| Network | Address |
|---------|---------|
| Base Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

### LayerZero V2 Endpoints
| Network | Address | Endpoint ID |
|---------|---------|-------------|
| Base Mainnet | `0x1a44076050125825900e736c501f859c50fE728c` | 30184 |
| Base Sepolia | `0x6EDCE65403992e310A62460808c4b910D972f10f` | 40245 |

## Deployment Commands

### Base Sepolia (Testnet)

```bash
# Dry run (simulation)
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --private-key $DEPLOYER_PRIVATE_KEY

# Actual deployment
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# With verification
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY
```

### Base Mainnet

⚠️ **WARNING**: This deploys to mainnet with real funds!

```bash
# Dry run (ALWAYS do this first!)
forge script script/Deploy.s.sol \
  --rpc-url base_mainnet \
  --private-key $DEPLOYER_PRIVATE_KEY

# Actual deployment
forge script script/Deploy.s.sol \
  --rpc-url base_mainnet \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# With verification
forge script script/Deploy.s.sol \
  --rpc-url base_mainnet \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY
```

## Role Configuration

The deployment script automatically configures these roles:

### TrustRegistry
- `ORACLE_ROLE` → AgoraMeshEscrow (records transactions)
- `ARBITER_ROLE` → TieredDisputeResolution (slashes stakes)

### NFTBoundReputation
- `ORACLE_ROLE` → AgoraMeshEscrow (records transactions)
- `ARBITER_ROLE` → TieredDisputeResolution (slashes stakes)

## Post-Deployment Verification

### 1. Verify Contract State

```bash
# Check TrustRegistry admin
cast call <TRUST_REGISTRY_ADDRESS> \
  "hasRole(bytes32,address)(bool)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  <ADMIN_ADDRESS> \
  --rpc-url base_sepolia

# Check ORACLE_ROLE granted to Escrow
cast call <TRUST_REGISTRY_ADDRESS> \
  "hasRole(bytes32,address)(bool)" \
  $(cast keccak "ORACLE_ROLE") \
  <ESCROW_ADDRESS> \
  --rpc-url base_sepolia
```

### 2. Verify on Basescan

Visit:
- **Sepolia**: https://sepolia.basescan.org/address/<CONTRACT_ADDRESS>
- **Mainnet**: https://basescan.org/address/<CONTRACT_ADDRESS>

### 3. Test Basic Functionality

```bash
# Register an agent on TrustRegistry (example)
cast send <TRUST_REGISTRY_ADDRESS> \
  "registerAgent(bytes32,string)" \
  0x1234...5678 \
  "ipfs://QmCapabilityCardCID" \
  --rpc-url base_sepolia \
  --private-key $DEPLOYER_PRIVATE_KEY
```

## Gas Estimates

Approximate gas costs for deployment (Base L2 prices are ~1/100th of mainnet):

| Contract | Gas Used | Est. Cost (Base) |
|----------|----------|------------------|
| TrustRegistry | ~2.5M | ~$0.05 |
| ChainRegistry | ~1.5M | ~$0.03 |
| AgoraMeshEscrow | ~2.0M | ~$0.04 |
| TieredDisputeResolution | ~3.0M | ~$0.06 |
| StreamingPayments | ~2.0M | ~$0.04 |
| CrossChainTrustSync | ~2.5M | ~$0.05 |
| VerifiedNamespaces | ~2.0M | ~$0.04 |
| AgentToken | ~3.0M | ~$0.06 |
| NFTBoundReputation | ~2.5M | ~$0.05 |
| **Total** | **~21M** | **~$0.42** |

## Troubleshooting

### "Nonce too low" error
```bash
# Get current nonce
cast nonce <YOUR_ADDRESS> --rpc-url base_sepolia
```

### "Insufficient funds" error
Ensure your deployer address has enough ETH for gas.

### Contract verification failing
1. Ensure `BASESCAN_API_KEY` is set
2. Wait a few blocks after deployment
3. Try manual verification on Basescan

## TimelockController (Governance)

All admin operations are protected by a 24-hour timelock using OpenZeppelin's
`TimelockController`. This prevents instant privilege escalation if an admin
key is compromised — users and agents have 24 hours to react.

### Architecture

```
Proposer (deployer/multisig)
    │
    ▼
TimelockController (24h delay)
    │
    ▼
All AgoraMesh contracts (DEFAULT_ADMIN_ROLE)
```

The `TimelockController` holds `DEFAULT_ADMIN_ROLE` on every contract. The
deployer/multisig has `PROPOSER_ROLE`, `EXECUTOR_ROLE`, and `CANCELLER_ROLE`
on the timelock itself.

### Deploying the Timelock

Run **after** `DeployAll.s.sol` completes:

```bash
# Option 1: Read addresses from deployment JSON
DEPLOYED_ADDRESSES_JSON=../deployments/sepolia.json \
forge script script/DeployTimelock.s.sol \
  --rpc-url base_sepolia \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify

# Option 2: Pass addresses explicitly
forge script script/DeployTimelock.s.sol \
  --rpc-url base_sepolia --broadcast --verify \
  --sig "run(address,address,address,address,address,address,address,address,address)" \
  <trustRegistry> <chainRegistry> <escrow> <disputes> <streaming> \
  <crossChain> <namespaces> <agentToken> <nftReputation>
```

The script:
1. Deploys `TimelockController` with 24h `minDelay`
2. Grants `DEFAULT_ADMIN_ROLE` to the timelock on all 9 contracts
3. Revokes `DEFAULT_ADMIN_ROLE` from the deployer on all 9 contracts

### Performing Admin Operations

After timelock is deployed, all admin calls (e.g., `setTreasury`, `addAllowedToken`,
`grantRole`) must go through the timelock's schedule → wait → execute flow:

```bash
# 1. Schedule (proposer)
cast send <TIMELOCK_ADDRESS> \
  "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" \
  <TARGET_CONTRACT> 0 <ENCODED_CALL> 0x00 <SALT> 86400 \
  --rpc-url base_sepolia --private-key $DEPLOYER_PRIVATE_KEY

# 2. Wait 24 hours

# 3. Execute (executor)
cast send <TIMELOCK_ADDRESS> \
  "execute(address,uint256,bytes,bytes32,bytes32)" \
  <TARGET_CONTRACT> 0 <ENCODED_CALL> 0x00 <SALT> \
  --rpc-url base_sepolia --private-key $DEPLOYER_PRIVATE_KEY
```

### Emergency Cancellation

The `CANCELLER_ROLE` holder can cancel any pending operation before execution:

```bash
cast send <TIMELOCK_ADDRESS> \
  "cancel(bytes32)" <OPERATION_ID> \
  --rpc-url base_sepolia --private-key $DEPLOYER_PRIVATE_KEY
```

### Roles

| Role | Holder | Purpose |
|------|--------|---------|
| `PROPOSER_ROLE` | Deployer/multisig | Schedule admin operations |
| `EXECUTOR_ROLE` | Deployer/multisig | Execute after delay |
| `CANCELLER_ROLE` | Deployer/multisig | Emergency cancel |
| `DEFAULT_ADMIN_ROLE` | TimelockController (self) | Manage timelock roles |

## Security Checklist

Before mainnet deployment:

- [ ] Security audit completed (see `docs/security/audit-preparation.md`)
- [ ] All tests passing (`forge test`)
- [ ] Dry-run deployment successful
- [ ] TimelockController deployed and admin transferred
- [ ] Admin address is a multisig
- [ ] Private keys stored securely (never in code)
- [ ] Rate limits and caps configured appropriately
- [ ] Emergency pause mechanisms understood
- [ ] Deployer DEFAULT_ADMIN_ROLE revoked on all contracts

## Upgradeability

The current contracts are **not upgradeable**. If upgrades are needed:

1. Deploy new contracts
2. Migrate state (if applicable)
3. Update SDK to use new addresses

Consider using UUPS or Transparent Proxy patterns for future versions.
