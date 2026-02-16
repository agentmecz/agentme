# Local Development

This guide explains how to run the full AgentMe local stack using `docker-compose.dev.yml`.

The development stack includes:

* **Anvil** — Local Ethereum node (chain ID 31337)
* **Deploy** — Foundry script to deploy contracts (runs once)
* **Node** — AgentMe P2P node + HTTP API
* **Bridge** — Local AI worker

---

## Prerequisites

* Docker
* Docker Compose v2

Verify installation:

```bash
docker --version
docker compose version
```

---

## 1. Clone the Repository

```bash
git clone https://github.com/agentmecz/agentme.git
cd agentme
```

---

## 2. Create Environment File

Copy the example environment file:

```bash
cp .env.example .env
```

### Required Variable

The Bridge **will not start** unless this is set:

```
BRIDGE_API_TOKEN=dev-token
```

Any value works for local development.

---

## 3. Start the Development Stack

```bash
docker compose -f docker-compose.dev.yml up --build
```

Startup order:

```
anvil → deploy → node + bridge
```

The `deploy` service must complete successfully before `node` and `bridge` start.

If `deploy` fails, the stack will not launch correctly.

---

## 4. Verify Services

### Check Node API (Port 8080)

```bash
curl http://localhost:8080/health
```

Expected:

```json
{"status":"ok", ...}
```

---

### Check Bridge (Port 3402)

```bash
curl http://localhost:3402/.well-known/agent.json
```

This should return the agent capability card.

---

## Service Ports

| Service  | Port |
| -------- | ---- |
| Anvil    | 8545 |
| Node API | 8080 |
| Bridge   | 3402 |

---

## Clean Restart Test

To ensure reproducibility:

```bash
docker compose down -v
docker compose -f docker-compose.dev.yml up --build
```

The stack should start without manual fixes.

---

## Common Issues

### Bridge exits with:

```
Bridge auth required
```

Ensure `.env` contains:

```
BRIDGE_API_TOKEN=dev-token
```

---

### Deploy does not complete

Check logs:

```bash
docker compose logs deploy
```

Contracts must deploy successfully before node/bridge start.

---

## Stopping the Stack

Press:

```
CTRL + C
```

Then:

```bash
docker compose down
```

