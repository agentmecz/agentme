# MCP Server & DID/W3C Standards Compliance Audit

**Date:** 2026-04-05
**Auditor:** Polecat dust (automated)
**Scope:** MCP protocol compliance, W3C DID Core compliance
**Bead:** ag-rwb

---

## Executive Summary

The AgoraMesh MCP server and DID implementations are **substantially compliant** with their respective specifications. The MCP server delegates protocol handling to the official `@modelcontextprotocol/sdk` (v1.27.1), which provides strong baseline compliance. The DID implementation follows W3C DID Core 1.0 closely, with a few gaps noted below.

**Overall Ratings:**

| Area | Rating | Notes |
|------|--------|-------|
| MCP Transport (Streamable HTTP) | A | Delegated to official SDK |
| MCP Tool Schemas | A | Well-structured, proper annotations |
| MCP Session Management | A- | Good limits; missing explicit DELETE handling |
| MCP Authentication | B+ | Bearer token, constant-time comparison; not spec-mandated |
| MCP Discovery (.well-known) | B | Custom format, not yet a finalized MCP standard |
| DID Document Structure | A- | W3C-compliant; timestamps use Unix not ISO 8601 |
| DID Syntax (did:agoramesh) | A | Correct 4-part format |
| DID Resolution | A- | Correct 3-part structure; metadata timestamps non-standard |
| DID Validation (SDK) | B- | Regex patterns too restrictive for did:web and did:agoramesh |
| Verifiable Credentials | N/A | Not implemented |

---

## 1. MCP Protocol Compliance

### 1.1 Transport: Streamable HTTP

**Spec reference:** MCP Specification 2025-03-26, Transports section

**Implementation:** `mcp/src/http.ts`, `mcp/src/http-handler.ts`

The server uses `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`, the official MCP SDK transport. This delegates all protocol-level handling (JSON-RPC framing, SSE streaming, session negotiation) to the SDK.

| Requirement | Status | Details |
|-------------|--------|---------|
| POST /mcp for requests | PASS | `http-handler.ts:113` handles POST to `/mcp` |
| JSON-RPC 2.0 framing | PASS | Delegated to SDK `StreamableHTTPServerTransport` |
| Mcp-Session-Id header | PASS | Session ID generated via `randomUUID()`, tracked in `sessions` Map |
| SSE for streaming responses | PASS | Handled by SDK transport |
| Graceful shutdown | PASS | `http.ts:28-52` handles SIGINT/SIGTERM with 30s timeout |

**Rating: A**

The stdio transport (`mcp/src/cli.ts`) is also properly implemented using `StdioServerTransport`.

### 1.2 Tool Schemas

**Spec reference:** MCP Specification, Tools section

Six tools are registered:

| Tool | Input Schema | Annotations | Description |
|------|-------------|-------------|-------------|
| `search_agents` | query (string, required), min_trust (number, optional), limit (number, optional) | readOnlyHint, idempotentHint, openWorldHint | Search agents by capability |
| `get_agent` | did (string, required) | readOnlyHint, idempotentHint, openWorldHint | Get agent details by DID |
| `check_trust` | did (string, required) | readOnlyHint, idempotentHint, openWorldHint | Check trust score breakdown |
| `list_agents` | limit (number, optional) | readOnlyHint, idempotentHint, openWorldHint | List all registered agents |
| `hire_agent` | agent_did (string), prompt (string), task_type (string, optional), timeout (number, optional) | destructiveHint, openWorldHint | Submit task to agent via bridge |
| `check_task` | task_id (string) | readOnlyHint, idempotentHint, openWorldHint | Check task status |

| Requirement | Status | Details |
|-------------|--------|---------|
| Tool name (string) | PASS | All six tools have snake_case names |
| Description (string) | PASS | All tools have clear, detailed descriptions |
| inputSchema (JSON Schema via Zod) | PASS | All use `z.object()` with typed, described parameters |
| Annotations (hints) | PASS | All tools provide behavioral annotations |
| Return format (content array) | PASS | All return `{ content: [{ type: 'text', text: ... }] }` |
| Error handling (isError flag) | PASS | All catch blocks return `{ isError: true, content: [...] }` |

