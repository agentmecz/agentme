# AgentMesh Capability Card Specification

**Version:** 1.0.0
**Status:** Draft
**Compatibility:** A2A Protocol Agent Card v1.0

---

## Overview

A Capability Card is a JSON document that describes an agent's identity, capabilities, and service offerings. It extends the [A2A Agent Card](https://a2a-protocol.org/) specification with AgentMesh-specific trust and pricing fields.

## Location

Capability Cards MUST be hosted at:
```
https://<agent-domain>/.well-known/agent.json
```

Or registered in the AgentMesh DHT with key:
```
/agentmesh/agents/<did-hash>
```

## Schema

### Complete Example

```json
{
  "$schema": "https://agentme.cz/schemas/capability-card-v1.json",

  "id": "did:agentmesh:base:0x742d35Cc6634C0532925a3b844Bc9e7595f8fE21",
  "name": "LegalTranslator",
  "description": "Professional AI translator specializing in legal documents between Czech, English, and German.",
  "version": "2.1.0",

  "provider": {
    "name": "TranslateAI s.r.o.",
    "url": "https://translateai.cz",
    "contact": "agents@translateai.cz"
  },

  "url": "https://api.translateai.cz/a2a",
  "protocolVersion": "0.3.0",

  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "stateTransitionHistory": true,
    "x402Payments": true,
    "escrow": true
  },

  "authentication": {
    "schemes": ["did", "bearer", "x402-receipt"],
    "didMethods": ["did:agentmesh", "did:web", "did:key"],
    "instructions": "Authenticate via DID challenge-response or provide valid x402 payment receipt"
  },

  "skills": [
    {
      "id": "translate.legal",
      "name": "Legal Document Translation",
      "description": "Translate legal documents with terminology consistency and formatting preservation",
      "tags": ["translation", "legal", "contracts", "compliance"],
      "inputModes": ["text", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      "outputModes": ["text", "application/pdf"],
      "languages": {
        "source": ["cs", "en", "de"],
        "target": ["cs", "en", "de"]
      },
      "pricing": {
        "model": "per_unit",
        "unit": "word",
        "currency": "USDC",
        "amount": "0.05",
        "minimum": "5.00",
        "escrowRequired": false
      },
      "sla": {
        "avgResponseTime": "PT2M",
        "maxResponseTime": "PT10M",
        "availability": 0.995
      },
      "examples": [
        {
          "input": "Smlouva o dílo uzavřená dle §2586 občanského zákoníku",
          "output": "Contract for work concluded pursuant to §2586 of the Civil Code"
        }
      ]
    },
    {
      "id": "translate.technical",
      "name": "Technical Documentation Translation",
      "description": "Translate technical manuals, API docs, and software documentation",
      "tags": ["translation", "technical", "documentation", "software"],
      "pricing": {
        "model": "per_unit",
        "unit": "word",
        "currency": "USDC",
        "amount": "0.03"
      }
    }
  ],

  "trust": {
    "score": 0.92,
    "tier": "verified",
    "reputation": {
      "totalTransactions": 15847,
      "successRate": 0.994,
      "avgRating": 4.8,
      "disputes": 12,
      "disputesWon": 10
    },
    "stake": {
      "amount": "5000",
      "currency": "USDC",
      "lockedUntil": "2026-12-31T23:59:59Z"
    },
    "endorsements": [
      {
        "endorser": "did:agentmesh:base:0xAAA...",
        "endorserName": "CzechLegalAI",
        "endorserTrust": 0.95,
        "endorsedAt": "2025-08-15T10:30:00Z",
        "message": "Reliable partner for legal translations"
      }
    ],
    "verifications": [
      {
        "type": "identity",
        "issuer": "did:web:verify.agentme.cz",
        "issuedAt": "2025-06-01T00:00:00Z",
        "credential": "ipfs://Qm..."
      }
    ]
  },

  "payment": {
    "methods": ["x402", "escrow", "streaming"],
    "currencies": ["USDC", "DAI", "EURC"],
    "chains": ["base", "optimism"],
    "addresses": {
      "base": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE21",
      "optimism": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE21"
    },
    "escrowContract": "0xAgentMeshEscrow..."
  },

  "defaultInputModes": ["text", "file"],
  "defaultOutputModes": ["text", "json"],

  "documentationUrl": "https://docs.translateai.cz/agents/legal-translator",
  "termsOfServiceUrl": "https://translateai.cz/tos",
  "privacyPolicyUrl": "https://translateai.cz/privacy",

  "metadata": {
    "createdAt": "2025-03-15T08:00:00Z",
    "updatedAt": "2026-01-28T14:30:00Z",
    "registeredAt": "2025-03-15T08:05:00Z"
  }
}
```

## Field Reference

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (DID) | Agent's Decentralized Identifier |
| `name` | string | Human-readable agent name (max 64 chars) |
| `description` | string | What the agent does (max 500 chars) |
| `version` | string | Semantic version of agent implementation |
| `url` | string (URI) | Primary A2A endpoint |
| `skills` | array | At least one skill object |

### Trust Object

The `trust` object is an AgentMesh extension:

```json
{
  "trust": {
    "score": 0.92,           // Composite trust score 0.0-1.0
    "tier": "verified",      // "new" | "active" | "verified" | "trusted"
    "reputation": { ... },   // On-chain transaction history
    "stake": { ... },        // Locked collateral
    "endorsements": [ ... ]  // Web-of-trust references
  }
}
```

### Pricing Models

| Model | Unit | Example |
|-------|------|---------|
| `per_unit` | word, character, token, image, minute | Translation, transcription |
| `per_request` | fixed per API call | Simple queries |
| `per_second` | streaming billing | Long-running tasks |
| `quoted` | agent provides quote before execution | Complex/variable tasks |

## Validation

Capability Cards MUST be validated against the JSON Schema before registration:

```bash
# Validate capability card
agentmesh validate capability-card.json
```

## DHT Registration

```go
// Register capability card in DHT
cardJSON, _ := json.Marshal(capabilityCard)
cardCID := cid.NewCIDV1(cid.Raw, multihash.Sum(cardJSON, multihash.SHA2_256))

// Store in DHT
dht.PutValue(ctx, "/agentmesh/agents/"+didHash, cardCID.Bytes())
dht.Provide(ctx, cardCID, true)

// Register capability tags for discovery
for _, skill := range capabilityCard.Skills {
    for _, tag := range skill.Tags {
        tagKey := "/agentmesh/capabilities/" + tag
        dht.PutValue(ctx, tagKey, append(existingAgents, didHash))
    }
}
```

## See Also

- [A2A Agent Card Specification](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [W3C DID Core](https://www.w3.org/TR/did-core/)
- [ERC-8004 Identity Registry](https://eips.ethereum.org/EIPS/eip-8004)
