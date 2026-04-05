# AgoraMesh x402 & ERC-8004 Compliance Audit

**Date:** 2026-04-05
**Auditor:** Polecat fury (automated audit)
**Scope:** Payment layer (x402), Trust layer (ERC-8004), Smart contracts, SDK
**Bead:** ag-k68

---

## Executive Summary

AgoraMesh implements a payment and trust layer for AI agent-to-agent transactions using the x402 micropayment protocol and ERC-8004 Trustless Agents standard. This audit evaluates compliance of the implementation against both specifications.

**Overall Assessment:** The implementation demonstrates solid architectural alignment with both standards. The escrow and streaming payment contracts are well-engineered with proper security patterns. ERC-8004 compliance is achieved through an adapter pattern that maps AgoraMesh's native trust model to the standard's interfaces. Several deviations from the specifications are intentional design choices, while a few represent gaps that should be addressed before mainnet launch.

### Summary Ratings

| Area | Rating | Notes |
|------|--------|-------|
| x402 HTTP 402 Flow | **B+** | Core flow implemented correctly; header format deviates from upstream |
| Escrow Contract | **A-** | Well-structured with strong security; minor spec deviation in release logic |
| Streaming Payments | **A** | Excellent precision handling; Sablier-inspired design is sound |
| Trust Registry (ERC-8004) | **B+** | Good composite score model; stake factor deviates from spec |
| ERC-8004 Adapter | **B** | Three-registry interface coverage; stub implementations for some queries |
| ERC-8004 Bridge | **B+** | Clean dual-registration pattern; feedback write path incomplete |
| Dispute Resolution | **B** | Tiered model matches spec; arbiter selection needs production hardening |
| SDK Payment Client | **A-** | Clean API; good error handling with context |
| SDK x402 Client | **B+** | Correct 402 flow; facilitator integration not wired |
| Fee Model | **A** | Matches spec precisely (0.5%, 70/30 split, min/max) |

---

## 1. x402 Payment Protocol Compliance

### 1.1 HTTP 402 Flow

**Spec (x402.org):** The x402 protocol uses HTTP 402 Payment Required responses to signal payment needs. The flow is:
1. Client sends request to resource server
2. Server returns 402 with payment requirements in response body/headers
3. Client constructs payment, signs it, and retries with payment proof
4. Server verifies payment via a facilitator and serves the resource

**Implementation (sdk/src/x402.ts):**

| Requirement | Status | Details |
|-------------|--------|---------|
| 402 status code detection | PASS | Line 193: `response.status === 402` |
| Payment requirement parsing | PASS | `decodePaymentRequirement()` handles base64 JSON |
| Required fields (network, receiver, amount) | PASS | Validated at line 281 |
| Payment signature creation | PASS | EIP-191 personal sign with structured message |
| Retry with payment header | PASS | Header `x-payment` with base64-encoded payload |
| Payment result parsing | PASS | `x-payment-response` header parsed |
| Expiration check | PASS | Lines 207-213: checks `expiresAt` |
| Amount validation | PASS | Lines 216-230: positive amount + max amount check |
| Nonce for replay protection | PASS | `crypto.randomUUID()` at line 306 |

**Deviations:**

1. **Header naming convention** (MINOR): The implementation uses `x-payment-required`, `x-payment`, and `x-payment-response` headers. The upstream x402 SDK uses `X-PAYMENT` in the request (case-insensitive per HTTP spec, so functionally equivalent). However, the response payment requirements in the official x402 SDK are in the response body, not in a header. The AgoraMesh implementation puts them in the `x-payment-required` header.

   **Risk:** Low. Both approaches work. The header-based approach is simpler for middleware integration.

2. **Payment message format** (MINOR): AgoraMesh uses a custom plaintext message format for signing:
   ```
   x402 Payment Authorization
   Network: eip155:84532
   Receiver: 0x...
   Amount: 0.05
   Token: 0x...
   Timestamp: 1712345678
   Nonce: uuid
   ```
   The official x402 uses EIP-712 typed data for payment authorization. AgoraMesh uses EIP-191 personal sign.

   **Risk:** Medium. EIP-712 provides stronger type safety and is the standard approach. However, AgoraMesh's approach is valid for an independent implementation and the signature is still cryptographically sound. Interoperability with other x402 implementations would require adopting EIP-712.

