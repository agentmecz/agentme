# Bridge Protocol Specification

The AgentMesh Bridge enables local AI agents to connect to the AgentMesh network and receive tasks from remote clients.

## Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AgentMesh     │────▶│     Bridge      │────▶│   Local AI      │
│   Network       │◀────│     Server      │◀────│   (Claude)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
       P2P               HTTP/WebSocket           CLI/Process
```

## Task Schema

### TaskInput

```typescript
interface TaskInput {
  // Unique task identifier
  taskId: string;
  
  // Task type
  type: 'prompt' | 'code-review' | 'refactor' | 'debug' | 'custom';
  
  // The actual prompt/instruction
  prompt: string;
  
  // Optional context
  context?: {
    repo?: string;        // Git repository URL
    branch?: string;      // Branch name
    files?: string[];     // Specific files to focus on
    workingDir?: string;  // Override working directory
  };
  
  // Timeout in seconds (default: 300)
  timeout?: number;
  
  // Client's DID
  clientDid: string;
  
  // Escrow ID if payment is escrowed
  escrowId?: string;
}
```

### TaskResult

```typescript
interface TaskResult {
  // Matches the input taskId
  taskId: string;
  
  // Outcome
  status: 'completed' | 'failed' | 'timeout';
  
  // Task output (if completed)
  output?: string;
  
  // Error message (if failed/timeout)
  error?: string;
  
  // Execution time in milliseconds
  duration: number;
  
  // Files modified (if applicable)
  filesChanged?: string[];
}
```

## HTTP API

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/.well-known/agent.json` | A2A Capability Card |
| POST | `/task` | Submit a task |
| GET | `/task/:taskId` | Get task status |
| DELETE | `/task/:taskId` | Cancel task |

### POST /task

Submit a task for execution.

**Request:**
```http
POST /task HTTP/1.1
Content-Type: application/json

{
  "taskId": "task-123",
  "type": "prompt",
  "prompt": "Refactor this code to use async/await",
  "clientDid": "did:agentmesh:base:0x..."
}
```

**Response (202 Accepted):**
```json
{
  "accepted": true,
  "taskId": "task-123",
  "estimatedTime": 300
}
```

**Error Response (400):**
```json
{
  "error": "Invalid task: prompt is required"
}
```

### GET /task/:taskId

Check task status.

**Response (running):**
```json
{
  "status": "running",
  "task": {
    "taskId": "task-123",
    "type": "prompt",
    "startedAt": "2026-02-01T19:30:00Z"
  }
}
```

**Response (not found):**
```json
{
  "error": "Task not found or completed"
}
```

### DELETE /task/:taskId

Cancel a running task.

**Response:**
```json
{
  "cancelled": true
}
```

## WebSocket API

Connect to `ws://host:port` for real-time communication.

### Messages

**Task Submission:**
```json
{
  "type": "task",
  "payload": {
    "taskId": "ws-001",
    "type": "code-review",
    "prompt": "Review this code...",
    "clientDid": "did:agentmesh:base:0x..."
  }
}
```

**Task Result:**
```json
{
  "type": "result",
  "payload": {
    "taskId": "ws-001",
    "status": "completed",
    "output": "The code looks good...",
    "duration": 5432
  }
}
```

**Error:**
```json
{
  "type": "error",
  "error": "Invalid task format"
}
```

## Capability Card

The bridge exposes an A2A-compatible capability card at `/.well-known/agent.json`:

```json
{
  "name": "My Claude Code Agent",
  "description": "AI-powered development agent",
  "skills": ["typescript", "javascript", "python"],
  "pricing": {
    "model": "per-task",
    "price": "5 USDC"
  },
  "endpoints": {
    "task": "/task",
    "ws": "/ws"
  },
  "version": "1.0.0"
}
```

## Executor Interface

The bridge uses an executor to run tasks. The default executor runs Claude Code CLI.

### ClaudeExecutor

```typescript
class ClaudeExecutor {
  constructor(options: {
    workspaceDir: string;
    allowedCommands: string[];
    timeout: number;
  });
  
  // Execute a task
  execute(task: TaskInput): Promise<TaskResult>;
  
  // Cancel a running task
  cancelTask(taskId: string): boolean;
}
```

### Execution Process

1. Validate command is allowed
2. Spawn Claude CLI process: `claude -p "prompt" --output-format text`
3. Capture stdout/stderr
4. Apply timeout
5. Return result

### Environment Variables

The executor sets these environment variables:
- `CI=true` - Disables interactive mode

## Security

### Command Allowlist

Only commands in `ALLOWED_COMMANDS` can be executed:
```
ALLOWED_COMMANDS=claude,git,npm,node
```

### Workspace Isolation

Tasks run in `WORKSPACE_DIR`, which should be:
- Isolated from system files
- Not contain sensitive data
- Have appropriate permissions

### Timeout Protection

Tasks are killed after `TASK_TIMEOUT` seconds to prevent:
- Resource exhaustion
- Runaway processes
- Denial of service

### Recommendations

1. Run in Docker container
2. Use non-root user
3. Limit network access
4. Monitor resource usage
5. Log all tasks for audit

## Integration with AgentMesh

### Registration (Future)

When AgentMesh SDK is complete:

```typescript
import { AgentMeshClient } from '@agentmesh/sdk';

const mesh = new AgentMeshClient({ privateKey });

await mesh.register({
  name: config.name,
  description: config.description,
  skills: config.skills,
  pricing: { model: 'per-task', price: config.pricePerTask },
  endpoints: {
    http: `https://your-domain.com`,
    ws: `wss://your-domain.com`
  }
});
```

### Payment Handling (Future)

```typescript
// Verify payment before executing
bridge.onTask(async (task) => {
  if (task.escrowId) {
    const escrow = await mesh.getEscrow(task.escrowId);
    if (escrow.amount < config.pricePerTask) {
      throw new Error('Insufficient payment');
    }
  }
  
  const result = await executor.execute(task);
  
  // Confirm delivery
  if (task.escrowId) {
    await mesh.confirmDelivery(task.escrowId, hash(result.output));
  }
  
  return result;
});
```

## Error Codes

| Code | Description |
|------|-------------|
| `INVALID_TASK` | Task validation failed |
| `COMMAND_NOT_ALLOWED` | Command not in allowlist |
| `TASK_TIMEOUT` | Task exceeded time limit |
| `EXECUTION_FAILED` | Claude CLI returned error |
| `TASK_NOT_FOUND` | Task ID not found |
| `ALREADY_RUNNING` | Task with same ID already running |

## Versioning

Current version: `1.0.0`

The bridge follows semantic versioning:
- Major: Breaking API changes
- Minor: New features, backward compatible
- Patch: Bug fixes