**Rating: A**

**Minor observation:** The `hire_agent` tool correctly marks `destructiveHint: true` (it triggers execution and payment), while read-only tools correctly use `readOnlyHint: true`. This is good practice for MCP clients to distinguish safe from side-effecting operations.

### 1.3 Session Management

**Implementation:** `mcp/src/http-handler.ts`

| Requirement | Status | Details |
|-------------|--------|---------|
| Session creation | PASS | New `StreamableHTTPServerTransport` per session, ID via `randomUUID()` |
| Session tracking | PASS | `sessions` Map keyed by session ID |
| Session limit | PASS | `MAX_SESSIONS = 100`, returns 503 when exceeded |
| Session timeout | PASS | `SESSION_TIMEOUT_MS = 30 min`, cleanup every 5 min |
| Session cleanup | PASS | Timer-based cleanup of idle sessions, `cleanupTimer.unref()` |
| Session close callback | PASS | `transport.onclose` removes session from maps |

**Potential gap:** The MCP Streamable HTTP spec defines that clients MAY send a DELETE request to terminate a session. The current implementation only routes POST to the `/mcp` endpoint. However, since `transport.handleRequest()` is called for all methods that reach the `/mcp` path, and the SDK handles DELETE internally, this is likely handled correctly by the SDK. The CORS preflight does allow DELETE method (`http-handler.ts:97`).

**Rating: A-**

### 1.4 Server Information

| Requirement | Status | Details |
|-------------|--------|---------|
| Server name | PASS | `"agoramesh"` (`index.ts:24`) |
| Server version | PASS | `"0.1.0"` (`index.ts:25`) |
| Capabilities declaration | PASS | `{ tools: {} }` in well-known response |

### 1.5 Authentication

The MCP specification does not mandate a specific authentication mechanism. AgoraMesh implements optional Bearer token auth:

| Aspect | Status | Details |
|--------|--------|---------|
| Optional (env-configured) | PASS | Only enforced if `AGORAMESH_MCP_AUTH_TOKEN` is set |
| Constant-time comparison | PASS | Uses `crypto.timingSafeEqual()` for token comparison |
| Length-mismatch handling | PASS | Performs dummy comparison to maintain constant time |
| Error response | PASS | Returns JSON-RPC error with code -32600 |

**Rating: B+** — Good security practices, but the length-mismatch dummy comparison (`timingSafeEqual(buf, buf)`) doesn't prevent timing side-channels on the length itself (the attacker knows the comparison was faster than a real match). Consider hashing both tokens before comparison to equalize lengths.

### 1.6 Well-Known Discovery

**Implementation:** `http-handler.ts:106-109`

```json
{
  "mcpServers": {
    "agoramesh": {
      "url": "https://api.agoramesh.ai/mcp",
      "capabilities": { "tools": {} }
    }
  }
}
```

The `.well-known/mcp.json` endpoint is a convention that is gaining adoption but is not yet part of the core MCP specification. The format follows the emerging convention used by MCP client implementations.

**Rating: B** — Functional, follows convention. No formal spec to audit against yet.

### 1.7 Error Handling

| JSON-RPC Error Code | Used For | Spec Compliance |
|---------------------|----------|-----------------|
| -32700 | Parse error (invalid JSON) | PASS (standard JSON-RPC) |
| -32600 | Invalid request (auth failure, body too large) | PASS (standard JSON-RPC) |
| -32603 | Internal error, session limit | PASS (standard JSON-RPC) |

**Rating: A**

### 1.8 Request Body Limits

Request bodies are limited to 1MB (configurable via `maxBodySize`). Oversized requests receive a 413 response with a JSON-RPC error. This is good defensive practice not mandated by MCP but important for production deployments.

---

## 2. W3C DID Core Compliance