3. **Facilitator integration** (NOTABLE): The x402 protocol relies on a facilitator service (e.g., `https://x402.cdp.coinbase.com/api/verify`) to verify and settle payments. The AgoraMesh x402 client (`X402Client`) signs payment authorizations but does not interact with a facilitator service. The `facilitatorUrl` field is parsed from payment requirements but never called.

   **Risk:** High for direct x402 interoperability. The current implementation is a self-contained payment authorization system rather than a full x402 facilitator integration. For AgoraMesh-to-AgoraMesh payments this works fine (escrow handles settlement), but it means the SDK cannot directly pay for services from non-AgoraMesh x402 servers that use the Coinbase facilitator.

   **Recommendation:** Implement facilitator API call for upstream x402 compatibility, or clearly document that x402 support is for AgoraMesh's internal use pattern only.

### 1.2 Payment Requirement Format

**Implementation matches spec fields:**

| Field | Present | Type | Notes |
|-------|---------|------|-------|
| `network` | Yes | `string` | Format: `eip155:<chainId>` |
| `receiver` | Yes | `0x${string}` | Payment receiver address |
| `amount` | Yes | `string` | Human-readable USDC amount |
| `token` | Yes | `0x${string}` | Token contract address |
| `description` | Optional | `string` | Payment description |
| `expiresAt` | Optional | `number` | Unix timestamp |
| `facilitatorUrl` | Optional | `string` | Parsed but unused |

### 1.3 x402 Server-Side

The bridge module (`bridge/`) and MCP server handle x402 from the server perspective. The spec document (`docs/specs/payment-layer.md`) shows integration with `@x402/express` middleware and Coinbase's facilitator. The actual bridge implementation would need separate review for server-side compliance.

---

## 2. Escrow Contract Compliance

### 2.1 Contract: AgoraMeshEscrow.sol

**Spec:** `docs/specs/payment-layer.md` defines a 6-state escrow lifecycle: AWAITING_DEPOSIT -> FUNDED -> DELIVERED -> RELEASED/REFUNDED, with DISPUTED as an intermediate state.

| Requirement | Status | Details |
|-------------|--------|---------|
| State machine (6 states) | PASS | Enum matches spec exactly |
| Create escrow with DID validation | PASS | Both agents verified active in TrustRegistry |
| Client DID ownership verification | PASS | Lines 130-131: `clientAgent.owner != msg.sender` |
| Provider DID ownership verification | PASS | Lines 134-135: `providerAgent.owner != providerAddress` |
| Self-dealing prevention | PASS | Lines 138-139: checks both DID and address |
| Fund with SafeERC20 | PASS | `safeTransferFrom` used |
| Confirm delivery (provider only) | PASS | Line 190: `msg.sender != e.providerAddress` |
| Release (client or provider w/ delay) | PASS | Auto-release after 24h delay |
| Timeout refund | PASS | Client can claim after deadline |
| Dispute initiation | PASS | Either party, from FUNDED or DELIVERED |
| Dispute resolution (arbiter only) | PASS | ARBITER_ROLE required |
| Reentrancy protection | PASS | `nonReentrant` on fund/release/refund/resolve |
| Token whitelist | PASS | `_allowedTokens` mapping with admin control |
| Max deadline (90 days) | PASS | `MAX_DEADLINE_DURATION = 90 days` |

**Deviations from spec:**

1. **Release state requirement** (MINOR): The spec (line 278 of payment-layer.md) shows `releaseEscrow` accepting both FUNDED and DELIVERED states. The implementation (line 209) only accepts DELIVERED. This is actually **more secure** than the spec — releasing from FUNDED (before delivery confirmation) would bypass the delivery verification step.

   **Assessment:** Intentional improvement over spec. No action needed.

