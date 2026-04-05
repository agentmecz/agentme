# A2A Protocol Compliance Audit

**Project:** AgoraMesh
**Auditor:** Polecat shiny (automated)
**Date:** 2026-04-05
**A2A Spec Version:** 1.0.0 (Linux Foundation, `a2aproject/A2A`)
**Spec Source:** https://google.github.io/A2A/ and https://a2a-protocol.org/latest/

---

## Executive Summary

AgoraMesh implements a substantial subset of the A2A v1.0.0 protocol with meaningful
extensions for trust, payment, and decentralized discovery. The core JSON-RPC 2.0
handler, agent card discovery endpoints, and basic task lifecycle are functional.
However, several areas require updates to reach full A2A v1.0.0 compliance, most
notably: the Agent Card structure (missing `supportedInterfaces`), additional task
states (`INPUT_REQUIRED`, `AUTH_REQUIRED`, `REJECTED`), SSE streaming (we use
WebSocket instead), push notification CRUD endpoints, and security scheme format
alignment with OpenAPI 3.2.

**Overall Compliance: PARTIAL (estimated 55-60%)**

| Area | Rating | Summary |
|------|--------|---------|
| Agent Card Format | **Partial** | Core fields present; missing `supportedInterfaces`, `signatures` |
| Task Lifecycle | **Partial** | 5 of 9 states; missing `INPUT_REQUIRED`, `AUTH_REQUIRED`, `REJECTED` |
| Discovery Protocol | **Compliant** | Well-known endpoint served; DHT goes beyond spec |
| Streaming Support | **Non-Compliant** | WebSocket only; A2A requires SSE |
| Push Notifications | **Non-Compliant** | Capability flag exists; no CRUD endpoints |
| Message Format | **Partial** | Text parts only; missing binary, URL, and data parts |
| Authentication | **Partial** | Functional auth; format differs from OpenAPI 3.2 scheme |
| HTTP Endpoints | **Partial** | Core methods present; names and paths diverge |

---

## 1. Agent Card Format

### A2A v1.0.0 Requirement

The Agent Card is a JSON document served at `/.well-known/agent-card.json`. Key
required fields per the protobuf specification:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable name |
| `description` | Yes | Purpose description |
| `version` | Yes | Agent version |
| `supportedInterfaces` | Yes | Ordered array of `AgentInterface` objects |
| `capabilities` | Yes | `AgentCapabilities` object |
| `defaultInputModes` | Yes | MIME types (e.g., `"text/plain"`) |
| `defaultOutputModes` | Yes | MIME types |
| `skills` | Yes | Array of `AgentSkill` objects |

Each `AgentInterface` must contain:
- `url` (absolute HTTPS URL)
- `protocolBinding` (`"JSONRPC"`, `"GRPC"`, `"HTTP+JSON"`)
- `protocolVersion` (e.g., `"1.0"`)

### AgoraMesh Implementation

**Files:** `sdk/src/types.ts` (CapabilityCard interface), `bridge/src/types.ts`
(RichAgentConfig), `bridge/src/server.ts` (well-known handler)

**Endpoints served:**
- `GET /.well-known/agent.json` (primary)
- `GET /.well-known/agent-card.json` (alias)
- `GET /.well-known/a2a.json` (alias)

**Field mapping:**

| A2A Field | AgoraMesh Field | Status |
|-----------|-----------------|--------|
| `name` | `name` | Present |
| `description` | `description` | Present |
| `version` | `version` | Present |
| `supportedInterfaces` | `url` + `protocolVersion` (flat) | **Missing** (flat fields, not interface array) |
| `capabilities` | `capabilities` | Present (with extensions) |
| `defaultInputModes` | `defaultInputModes` | Present |
| `defaultOutputModes` | `defaultOutputModes` | Present |
| `skills` | `skills` | Present |
| `provider` | `provider` | Present |
| `securitySchemes` | `authentication` | **Different format** |
| `securityRequirements` | N/A | **Missing** |
| `signatures` (JWS) | N/A | **Missing** |
| `iconUrl` | N/A | **Missing** |