### 2.1 DID Syntax: `did:agoramesh`

**Spec reference:** W3C DID Core 1.0, Section 3.1 — DID Syntax

**Implementation:** `node/src/did.rs`

The `did:agoramesh` method uses a 4-part format: `did:agoramesh:{chain}:{identifier}`

| Requirement | Status | Details |
|-------------|--------|---------|
| Scheme `did:` | PASS | Validated in `parse_did()` (`did.rs:291`) |
| Method name (lowercase) | PASS | `DID_METHOD = "agoramesh"` (all lowercase) |
| Method-specific ID | PASS | `{chain}:{identifier}` — colon-separated |
| DID is a URI | PASS | Conforms to `did:method-name:method-specific-id` |

**W3C DID Core ABNF:**
```
did = "did:" method-name ":" method-specific-id
method-name = 1*method-char
method-char = %x61-7A / DIGIT  ; a-z, 0-9
method-specific-id = *( *idchar ":" ) 1*idchar
idchar = ALPHA / DIGIT / "." / "-" / "_" / pct-encoded
```

The method name `agoramesh` conforms (lowercase only). The method-specific ID `{chain}:{identifier}` conforms — the colon separator is allowed by the production rule `*( *idchar ":" ) 1*idchar`.

**Rating: A**

### 2.2 DID Document Structure

**Implementation:** `node/src/did.rs`, struct `DIDDocument`

| Property | W3C Requirement | Implementation | Status |
|----------|----------------|----------------|--------|
| `@context` | REQUIRED, first value MUST be `https://www.w3.org/ns/did/v1` | `vec!["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/ed25519-2020/v1"]` | PASS |
| `id` | REQUIRED, MUST be a valid DID | Set to `did:agoramesh:{chain}:{identifier}` | PASS |
| `controller` | OPTIONAL | `Option<Vec<String>>` | PASS |
| `verificationMethod` | OPTIONAL | `Option<Vec<VerificationMethod>>` | PASS |
| `authentication` | OPTIONAL | `Option<Vec<String>>` (references) | PASS |
| `assertionMethod` | OPTIONAL | `Option<Vec<String>>` | PASS |
| `service` | OPTIONAL | `Option<Vec<ServiceEndpoint>>` | PASS |
| `keyAgreement` | OPTIONAL | Not implemented | OK (optional) |
| `capabilityInvocation` | OPTIONAL | Not implemented | OK (optional) |
| `capabilityDelegation` | OPTIONAL | Not implemented | OK (optional) |
| `alsoKnownAs` | OPTIONAL | Not implemented | OK (optional) |

**Non-standard extension:** The `metadata` field (`DIDMetadata`) is an AgoraMesh-specific extension containing `chain_id`, `trust_registry`, `capability_card_url`, `created`, and `updated`. W3C DID Core allows additional properties in DID Documents, but they SHOULD be registered in the DID Specification Registries. This extension is acceptable but should be documented.

**Rating: A-**

### 2.3 @context Requirements

**W3C DID Core Section 4.1:** The value of `@context` MUST be an ordered set where the first item is `https://www.w3.org/ns/did/v1`.

**Implementation (did.rs:250-253):**
```rust
context: vec![
    "https://www.w3.org/ns/did/v1".to_string(),
    "https://w3id.org/security/suites/ed25519-2020/v1".to_string(),
],
```

| Requirement | Status |
|-------------|--------|
| First element is `https://www.w3.org/ns/did/v1` | PASS |
| Additional contexts for verification suites | PASS (`ed25519-2020/v1`) |
| Type is ordered set (array) | PASS |

**Issue:** The Ed25519 context is always included even when no Ed25519 keys are present. The context should ideally be conditional — include `ed25519-2020/v1` only when Ed25519 verification methods are used. Including unused contexts is not a spec violation but increases document size unnecessarily.

**Rating: A-**

### 2.4 Verification Methods

**Implementation:** `node/src/did.rs`, struct `VerificationMethod`