2. **Dispute resolution providerShare semantics** (MINOR): The spec uses basis points (0-10000) for `providerShare`. The implementation uses absolute token amounts. The contract validates `providerShare <= e.amount` (line 299) rather than `providerShare <= 10000`.

   **Assessment:** Using absolute amounts is clearer and avoids rounding issues. The interface comment should be updated to match.

3. **Fee on dispute resolution** (NOTABLE): Protocol fees are deducted even during dispute resolution (line 312). This means both parties pay the fee even when the dispute was the other party's fault. The spec doesn't explicitly address this case.

   **Risk:** Low. The fee is small (0.5%) and the arbiter determines the split. Could be argued either way.

4. **Abandon escrow** (ADDITION): The contract includes `abandonEscrow()` for unfunded escrows — not in the spec but useful for cleanup.

### 2.2 Protocol Fee Implementation

**Spec (payment-layer.md lines 416-459):**

| Parameter | Spec | Implementation | Match |
|-----------|------|----------------|-------|
| Default fee | 0.5% | `protocolFeeBp` (admin-set, default 0) | PARTIAL — default is 0, must be configured |
| Max fee | 5% | `MAX_FEE_BP = 500` (5%) | PASS |
| Min fee | $0.01 USDC | `MIN_FEE = 10_000` (0.01 USDC in 6 decimals) | PASS |
| Facilitator share | 70% | `FACILITATOR_SHARE_BP = 7_000` | PASS |
| Treasury share | 30% | `fee - facilitatorShare` | PASS |
| Fee on direct x402 | 0% | N/A (direct payments don't go through escrow) | PASS |
| Fee on escrow release | 0.5% | Applied in `_deductAndTransferFee` | PASS |
| Safety cap | Not in spec | `fee > amount / 2` → cap at 50% | ADDITION (good) |

**Note:** The `protocolFeeBp` defaults to 0 on deployment. Admin must call `setProtocolFeeBp(50)` to set the 0.5% fee. This is a deployment configuration issue, not a code bug.

---

## 3. Streaming Payments Compliance

### 3.1 Contract: StreamingPayments.sol

**Spec:** `docs/specs/payment-layer.md` describes Sablier-inspired linear streaming.

| Requirement | Status | Details |
|-------------|--------|---------|
| Linear streaming (deposit/duration) | PASS | Rate = deposit / duration |
| Precision handling | PASS | `PRECISION = 1e18` scaled rate prevents precision loss |
| Withdraw (specific amount) | PASS | Validates against withdrawable |
| Withdraw max | PASS | Withdraws all available |
| Top-up (extend duration) | PASS | Maintains rate, extends end time |
| Pause/Resume | PASS | Adjusts end time for pause duration |
| Cancel with proportional split | PASS | Streamed to recipient, remainder to sender |
| Stream status tracking | PASS | NONE/ACTIVE/PAUSED/CANCELED/COMPLETED |
| Cancellability flags | PASS | Per-sender and per-recipient flags |
| Protocol fee on withdraw | PASS | Same fee structure as escrow |
| No fee on sender refund | PASS | Line 353: refund transferred without fee deduction |
| Reentrancy protection | PASS | `nonReentrant` on all state-changing functions |
| Sender DID validation | PASS | Resolved via TrustRegistry.getAgentByOwner |

**Deviations:**

1. **Scaled rate precision** (NOTABLE - POSITIVE): The implementation uses `_scaledRatePerSecond` with 1e18 precision to prevent rounding errors in streaming calculations. The spec doesn't specify this level of precision. This is a significant improvement that prevents token loss on long-running streams.

2. **Pause duration accounting** (CORRECT): The `_adjustedEndTime` function correctly handles both historical pauses (already accounted for in `endTime` by `resume()`) and current ongoing pauses. This is a subtle correctness point that is implemented well.

3. **Facilitator address** (ADDITION): Not in the original streaming spec, but consistent with the escrow fee model. Enables node operators to earn fees from streams they facilitate.

---

## 4. Trust Registry & ERC-8004 Compliance

### 4.1 Contract: TrustRegistry.sol

**Spec:** `docs/specs/trust-layer.md` defines the trust score formula and parameters.

#### Trust Score Formula

**Spec formula:**
```
trust_score = 0.50 * reputation + 0.30 * stake_factor + 0.20 * endorsement_score
```

**Implementation (`_calculateTrustDetails`, line 517):**
```solidity
compositeScore = (reputationScore * REPUTATION_WEIGHT + stakeScore * STAKE_WEIGHT + endorsementScore * ENDORSEMENT_WEIGHT) / BASIS_POINTS;
```
Where: `REPUTATION_WEIGHT = 5000`, `STAKE_WEIGHT = 3000`, `ENDORSEMENT_WEIGHT = 2000`

| Component | Match | Notes |
|-----------|-------|-------|
| Weights (50/30/20) | PASS | Constants match spec |
| Score range (0-10000) | PASS | Basis points representation |

#### Reputation Component

| Spec Element | Implementation | Match |
|-------------|----------------|-------|
| Success rate | `(successful * 10000) / total` | PASS |
| Volume factor (log scale, cap $1M) | Linear scale, cap $100k | DEVIATION |
| Recency decay (5% per 14 days) | Not in `_calculateReputationScore` | DEVIATION |
| Dispute penalty (-10% per loss) | Not in `_calculateReputationScore` | DEVIATION |
| Transaction count factor | `totalTransactions * 10`, cap 1000 | ADDITION |

**Deviations:**

1. **Volume factor** (MODERATE): The spec uses logarithmic scaling (`log10(volume + 1) / 6`) capped at $1M. The implementation uses linear scaling capped at $100k. This means:
   - An agent with $10,000 volume gets `100/1000 = 10%` in implementation vs `log10(10001)/6 ≈ 67%` in spec
   - The implementation under-rewards moderate-volume agents compared to spec

   **Recommendation:** Consider implementing logarithmic scaling for better alignment with the spec's intent to give diminishing returns at higher volumes.

2. **Recency decay** (MODERATE): The spec defines 5% decay per 14 days of inactivity. The spec's `IAgoraMeshTrustRegistry` implementation example includes decay, but the actual `TrustRegistry.sol` implementation's `_calculateReputationScore` does NOT apply recency decay. The reputation score is recalculated only when `recordTransaction` is called, based on cumulative stats.

   **Impact:** Agents who stop transacting will retain their reputation score indefinitely, contrary to the spec's intent. The spec shows decay in the example but the deployed contract doesn't implement it.

   **Note:** The spec's `_calculateReputation` example (line 319 of trust-layer.md) does show decay implementation, but this is in the spec's example code, not in the actual deployed contract.

   **Recommendation:** Add decay calculation to `getTrustScore` and `getTrustDetails` view functions, or accept this as a conscious simplification for on-chain gas efficiency.

3. **Dispute penalty** (MINOR): The spec mentions `-10% per dispute loss`. The implementation does not track dispute losses or apply a penalty to reputation. Disputes are recorded as failed transactions via `_recordTransaction(providerDid, amount, false)` in the escrow contract, which affects the success rate.

   **Assessment:** The success rate naturally decreases with failed transactions, providing an indirect penalty. This is a reasonable simplification.

#### Stake Factor

| Spec Element | Implementation | Match |
|-------------|----------------|-------|
| Reference stake ($10,000) | `REFERENCE_STAKE = 10_000 * 1e6` | PASS |
| Scaling (sqrt in spec) | Linear scaling in contract | DEVIATION |
| Minimum stake ($100) | `MINIMUM_STAKE = 100 * 1e6` | PASS |
| Cooldown (7 days) | `STAKE_COOLDOWN = 7 days` | PASS |

**Deviation - Stake factor scaling** (MODERATE): The spec defines `stake_factor = min(1.0, sqrt(staked_amount / 10000))`. The implementation uses linear scaling: `stakeScore = (stakedAmount * 10000) / REFERENCE_STAKE`. This means:
- At $2,500 stake: spec gives `sqrt(0.25) = 50%`, implementation gives `25%`
- At $5,000 stake: spec gives `sqrt(0.5) ≈ 70.7%`, implementation gives `50%`

The square root function provides more benefit to smaller stakers, incentivizing participation. Linear scaling requires larger absolute stakes for the same score.

**Recommendation:** Consider implementing `sqrt` via a fixed-point math library (e.g., PRBMath) for closer spec alignment. The current approach is valid but changes incentive dynamics.

#### Endorsement Score

| Spec Element | Implementation | Match |
|-------------|----------------|-------|
| Max endorsements | 10 | PASS |
| Endorsement cooldown | 24 hours | PASS |
| Self-endorsement prevention | PASS | `CannotEndorseSelf` error |
| Max hops (3) | Not implemented (1 hop only) | DEVIATION |
| Decay per hop (10%) | Not implemented | DEVIATION |
| Normalization (/ 3.0) | Score = countScore + qualityScore | DIFFERENT |

**Deviation - Web-of-Trust hops** (NOTABLE): The spec defines a transitive trust model with up to 3 hops and 10% decay per hop. The implementation only considers direct endorsements (1 hop). This simplification:
- Eliminates the computational complexity of graph traversal on-chain
- Reduces the endorsement score's ability to bootstrap new agents via referral chains
- Is a reasonable trade-off for on-chain computation

**Assessment:** Acceptable simplification. A 3-hop traversal on-chain would be gas-prohibitive. Consider implementing multi-hop endorsement scoring off-chain (in the node or SDK) and using the on-chain version as a fallback.

### 4.2 ERC-8004 Adapter (ERC8004Adapter.sol)

The adapter implements three ERC-8004 interfaces:

| Interface | Implementation Status | Notes |
|-----------|----------------------|-------|
| `IERC8004IdentityRegistry` | FULL | register, setAgentURI, setMetadata, getMetadata, getAgentWallet |
| `IERC8004ReputationRegistry` | PARTIAL | getSummary works; readFeedback, getClients, getLastIndex return stubs |
| `IERC8004ValidationRegistry` | PARTIAL | getSummary works; getValidationStatus, getAgentValidations return stubs |

**Findings:**

1. **Dual registration** (PASS): When a canonical ERC-8004 IdentityRegistry is configured, `register()` creates agents on both AgoraMesh and the canonical registry with bidirectional ID mapping.

2. **Feedback relay** (PASS): `relayFeedback()` converts signed ERC-8004 feedback values (int128) to AgoraMesh's binary success/fail model. Positive values map to success, zero/negative to failure. This is a reasonable simplification given AgoraMesh's binary transaction model.

3. **Stub implementations** (ACCEPTABLE): `readFeedback()`, `getClients()`, `getLastIndex()` return empty/zero values. This is documented in the contract and is acceptable because AgoraMesh tracks aggregate reputation, not per-client feedback entries.

4. **Validation summary** (PASS): Maps composite trust score > 5000 to "valid" (1) and <= 5000 to "invalid" (2). Agents with no trust data return "pending" (0). Simple but functional.

5. **MetadataSet event** (BUG - MINOR): Line 187 emits `MetadataSet(agentId, metadataKey, metadataKey, metadataValue)` — the `indexedMetadataKey` and `metadataKey` parameters are the same string. Per the ERC-8004 interface, this is correct since both should be the same key (one indexed for filtering, one non-indexed for reading).

### 4.3 ERC-8004 Bridge (ERC8004Bridge.sol)

| Feature | Status | Notes |
|---------|--------|-------|
| Agent registration on official registry | PASS | Calls `identityRegistry.register()` |
| URI update forwarding | PASS | Calls `identityRegistry.setAgentURI()` |
| Bidirectional ID mapping | PASS | `agoraMeshToERC8004` and `erc8004ToAgoraMesh` |
| Feedback submission | PARTIAL | Emits event but does not call registry write function |
| Validation submission | PARTIAL | Emits event only (future integration) |
| Metadata query forwarding | PASS | Reads from canonical registry |
| Reputation summary query | PASS | Queries canonical ReputationRegistry |

**Finding - Feedback write gap** (MODERATE): `submitFeedback()` (line 139) queries `getLastIndex` but only emits a `FeedbackSubmitted` event. It does not call a write function on the ReputationRegistry. The comment explains this is because "the official ReputationRegistry [doesn't yet] expose a submitFeedback() function." This means feedback submitted through the bridge is only observable via events, not stored in the canonical registry.

**Recommendation:** Monitor the ERC-8004 ReputationRegistry for a `submitFeedback()` function and implement the forward call when available.

---

## 5. Dispute Resolution Compliance

### 5.1 Contract: TieredDisputeResolution.sol

**Spec:** `docs/specs/dispute-resolution.md`

| Requirement | Status | Details |
|-------------|--------|---------|
| Tier 1: Auto (< $10) | PASS | `TIER1_MAX = 10 * 1e6` |
| Tier 2: AI-Assisted ($10-$1k) | PASS | `TIER2_MAX = 1000 * 1e6` |
| Tier 3: Community (> $1k) | PASS | Everything above TIER2_MAX |
| Evidence period (48h) | PASS | `EVIDENCE_PERIOD = 48 hours` |
| Voting period (24h) | PASS | `VOTING_PERIOD = 24 hours` |
| Appeal period (48h) | PASS | `APPEAL_PERIOD = 48 hours` |
| Tier 2 fee (3%, min $5) | PASS | Constants match spec |
| Tier 3 fee (5%, min $50) | PASS | Constants match spec |
| Max 4 appeal rounds | PASS | `d.appealRound >= 4` check |
| Arbiter count scaling | PASS | 3/5/11/23/47 per spec |
| Quorum (2/3 of arbiters) | PASS | `ceil(2/3)` calculation |
| Three vote types | PASS | FAVOR_CLIENT, FAVOR_PROVIDER, SPLIT |
| Auto-resolution (Tier 1) | PASS | Evidence-based: no provider evidence = refund |
| Fee distribution to arbiters | PASS | 50% of dispute fee split among voters |

**Deviations:**

1. **Arbiter selection** (NOTABLE): The spec calls for weighted random selection based on stake * trust, using `blockhash` as randomness. The implementation uses a simple sequential scan of `_eligibleArbiters` array. This is explicitly marked as a placeholder:
   ```solidity
   // In production: weighted random selection from TrustRegistry with Chainlink VRF
   ```

   **Risk:** HIGH for production. Sequential selection is:
   - Predictable (anyone can see who will be selected)
   - Not stake-weighted (all arbiters equally likely)
   - Admin-controlled (only admin can register arbiters)

   **Recommendation:** Before mainnet, implement Chainlink VRF or commit-reveal scheme for arbiter selection. This is a critical security requirement for fair dispute resolution.

2. **Fee distribution** (DEVIATION): The spec says:
   - 70% to winning jurors
   - 20% to protocol treasury
   - 10% to AI model maintenance

   The implementation gives 50% of the dispute fee equally to all voters (not just winning jurors), with no distinction between majority/minority voters. The remaining 50% stays in `feePool` for admin withdrawal.

   **Impact:** Reduces incentive for jurors to vote with the majority (Schelling point mechanism). The spec's model rewards majority voters to encourage honest coordination.

   **Recommendation:** Implement majority-only reward distribution as specified.

3. **Slash on minority vote** (MISSING): The spec says minority voters lose 10% of their stake. The implementation does not slash minority voters.

   **Impact:** Without economic penalties for minority voting, the Schelling point mechanism is weakened.

4. **Trust score update after dispute** (PARTIAL): The spec defines specific trust impacts (+2% for winning provider, -10% for loser, etc.). The implementation records the outcome as a transaction (successful if provider got majority, failed otherwise) via `_recordTransaction` in the escrow contract. This provides indirect reputation impact but not the specific percentages defined in the spec.

---

## 6. SDK Compliance

### 6.1 PaymentClient (sdk/src/payment.ts)

| Feature | Status | Notes |
|---------|--------|-------|
| Create escrow | PASS | All params correctly mapped |
| Fund with auto-approve | PASS | Checks allowance, approves if needed |
| Confirm delivery | PASS | Provider-side operation |
| Release escrow | PASS | Client releases funds |
| Claim timeout | PASS | After deadline |
| Initiate dispute | PASS | With evidence bytes |
| Error handling | PASS | Custom error classes with context |
| ABI correctness | PASS | Matches contract interface exactly |

**Note:** The SDK ABI includes `facilitator` field in the `getEscrow` return type (line 109) — correctly reflects the contract's `Escrow` struct.

### 6.2 X402Client (sdk/src/x402.ts)

| Feature | Status | Notes |
|---------|--------|-------|
| 402 detection | PASS | |
| Payment requirement decode | PASS | Base64 JSON |
| Amount validation | PASS | Positive + max check |
| Expiration check | PASS | |
| Signature creation | PASS | EIP-191 personal sign |
| Payload encoding | PASS | Base64 JSON |
| Payment result parsing | PASS | |
| Fetch wrapper | PASS | `createFetchWrapper()` |
| Replay protection | PASS | UUID nonce |

### 6.3 StreamingPaymentClient (sdk/src/streaming.ts)

| Feature | Status | Notes |
|---------|--------|-------|
| Create stream (duration) | PASS | |
| Create stream (timestamps) | PASS | |
| Withdraw / withdrawMax | PASS | |
| Top-up | PASS | With auto-approve |
| Pause / Resume | PASS | |
| Cancel | PASS | |
| Stream health monitoring | PASS | HEALTHY/WARNING/STUCK/COMPLETED |
| Cancellation preview | PASS | Shows distribution before canceling |
| Facilitator support | PASS | Passed to contract |

---

## 7. Security Considerations

### 7.1 Smart Contract Security

| Check | Status | Notes |
|-------|--------|-------|
| Reentrancy protection | PASS | `nonReentrant` on all transfer functions |
| SafeERC20 usage | PASS | All token transfers use SafeERC20 |
| Access control | PASS | AccessControlEnumerable with proper roles |
| Integer overflow | PASS | Solidity 0.8.24 has built-in overflow checks |
| Checks-Effects-Interactions | PASS | State updated before transfers |
| Self-dealing prevention | PASS | Client != Provider validated |
| Deadline validation | PASS | Must be future, max 90 days |
| Token whitelist | PASS | Only admin-approved tokens accepted |
| Withdrawal race condition | PASS | `requestWithdraw` subtracts from stakedAmount immediately |

### 7.2 Potential Issues

1. **Escrow ID 0 sentinel** (LOW): `_getEscrow` uses `e.id == 0` as the "not found" check. Since `_nextEscrowId` starts at 0 and uses pre-increment (`++_nextEscrowId`), the first escrow gets ID 1. This is correct but relies on the implementation detail.

2. **Fee minimum on small amounts** (LOW): For very small escrows (< $2 USDC), the minimum fee of $0.01 could represent > 0.5% of the amount. The safety cap (`fee > amount / 2`) prevents excessive fees, but the economic incentive to use escrow for micro-transactions is reduced.

3. **TrustRegistry ORACLE_ROLE coupling** (MODERATE): The escrow contract silently catches failures when recording transactions to TrustRegistry (lines 487-494). If the escrow contract doesn't have ORACLE_ROLE, reputation updates are silently skipped. This is a deployment configuration dependency.

4. **Streaming precision edge case** (LOW): When `depositAmount` is not evenly divisible by `duration`, the scaled rate ensures accuracy for mid-stream calculations, but the final `streamedAmountOf` at `endTime` returns `depositAmount` directly (line 397), preventing dust loss.

---

## 8. Spec vs Implementation Comparison Matrix

| Spec Requirement | Location | Implementation Status | Severity |
|-----------------|----------|----------------------|----------|
| x402 HTTP 402 flow | sdk/src/x402.ts | Implemented (custom header format) | LOW |
| x402 facilitator verification | sdk/src/x402.ts | NOT IMPLEMENTED | MODERATE |
| Escrow lifecycle (6 states) | contracts/src/AgoraMeshEscrow.sol | Fully implemented | N/A |
| Protocol fee (0.5%, 70/30) | AgoraMeshEscrow + StreamingPayments | Implemented (needs config) | LOW |
| Trust score formula (50/30/20) | contracts/src/TrustRegistry.sol | Implemented | N/A |
| Reputation decay (5% per 14d) | contracts/src/TrustRegistry.sol | NOT IMPLEMENTED | MODERATE |
| Stake factor (sqrt scaling) | contracts/src/TrustRegistry.sol | Linear instead of sqrt | MODERATE |
| Web-of-trust (3 hops) | contracts/src/TrustRegistry.sol | 1 hop only | LOW |
| ERC-8004 IdentityRegistry | contracts/src/ERC8004Adapter.sol | Full | N/A |
| ERC-8004 ReputationRegistry | contracts/src/ERC8004Adapter.sol | Partial (stubs for per-client) | LOW |
| ERC-8004 ValidationRegistry | contracts/src/ERC8004Adapter.sol | Partial (stubs) | LOW |
| ERC-8004 dual registration | contracts/src/ERC8004Adapter.sol | Full | N/A |
| ERC-8004 feedback relay | contracts/src/ERC8004Adapter.sol | Full | N/A |
| Dispute Tier 1 (auto) | contracts/src/TieredDisputeResolution.sol | Implemented | N/A |
| Dispute Tier 2 (AI-assisted) | contracts/src/TieredDisputeResolution.sol | Implemented | N/A |
| Dispute Tier 3 (community) | contracts/src/TieredDisputeResolution.sol | Implemented | N/A |
| Arbiter weighted random selection | contracts/src/TieredDisputeResolution.sol | Sequential (placeholder) | HIGH |
| Dispute fee distribution (70/20/10) | contracts/src/TieredDisputeResolution.sol | 50/50 (all voters/admin) | MODERATE |
| Minority voter slashing | contracts/src/TieredDisputeResolution.sol | NOT IMPLEMENTED | MODERATE |
| Streaming payments | contracts/src/StreamingPayments.sol | Full with precision improvements | N/A |

---

## 9. Recommendations

### Critical (Before Mainnet)

1. **Implement proper arbiter selection** — Replace sequential scan with Chainlink VRF or commit-reveal scheme for unpredictable, stake-weighted selection
2. **Configure protocol fees on deployment** — Ensure `setProtocolFeeBp(50)` is called during deployment scripts
3. **Grant ORACLE_ROLE to Escrow** — Ensure escrow contract has ORACLE_ROLE on TrustRegistry for reputation tracking

### Important (Should Fix)

4. **Implement reputation decay** — Add time-based decay to `getTrustScore` view functions or accept as documented deviation
5. **Implement sqrt for stake factor** — Use PRBMath or similar for spec-compliant diminishing returns
6. **Implement majority-only dispute rewards** — Reward only majority voters per Schelling point mechanism
7. **Add minority voter slashing** — Slash minority voters' stake to strengthen incentive alignment

### Nice to Have

8. **x402 facilitator integration** — Add Coinbase facilitator API call for upstream x402 interoperability
9. **EIP-712 typed data signing** — Migrate from EIP-191 to EIP-712 for x402 payment signatures
10. **Multi-hop endorsement scoring** — Implement off-chain 3-hop endorsement calculation with on-chain fallback

---

## 10. Conclusion

AgoraMesh's payment and trust layer demonstrates strong engineering fundamentals. The escrow and streaming payment contracts are well-secured with proper reentrancy protection, access control, and state management. The ERC-8004 adapter pattern is a pragmatic approach to standards compliance that preserves AgoraMesh's native trust model while exposing standard interfaces.

The primary gaps are in dispute resolution (arbiter selection needs production hardening) and trust score calculation (deviations from spec in decay, stake scaling, and multi-hop endorsements). These are solvable before mainnet and don't represent fundamental architectural issues.

The x402 integration is functional for AgoraMesh-internal use but lacks the facilitator API integration needed for interoperability with the broader x402 ecosystem. This should be prioritized if cross-platform agent payments are a goal.

**Overall Compliance Rating: B+ (Good — Production-ready for testnet, needs hardening for mainnet)**