**Skill field mapping:**

| A2A Field | AgoraMesh Field | Status |
|-----------|-----------------|--------|
| `id` | `id` | Present |
| `name` | `name` | Present |
| `description` | `description` | Present |
| `tags` | `tags` | Present |
| `examples` | `examples` | Present (different format: `{input, output}` vs string array) |
| `inputModes` | `inputModes` | Present |
| `outputModes` | `outputModes` | Present |
| N/A | `pricing` | AgoraMesh extension |
| N/A | `sla` | AgoraMesh extension |
| N/A | `inputSchema` | AgoraMesh extension |
| N/A | `outputSchema` | AgoraMesh extension |

### Findings

1. **CRITICAL: Missing `supportedInterfaces` array.** A2A v1.0.0 requires an ordered
   array of `AgentInterface` objects (each with `url`, `protocolBinding`,
   `protocolVersion`). AgoraMesh uses flat `url` and `protocolVersion` fields on the
   card root. This is the most significant structural divergence.

2. **MAJOR: Security scheme format.** A2A uses OpenAPI 3.2-style `securitySchemes` map
   (API Key, HTTP, OAuth2, OIDC, mTLS) with a separate `securityRequirements` array.
   AgoraMesh uses a custom `authentication` object with `schemes: string[]`,
   `didMethods`, and `instructions`.

3. **MINOR: Skill examples format.** A2A expects `examples` as `string[]` (example
   prompts). AgoraMesh uses `{input, output}` objects, which is richer but not compliant.

4. **MINOR: Agent Card uses `id` field (DID).** A2A v1.0.0 does not have an `id` field
   on the Agent Card itself; identity is separate from the card.

5. **MINOR: Missing `iconUrl` field.** Not critical for machine-to-machine interaction.

6. **MINOR: Missing `signatures` (JWS) support.** Optional in A2A but relevant for
   trust verification.

### Rating: PARTIAL

**AgoraMesh extensions (beyond A2A):** `trust`, `payment`, `freeTier`,
`termsOfServiceUrl`, `privacyPolicyUrl`, `metadata`. These are additive and do not
break A2A compatibility when present as extra fields.

---

## 2. Task Lifecycle

### A2A v1.0.0 Requirement

The Task object:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Server-generated UUID |
| `contextId` | No | Groups related tasks |
| `status` | Yes | `TaskStatus` with `state`, optional `message`, `timestamp` |
| `artifacts` | No | Output artifacts |
| `history` | No | Message history |
| `metadata` | No | Custom metadata |

Task states (9 total):

| State | Terminal | Description |
|-------|----------|-------------|
| `TASK_STATE_SUBMITTED` | No | Acknowledged |
| `TASK_STATE_WORKING` | No | Processing |
| `TASK_STATE_COMPLETED` | Yes | Success |
| `TASK_STATE_FAILED` | Yes | Error |
| `TASK_STATE_CANCELED` | Yes | Canceled |
| `TASK_STATE_INPUT_REQUIRED` | No* | Needs user input |
| `TASK_STATE_REJECTED` | Yes | Declined by agent |
| `TASK_STATE_AUTH_REQUIRED` | No* | Needs credentials |
| `TASK_STATE_UNSPECIFIED` | - | Unknown |

### AgoraMesh Implementation

**Files:** `bridge/src/a2a.ts` (A2ATask, A2ATaskState), `bridge/src/types.ts`
(TaskInput, TaskResult)

**Implemented states:** `submitted`, `working`, `completed`, `failed`, `canceled`

**Task object comparison:**

| A2A Field | AgoraMesh | Status |
|-----------|-----------|--------|
| `id` | `id` | Present |
| `contextId` | N/A | **Missing** |
| `status.state` | `status.state` | Present (5 of 9 states) |
| `status.message` | N/A | **Missing** |
| `status.timestamp` | N/A | **Missing** |
| `artifacts` | `artifacts` | Present (text-only parts) |
| `history` | N/A | **Missing** |
| `metadata` | N/A | **Missing** |