| Property | W3C Requirement | Implementation | Status |
|----------|----------------|----------------|--------|
| `id` | REQUIRED, MUST be a DID URL | `format!("{}#{}", did, key_id)` | PASS |
| `type` | REQUIRED | `method_type` field (renamed to `type` via serde) | PASS |
| `controller` | REQUIRED, MUST be a DID | Set to the DID of the document | PASS |
| `publicKeyMultibase` | OPTIONAL | Supported for Ed25519 keys | PASS |
| `publicKeyJwk` | OPTIONAL | Supported (`serde_json::Value`) | PASS |
| `blockchainAccountId` | OPTIONAL | Supported, uses CAIP-10 format | PASS |

**Supported verification method types:**
- `Ed25519VerificationKey2020` — with `publicKeyMultibase` (correct pairing)
- `EcdsaSecp256k1RecoveryMethod2020` — with `blockchainAccountId` in CAIP-10 format (correct pairing)

**Validation (`did.rs:312-330`):**
- Verification method IDs must start with the document's DID ✅
- Controller must match the document's DID ✅

**Rating: A**

### 2.5 Service Endpoints

**Implementation:** `node/src/did.rs`, struct `ServiceEndpoint`

| Property | W3C Requirement | Implementation | Status |
|----------|----------------|----------------|--------|
| `id` | REQUIRED, MUST be a URI | `format!("{}#{}", did, fragment)` | PASS |
| `type` | REQUIRED | `service_type` field (renamed to `type`) | PASS |
| `serviceEndpoint` | REQUIRED | Single string URL | PARTIAL |

**W3C note on `serviceEndpoint`:** The spec says it MUST be a string, a map, or a set composed of one or more strings and/or maps. The implementation uses a single string, which is valid for the current use cases but doesn't support the full polymorphic type.

**Service types defined:**
- `A2AAgent` — A2A Protocol endpoint
- `CapabilityCard` — AgoraMesh Capability Card URL

**Validation (`did.rs:335-344`):** Service IDs must start with the document's DID ✅

**Rating: A-**

### 2.6 DID Resolution

**Spec reference:** W3C DID Core Section 7.1 — DID Resolution

**Implementation:** `node/src/did.rs`, structs `DIDResolutionResult`, `DIDResolutionMetadata`, `DIDDocumentMetadata`

The resolution result follows the required 3-part structure:

| Component | W3C Requirement | Implementation | Status |
|-----------|----------------|----------------|--------|
| `didDocument` | The resolved document (or null on error) | `Option<DIDDocument>` | PASS |
| `didResolutionMetadata` | REQUIRED | `DIDResolutionMetadata` | PASS |
| `didDocumentMetadata` | REQUIRED (may be empty) | `Option<DIDDocumentMetadata>` | PASS |

**Resolution Metadata:**

| Field | W3C Status | Implementation | Status |
|-------|-----------|----------------|--------|
| `contentType` | REQUIRED on success | `Some("application/did+ld+json")` | PASS |
| `error` | On failure | Supported: `notFound`, `invalidDid` | PASS |
| `message` | Extension | Human-readable error message | PASS (extension) |

**Document Metadata:**

| Field | W3C Status | Implementation | Status |
|-------|-----------|----------------|--------|
| `created` | OPTIONAL | `Option<String>` | ISSUE |
| `updated` | OPTIONAL | `Option<String>` | ISSUE |
| `deactivated` | OPTIONAL | `Option<bool>` | PASS |
| `versionId` | OPTIONAL | Not implemented | OK |
| `nextVersionId` | OPTIONAL | Not implemented | OK |
| `equivalentId` | OPTIONAL | Not implemented | OK |
| `canonicalId` | OPTIONAL | Not implemented | OK |

**ISSUE — Timestamp format:** In `DIDResolutionResult::success()` (`did.rs:441`), the `created` and `updated` fields are populated from `DIDMetadata.created` (which is a `u64` Unix timestamp) via `.to_string()`. This produces strings like `"1712345678"` instead of ISO 8601 / XML Datetime format (e.g., `"2026-04-05T12:34:56Z"`). The W3C DID Core spec says `created` and `updated` values SHOULD be expressed as XML Datetime (ISO 8601).

**Error codes compliance:**

| W3C Error | Implemented | Status |
|-----------|-------------|--------|
| `invalidDid` | Yes (`did.rs:475`) | PASS |
| `notFound` | Yes (`did.rs:462`) | PASS |
| `representationNotSupported` | No | OK (only JSON-LD supported) |
| `methodNotSupported` | No | OK (single method) |
| `internalError` | No | MINOR gap |

**Rating: A-** (timestamp format is the main gap)

### 2.7 DID Validation in SDK

**Implementation:** `sdk/src/client.ts`, function `validateDID()`

Supports four DID methods:

| Method | Pattern | Issues |
|--------|---------|--------|
| `did:agoramesh` | `/^did:(agoramesh\|web):[a-z]+:[a-zA-Z0-9]+$/` | Chain segment `[a-z]+` excludes hyphens and digits |
| `did:web` | Same as above | `[a-z]+` too restrictive for domain names (no dots, hyphens, digits) |
| `did:key` | `/^did:key:z[a-zA-Z0-9]{32,}$/` | Correct multibase 'z' prefix requirement |
| `did:ethr` | `/^did:ethr:(?:[a-zA-Z0-9]+:)?0x[a-fA-F0-9]{40}$/` | Correct |

**ISSUE — did:web regex too restrictive:** The `did:web` method spec requires domain names (e.g., `did:web:example.com`, `did:web:w3c-ccg.github.io`). The pattern `[a-z]+` for the second segment doesn't allow dots (`.`), hyphens (`-`), or digits that are standard in domain names. This would reject all valid `did:web` DIDs.

**ISSUE — did:agoramesh chain segment:** The pattern `[a-z]+` for the chain name doesn't allow hyphens or digits. However, `sdk/src/easy.ts:139` generates DIDs like `did:agoramesh:base-sepolia:0x...` (with a hyphen). These DIDs would fail validation. This is an internal consistency bug.

**Note:** The `did:key` pattern correctly requires the multibase `z` prefix (base58btc encoding) and a minimum key length of 32 characters. The `did:ethr` pattern correctly handles both `did:ethr:0x...` and `did:ethr:network:0x...` formats.

**Rating: B-**

---

## 3. Findings Summary

### Critical (must fix before production)

None.

### Major (should fix)

| # | Area | Finding | File | Recommendation |
|---|------|---------|------|----------------|
| M-1 | DID Validation | `did:web` regex rejects all valid did:web DIDs (no dots/hyphens in domain) | `sdk/src/client.ts:164` | Change pattern to support domain names: `/^did:web:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._%-]*)*$/` |
| M-2 | DID Validation | `did:agoramesh` regex rejects hyphened chain names (e.g., `base-sepolia`) generated by `easy.ts` | `sdk/src/client.ts:164` | Allow hyphens and digits in chain segment: `/^did:(agoramesh):[a-z0-9-]+:[a-zA-Z0-9]+$/` or split did:web into its own pattern |
| M-3 | DID Resolution | Timestamp format in `didDocumentMetadata` is Unix seconds string, not ISO 8601 | `node/src/did.rs:441-442` | Convert to RFC 3339 / ISO 8601 format (e.g., `2026-04-05T12:34:56Z`) |

### Minor (nice to fix)