### Findings

1. **MAJOR: Missing task states.** `INPUT_REQUIRED`, `AUTH_REQUIRED`, and `REJECTED`
   are not implemented. These enable interactive multi-turn agent conversations:
   - `INPUT_REQUIRED` allows agents to pause and request clarification
   - `AUTH_REQUIRED` enables mid-task credential requests
   - `REJECTED` allows agents to decline tasks they cannot/will not perform

2. **MAJOR: Missing `contextId`.** A2A uses `contextId` to group related tasks and
   maintain conversation context across multiple messages. Without this, multi-turn
   interactions are not possible in the A2A sense.

3. **MINOR: State naming convention.** A2A uses `TASK_STATE_COMPLETED` (screaming
   snake case with prefix). AgoraMesh uses `completed` (lowercase). This affects wire
   format compatibility.

4. **MINOR: Missing `status.message` and `status.timestamp`.** The status object only
   contains `state`, not the full `TaskStatus` structure.

5. **MINOR: Missing `history` field.** Task objects don't carry message history.

6. **NOTE:** AgoraMesh has its own `TaskResult` type with `output`, `error`, `duration`,
   `filesChanged` that doesn't map to A2A's artifact model. The bridge translates
   `TaskResult` to `A2ATask` in `taskResultToA2ATask()`, but only for the JSON-RPC path.

### Rating: PARTIAL

---

## 3. Discovery Protocol

### A2A v1.0.0 Requirement

- Primary: `GET /.well-known/agent-card.json` returns the Agent Card
- Should include `Cache-Control`, `ETag`, `Last-Modified` headers
- Optional: Extended Agent Card at `/extendedAgentCard` (when `capabilities.extendedAgentCard` is true)
- Registries and direct configuration are implementation-specific

### AgoraMesh Implementation

**Files:** `bridge/src/server.ts` (well-known handlers), `node/src/discovery.rs`
(DHT), `node/src/api.rs` (REST API)

**Endpoints:**
- `GET /.well-known/agent.json` (primary)
- `GET /.well-known/agent-card.json` (alias, matches A2A canonical path)
- `GET /.well-known/a2a.json` (alias)
- Kademlia DHT registration at `/agoramesh/agents/<did-hash>`
- GossipSub real-time agent announcements
- Semantic search via vector embeddings + BM25

### Findings

1. **COMPLIANT: Well-known endpoint.** `/.well-known/agent-card.json` is served,
   matching the A2A canonical path exactly.

2. **MINOR: Missing caching headers.** A2A recommends `Cache-Control`, `ETag`, and
   `Last-Modified` on the agent card response. Current implementation returns bare JSON.

3. **MINOR: No Extended Agent Card.** A2A's `/extendedAgentCard` endpoint for
   post-authentication richer cards is not implemented. The `capabilities.extendedAgentCard`
   flag is not present.

4. **EXCEEDS SPEC: DHT discovery.** AgoraMesh's Kademlia DHT + GossipSub + semantic
   search provides decentralized discovery that goes significantly beyond A2A's
   well-known URI approach. This is additive, not conflicting.

### Rating: COMPLIANT (with minor gaps)

---

## 4. Streaming Support

### A2A v1.0.0 Requirement

- Streaming is optional (`capabilities.streaming` flag)
- Uses **Server-Sent Events (SSE)** with `Content-Type: text/event-stream`
- Two operations: `SendStreamingMessage` and `SubscribeToTask`
- Stream returns `StreamResponse` union: `task`, `message`, `statusUpdate`, `artifactUpdate`
- `TaskArtifactUpdateEvent` supports `append` and `lastChunk` for incremental delivery
- Events must be delivered in order

### AgoraMesh Implementation

**Files:** `bridge/src/server.ts` (WebSocket handler), `sdk/src/streaming.ts`

**What's implemented:**
- WebSocket full-duplex streaming (ws:// upgrade)
- WebSocket messages: `{type: "task", payload: {...}}`, `{type: "result", ...}`, `{type: "error", ...}`
- 30-second heartbeat (ping/pong)
- Max 100 concurrent connections, 1 MiB max payload

**What's NOT implemented:**
- Server-Sent Events (SSE)
- `SendStreamingMessage` method
- `SubscribeToTask` method
- `StreamResponse` union format
- `TaskArtifactUpdateEvent` with append/lastChunk
- `TaskStatusUpdateEvent`

### Findings

1. **CRITICAL: No SSE implementation.** A2A v1.0.0 specifies SSE for its JSON-RPC and
   HTTP/REST bindings. AgoraMesh uses WebSocket exclusively. These are fundamentally
   different transport models:
   - SSE: unidirectional server-to-client, HTTP-based, firewall-friendly
   - WebSocket: bidirectional, requires upgrade, may be blocked by proxies

2. **CRITICAL: Missing streaming methods.** Neither `SendStreamingMessage` nor
   `SubscribeToTask` are implemented in the JSON-RPC handler (`bridge/src/a2a.ts`).

3. **CRITICAL: No `StreamResponse` format.** A2A's streaming uses a union of `task`,
   `message`, `statusUpdate`, and `artifactUpdate`. AgoraMesh uses custom WebSocket
   message types (`task`, `result`, `error`).

4. **NOTE:** WebSocket streaming is a valid engineering choice and may even be
   preferable for bidirectional use cases. However, it is not A2A-compliant.
   A2A v1.0.0 also supports gRPC server streaming as an alternative, but AgoraMesh
   does not implement gRPC either.

### Rating: NON-COMPLIANT

---

## 5. Push Notification Support

### A2A v1.0.0 Requirement

- Optional (`capabilities.pushNotifications` flag)
- Full CRUD for `TaskPushNotificationConfig`:
  - `POST /tasks/{id}/pushNotificationConfigs` (Create)
  - `GET /tasks/{id}/pushNotificationConfigs/{configId}` (Get)
  - `GET /tasks/{id}/pushNotificationConfigs` (List)
  - `DELETE /tasks/{id}/pushNotificationConfigs/{configId}` (Delete)
- Webhook delivery: POST `StreamResponse` to configured URL
- At-least-once delivery with exponential backoff

### AgoraMesh Implementation

**Files:** `sdk/src/types.ts` (CapabilityCard), `bridge/src/types.ts` (RichAgentConfig)

**What's implemented:**
- `capabilities.pushNotifications` boolean flag in the capability card
- No webhook URL storage, delivery, or CRUD endpoints

### Findings

1. **MAJOR: No push notification implementation.** The capability flag exists in type
   definitions but no functional code supports webhook configuration or delivery.

2. **MAJOR: No CRUD endpoints.** None of the four push notification config endpoints
   are implemented.

3. **NOTE:** AgoraMesh's WebSocket connections and polling (`GET /task/:taskId`)
   provide alternative real-time notification mechanisms, but these are not A2A push
   notifications.

### Rating: NON-COMPLIANT

---

## 6. Message Format

### A2A v1.0.0 Requirement

**Message fields:**

| Field | Required | Type |
|-------|----------|------|
| `messageId` | Yes | UUID |
| `contextId` | No | string |
| `taskId` | No | string |
| `role` | Yes | `ROLE_USER` or `ROLE_AGENT` |
| `parts` | Yes | `Part[]` (at least one) |
| `metadata` | No | JSON object |
| `extensions` | No | string array of extension URIs |
| `referenceTaskIds` | No | string array |

**Part types (union, exactly one content field):**

| Content Field | Type | Description |
|---------------|------|-------------|
| `text` | string | Text content |
| `raw` | bytes (base64 in JSON) | Binary file content |
| `url` | string | URL pointing to content |
| `data` | arbitrary JSON | Structured data |

Plus optional: `metadata`, `filename`, `mediaType`

### AgoraMesh Implementation

**Files:** `bridge/src/a2a.ts` (handleMessageSend)

**What's implemented:**
- `message.parts` array parsing
- Text parts: `{type: 'text', text: string}`
- Role mapping: `message.role` -> `clientDid` (optional, prefixed as `did:a2a:`)

**What's NOT implemented:**
- `messageId` (not extracted or generated for incoming messages)
- `contextId` (no conversation threading)
- `taskId` on incoming messages
- `ROLE_USER` / `ROLE_AGENT` enum values (uses optional string)
- Binary parts (`raw` / base64)
- URL parts (`url`)
- Data parts (`data` / structured JSON)
- Part metadata, filename, mediaType
- `extensions` and `referenceTaskIds`

### Findings

1. **MAJOR: Text-only parts.** Only `{type: 'text', text: string}` parts are processed.
   A2A supports four content types (text, raw, url, data). This limits interoperability
   with agents that send files, images, or structured data.

2. **MAJOR: Missing `messageId`.** A2A requires unique message IDs for deduplication
   and reference. Not generated or tracked.

3. **MAJOR: No conversation threading.** Without `contextId` and `referenceTaskIds`,
   multi-turn conversations and task chaining are not possible per A2A semantics.

4. **MINOR: Role enum mismatch.** A2A uses `ROLE_USER` / `ROLE_AGENT`. AgoraMesh
   treats role as an optional string mapped to a DID.

5. **NOTE:** The A2A handler extracts text from the first text part and passes it as
   a prompt to the executor. This is a reasonable simplification for a code execution
   agent but limits A2A interoperability.

### Rating: PARTIAL

---

## 7. Authentication

### A2A v1.0.0 Requirement

- Agent Card declares auth via `securitySchemes` (OpenAPI 3.2-style map)
- Supported types: API Key, HTTP Auth, OAuth 2.0, OpenID Connect, Mutual TLS
- `securityRequirements` array specifies which schemes are needed
- Transport-layer auth (HTTP headers, gRPC metadata)
- In-task auth via `TASK_STATE_AUTH_REQUIRED`

### AgoraMesh Implementation

**Files:** `bridge/src/server.ts` (auth middleware), `bridge/src/did-auth.ts`,
`bridge/src/free-tier-limiter.ts`, `sdk/src/types.ts` (Authentication)

**Implemented schemes:**
1. **Bearer token** — `Authorization: Bearer <token>` (static API key)
2. **x402 Payment** — `x-payment` header with payment receipt
3. **DID:key Auth** — `Authorization: DID <did>:<timestamp>:<signature>`
4. **FreeTier Auth** — `Authorization: FreeTier <agent-id>` (no crypto)

**Auth declaration format:**
```typescript
authentication: {
  schemes: string[];        // e.g., ["bearer", "did:key", "x402", "free"]
  didMethods?: string[];
  instructions?: string | Record<string, AuthSchemeInstructions>;
}
```

### Findings

1. **MAJOR: Different auth declaration format.** A2A uses OpenAPI 3.2 `securitySchemes`
   map with typed objects (`APIKeySecurityScheme`, `HTTPAuthSecurityScheme`,
   `OAuth2SecurityScheme`, etc.). AgoraMesh uses a custom `Authentication` object with
   string-based scheme names. Clients parsing the A2A card won't find the expected
   `securitySchemes` structure.

2. **MINOR: Bearer token is A2A-compatible.** The `HTTPAuthSecurityScheme` with
   `scheme: "Bearer"` maps directly to AgoraMesh's bearer token implementation.

3. **MINOR: DID:key auth is an AgoraMesh extension.** Not part of A2A's standard
   security schemes but could be declared as a custom scheme.

4. **MINOR: x402 is an AgoraMesh extension.** Payment-based auth is unique to
   AgoraMesh and not in A2A. Could be declared via a custom extension.

5. **MINOR: No `TASK_STATE_AUTH_REQUIRED` support.** In-task auth requests are not
   possible since the state is not implemented.

### Rating: PARTIAL

---

## 8. HTTP Endpoints

### A2A v1.0.0 Requirement (HTTP/REST binding)

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Send message | POST | `/message:send` |
| Stream message | POST | `/message:stream` |
| Get task | GET | `/tasks/{id}` |
| List tasks | GET | `/tasks` |
| Cancel task | POST | `/tasks/{id}:cancel` |
| Subscribe to task | POST | `/tasks/{id}:subscribe` |
| Push config CRUD | Various | `/tasks/{id}/pushNotificationConfigs/...` |
| Extended Agent Card | GET | `/extendedAgentCard` |
| Agent Card | GET | `/.well-known/agent-card.json` |

### A2A v1.0.0 Requirement (JSON-RPC binding)

| Method Name | Description |
|-------------|-------------|
| `SendMessage` | Send a message |
| `SendStreamingMessage` | Stream message |
| `GetTask` | Get task status |
| `ListTasks` | List tasks |
| `CancelTask` | Cancel task |
| `SubscribeToTask` | Subscribe to updates |
| Push config methods | CRUD for push configs |
| `GetExtendedAgentCard` | Get extended card |

### AgoraMesh Implementation

**JSON-RPC methods (bridge/src/a2a.ts):**

| A2A Method | AgoraMesh Method | Status |
|------------|------------------|--------|
| `SendMessage` | `message/send` | **Name differs** (slash vs CamelCase) |
| `SendStreamingMessage` | N/A | **Missing** |
| `GetTask` | `tasks/get` | **Name differs** |
| `ListTasks` | N/A | **Missing** |
| `CancelTask` | `tasks/cancel` | **Name differs** |
| `SubscribeToTask` | N/A | **Missing** |
| Push config methods | N/A | **Missing** |
| `GetExtendedAgentCard` | N/A | **Missing** |
| N/A | `agent/describe` | AgoraMesh extension |
| N/A | `agent/status` | AgoraMesh extension |

**REST endpoints (bridge/src/server.ts):**

| A2A Endpoint | AgoraMesh Endpoint | Status |
|-------------|-------------------|--------|
| `GET /.well-known/agent-card.json` | `GET /.well-known/agent-card.json` | Present |
| `POST /message:send` | `POST /task` | **Different path and format** |
| `GET /tasks/{id}` | `GET /task/:taskId` | **Similar** (singular vs plural) |
| `POST /tasks/{id}:cancel` | `DELETE /task/:taskId` | **Different method** (POST vs DELETE) |
| `GET /tasks` | N/A | **Missing** |
| `POST /message:stream` | N/A | **Missing** |
| Various push config | N/A | **Missing** |
| `GET /extendedAgentCard` | N/A | **Missing** |

### Findings

1. **MAJOR: JSON-RPC method names differ.** A2A uses CamelCase (`SendMessage`,
   `GetTask`, `CancelTask`). AgoraMesh uses slash-separated names (`message/send`,
   `tasks/get`, `tasks/cancel`). This means A2A SDK clients will get "Method not found"
   errors.

2. **MAJOR: Missing methods.** `SendStreamingMessage`, `ListTasks`,
   `SubscribeToTask`, and all push notification config methods are absent.

3. **MAJOR: REST paths differ.** A2A uses `/message:send` and `/tasks/{id}:cancel`
   (Google API-style colon actions). AgoraMesh uses `/task` (POST) and
   `/task/:taskId` (DELETE for cancel). This means HTTP/REST clients built for A2A
   won't hit the right endpoints.

4. **MINOR: No `A2A-Version` header handling.** A2A v1.0.0 requires clients to send
   `A2A-Version: 1.0`. AgoraMesh doesn't check or require this header.

5. **NOTE:** AgoraMesh adds useful non-standard endpoints: `POST /sandbox` (try-before-buy),
   `GET /health` (ops), `GET /llms.txt` (AI-readable docs), `agent/describe` and
   `agent/status` JSON-RPC methods.

### Rating: PARTIAL

---

## 9. Additional A2A v1.0.0 Requirements

### Versioning

- **A2A requires:** `A2A-Version` header on all requests (empty defaults to `0.3`)
- **AgoraMesh:** No version header handling. **Non-compliant.**

### Error Codes

A2A defines specific error codes:

| A2A Error | A2A JSON-RPC Code | AgoraMesh Code |
|-----------|-------------------|----------------|
| `TaskNotFoundError` | -32001 | -32000 |
| `TaskNotCancelableError` | -32002 | -32001 |
| `PushNotificationNotSupportedError` | -32003 | N/A |
| `UnsupportedOperationError` | -32004 | N/A |
| `ContentTypeNotSupportedError` | -32005 | N/A |
| `InvalidAgentResponseError` | -32006 | N/A |

**Finding:** Error codes are off by one (`TaskNotFound` is -32000 in AgoraMesh vs
-32001 in A2A). Standard JSON-RPC errors (-32700 to -32603) are correct.

### Artifact Format

- **A2A requires:** `artifactId` (required), `name`, `description`, `parts`, `metadata`, `extensions`
- **AgoraMesh:** Artifacts have optional `name` and `parts` (text only). Missing `artifactId`,
  `description`, `metadata`, `extensions`.

### Content Types

- **A2A uses:** `application/json` for requests, `text/event-stream` for SSE
- **AgoraMesh:** Uses `application/json` for all responses. **Compliant** for non-streaming.

---

## 10. Compliance Summary Matrix

| # | Requirement | Compliance | Priority to Fix |
|---|-------------|------------|-----------------|
| 1 | Agent Card: `supportedInterfaces` array | Non-compliant | **High** |
| 2 | Agent Card: `securitySchemes` (OpenAPI 3.2) | Non-compliant | High |
| 3 | Agent Card: `signatures` (JWS) | Non-compliant | Low |
| 4 | Agent Card: `iconUrl` | Non-compliant | Low |
| 5 | Task states: `INPUT_REQUIRED` | Non-compliant | **High** |
| 6 | Task states: `AUTH_REQUIRED` | Non-compliant | Medium |
| 7 | Task states: `REJECTED` | Non-compliant | Medium |
| 8 | Task: `contextId` field | Non-compliant | **High** |
| 9 | Task: `status.message`, `status.timestamp` | Non-compliant | Medium |
| 10 | Task: `history` field | Non-compliant | Low |
| 11 | Task: `metadata` field | Non-compliant | Low |
| 12 | State naming: SCREAMING_SNAKE_CASE | Non-compliant | Medium |
| 13 | Discovery: caching headers | Non-compliant | Low |
| 14 | Discovery: Extended Agent Card | Non-compliant | Low |
| 15 | Streaming: SSE support | Non-compliant | **High** |
| 16 | Streaming: `SendStreamingMessage` | Non-compliant | **High** |
| 17 | Streaming: `SubscribeToTask` | Non-compliant | Medium |
| 18 | Push notifications: CRUD endpoints | Non-compliant | Medium |
| 19 | Push notifications: webhook delivery | Non-compliant | Medium |
| 20 | Message: `messageId` | Non-compliant | **High** |
| 21 | Message: multi-type parts (raw, url, data) | Non-compliant | Medium |
| 22 | Message: `extensions`, `referenceTaskIds` | Non-compliant | Low |
| 23 | Auth: OpenAPI 3.2 scheme format | Non-compliant | High |
| 24 | JSON-RPC: method name alignment | Non-compliant | **High** |
| 25 | JSON-RPC: `ListTasks` method | Non-compliant | Medium |
| 26 | REST: path alignment (colon actions) | Non-compliant | Medium |
| 27 | `A2A-Version` header | Non-compliant | Medium |
| 28 | Error code alignment (-32001 vs -32000) | Non-compliant | Medium |
| 29 | Artifact: `artifactId` required field | Non-compliant | Medium |

---

## 11. Recommendations

### Phase 1: Critical Interoperability (High Priority)

These changes would allow A2A SDK clients to successfully communicate with AgoraMesh:

1. **Align JSON-RPC method names.** Change `message/send` -> `SendMessage`,
   `tasks/get` -> `GetTask`, `tasks/cancel` -> `CancelTask`. Consider supporting
   both old and new names during transition.

2. **Add `supportedInterfaces` to Agent Card.** Restructure the card to include the
   required interface array. Keep flat `url`/`protocolVersion` for backward
   compatibility.

3. **Add `messageId` generation.** Generate UUIDs for all incoming and outgoing
   messages.

4. **Add `contextId` support.** Enable conversation threading by tracking context IDs
   across tasks.

5. **Implement SSE streaming.** Add `text/event-stream` support alongside existing
   WebSocket. This is required for standard A2A streaming clients.

### Phase 2: Enhanced Compliance (Medium Priority)

6. **Add missing task states.** Implement `INPUT_REQUIRED`, `AUTH_REQUIRED`, `REJECTED`
   with appropriate lifecycle transitions.

7. **Align error codes.** Shift server-defined error codes to match A2A (-32001 for
   TaskNotFound, -32002 for TaskNotCancelable, etc.).

8. **Add `A2A-Version` header handling.** Parse and validate the version header.

9. **Add `securitySchemes` format.** Include OpenAPI 3.2-style security scheme
   declarations in the Agent Card alongside existing `authentication` object.

10. **Add push notification CRUD.** Implement webhook configuration and delivery
    endpoints.

11. **Support multi-type message parts.** Parse `raw`, `url`, and `data` parts in
    addition to `text`.

### Phase 3: Full Compliance (Lower Priority)

12. Add REST endpoint path alignment (`/message:send`, `/tasks/{id}:cancel`)
13. Add `ListTasks` method
14. Add Agent Card caching headers
15. Add Extended Agent Card endpoint
16. Add JWS signature support for Agent Cards
17. Add artifact `artifactId` field
18. Add task `history` and `metadata` fields
19. Align state naming to SCREAMING_SNAKE_CASE

### Dual-Format Strategy

Given AgoraMesh's existing extensions (trust, payment, escrow, DHT discovery), a
**dual-format** approach is recommended:
- Serve A2A-compliant cards at `/.well-known/agent-card.json`
- Serve extended AgoraMesh cards at a separate endpoint (e.g., `/agent-card.json`)
- Support both A2A-standard and AgoraMesh-extended JSON-RPC method names
- Keep AgoraMesh extensions as optional overlays that don't break A2A parsing

---

## 12. What AgoraMesh Does Well (Beyond A2A)

AgoraMesh implements several features that the A2A spec does not cover:

| Feature | Description |
|---------|-------------|
| **Decentralized trust** | On-chain reputation, staking, endorsement graph |
| **Escrow payments** | Smart contract-based escrow with dispute resolution |
| **x402 micropayments** | HTTP 402-based pay-per-request |
| **DHT discovery** | Kademlia + GossipSub decentralized agent registry |
| **Semantic search** | Vector embedding + BM25 hybrid agent search |
| **Free tier** | Try-before-buy sandbox with progressive trust |
| **DID:key auth** | Cryptographic identity-based authentication |
| **Streaming payments** | Per-second smart contract billing |
| **Dispute resolution** | 3-tier automatic/AI/community arbitration |

These are valuable differentiators. The goal of A2A compliance is interoperability
with the broader ecosystem, not replacing AgoraMesh's unique capabilities.

---

*End of audit. Generated 2026-04-05 by polecat shiny.*