| # | Area | Finding | File | Recommendation |
|---|------|---------|------|----------------|
| m-1 | DID Document | Ed25519 @context always included even without Ed25519 keys | `node/src/did.rs:251` | Conditionally include based on verification method types |
| m-2 | DID Document | Custom `metadata` field not registered in DID Spec Registries | `node/src/did.rs:49-51` | Document as AgoraMesh extension; consider using JSON-LD context |
| m-3 | MCP Auth | Token length leak in constant-time comparison | `mcp/src/http-handler.ts:46-49` | Hash both tokens (e.g., HMAC-SHA256) before comparing to equalize lengths |
| m-4 | MCP | No explicit DELETE handler for session termination | `mcp/src/http-handler.ts` | Verify SDK handles DELETE via `transport.handleRequest()` or add explicit handling |
| m-5 | DID Document | `serviceEndpoint` only supports string, not map or set | `node/src/did.rs:93` | Consider supporting the full W3C polymorphic type |
| m-6 | DID Resolution | Missing `internalError` resolution error code | `node/src/did.rs` | Add constructor for internal resolution errors |

### Informational

| # | Area | Observation |
|---|------|-------------|
| I-1 | MCP SDK | Uses `@modelcontextprotocol/sdk ^1.27.1`. Verify this is the latest stable version. |
| I-2 | MCP | Well-known discovery (`/.well-known/mcp.json`) follows emerging convention but is not yet standardized in the MCP spec. |
| I-3 | DID | No verifiable credentials implementation (listed as N/A in acceptance criteria). The `TrustInfo.verifications` type exists in the SDK but no VC issuance/verification code exists. |
| I-4 | DID | The `did:agoramesh` method is not registered with the W3C DID Method Registry. This is expected for a custom method but should be tracked for mainnet launch. |
| I-5 | MCP Tools | Tool parameter names use snake_case (e.g., `agent_did`, `min_trust`) which is consistent but differs from the DID field naming (camelCase). |

---

## 4. Component-Level Detail

### 4.1 MCP Server Architecture

```
cli.ts (stdio)  ─┐
                  ├─> index.ts (createServer) ─> McpServer + 6 tools
http.ts (HTTP)  ─┘         │
                            └─> node-client.ts ─> P2P Node API
                                     └─> Bridge API (for hire_agent)
```

- **Entry points:** `cli.ts` (stdio transport), `http.ts` (Streamable HTTP)
- **Configuration validation:** `validate-config.ts` — validates URLs and port ranges before startup
- **Node client:** `node-client.ts` — HTTP client for the Rust P2P node with 5s timeout (65s for bridge)

### 4.2 DID Architecture

```
node/src/did.rs          ─ Canonical did:agoramesh implementation (Rust)
  ├── DIDDocument        ─ W3C DID Document structure
  ├── DIDDocumentBuilder ─ Builder pattern for creating documents
  ├── DIDResolutionResult─ W3C DID Resolution response
  └── Validation         ─ Parsing and structural validation

sdk/src/client.ts        ─ DID validation (TypeScript)
  ├── validateDID()      ─ Pattern-based validation (4 methods)
  └── didToHash()        ─ keccak256 hash for on-chain operations

sdk/src/easy.ts          ─ DID generation
  └── auto-generates     ─ did:agoramesh:base-{network}:{address}
```

### 4.3 Test Coverage

| Component | Test File | Coverage |
|-----------|-----------|----------|
| DID (Rust) | `node/src/did.rs` (inline tests) | 22 tests: parsing, builder, validation, serialization, resolution |
| MCP HTTP | `mcp/src/http.test.ts` | 2 tests: graceful shutdown only |
| DID Validation (SDK) | `sdk/test/unit/did-validation.test.ts` | Covers all 4 DID methods |
| Trust (SDK) | `sdk/src/trust.test.ts` | DID hashing, trust scoring |

**Gap:** MCP tool integration tests are absent. There are no tests that verify tool registration, input validation, or response formatting through the MCP protocol.

---

## 5. Recommendations Priority

1. **Fix did:web and did:agoramesh regex patterns** (M-1, M-2) — These are correctness bugs that would reject valid DIDs in production.
2. **Fix DID resolution timestamps** (M-3) — Switch from Unix seconds to ISO 8601 for W3C compliance.
3. **Add MCP tool integration tests** — Critical gap for production readiness.
4. **Register did:agoramesh** in the W3C DID Method Registry before mainnet.
5. **Document the custom metadata extension** in the DID Document.

---

*End of audit.*
