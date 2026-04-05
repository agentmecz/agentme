/**
 * A2A JSON-RPC 2.0 Endpoint Tests
 *
 * Tests for POST / with JSON-RPC 2.0 protocol.
 * Methods (A2A v1.0.0): SendMessage, GetTask, CancelTask
 * Legacy aliases: message/send, tasks/get, tasks/cancel
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { BridgeServer, ErrorCode } from '../src/server.js';
import { A2A_ERRORS, A2A_ROLE, toWireState, parseA2AVersion } from '../src/a2a.js';
import type { AgentConfig } from '../src/types.js';

/** UUID v4 regex for validating messageId fields */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** ISO 8601 timestamp regex */
const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const testConfig: AgentConfig = {
  name: 'a2a-test-agent',
  description: 'Test agent for A2A JSON-RPC tests',
  skills: ['testing'],
  pricePerTask: 0.01,
  privateKey: '0x1234567890abcdef',
  workspaceDir: '/tmp/test-workspace',
  allowedCommands: ['claude'],
  taskTimeout: 60,
};

describe('A2A JSON-RPC 2.0 — POST /', () => {
  describe('without auth (requireAuth: false)', () => {
    let server: BridgeServer;
    let app: any;

    beforeAll(async () => {
      server = new BridgeServer({
        ...testConfig,
        rateLimit: { enabled: false },
      });
      app = (server as any).app;
    });

    afterAll(async () => {
      await server.stop();
    });

    describe('envelope validation', () => {
      it('rejects request without jsonrpc field', async () => {
        const res = await request(app)
          .post('/')
          .send({ id: 1, method: 'SendMessage' });

        expect(res.status).toBe(200);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_REQUEST.code);
      });

      it('rejects request without id field', async () => {
        const res = await request(app)
          .post('/')
          .send({ jsonrpc: '2.0', method: 'SendMessage' });

        expect(res.status).toBe(200);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_REQUEST.code);
      });

      it('rejects request without method field', async () => {
        const res = await request(app)
          .post('/')
          .send({ jsonrpc: '2.0', id: 1 });

        expect(res.status).toBe(200);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_REQUEST.code);
      });

      it('returns correct jsonrpc version in response', async () => {
        const res = await request(app)
          .post('/')
          .send({ jsonrpc: '2.0', id: 42, method: 'GetTask', params: { id: 'nonexistent' } });

        expect(res.body.jsonrpc).toBe('2.0');
        expect(res.body.id).toBe(42);
      });
    });

    describe('method: SendMessage', () => {
      it('executes task and returns A2A Task object', async () => {
        // Mock the executor to return a result
        const executor = (server as any).executor;
        const originalExecute = executor.execute.bind(executor);
        executor.execute = vi.fn().mockResolvedValueOnce({
          taskId: 'mock-a2a-task',
          status: 'completed',
          output: 'Hello from Claude!',
          duration: 500,
        });

        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-1',
            method: 'SendMessage',
            params: {
              message: {
                role: 'user',
                parts: [{ type: 'text', text: 'Say hello' }],
              },
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.result).toBeDefined();
        expect(res.body.result.id).toMatch(/^a2a-/);
        expect(res.body.result.messageId).toMatch(UUID_REGEX);
        expect(res.body.result.status.state).toBe('TASK_STATE_COMPLETED');
        expect(res.body.result.status.timestamp).toMatch(ISO_TIMESTAMP_REGEX);
        expect(res.body.result.artifacts).toBeDefined();
        expect(res.body.result.artifacts[0].artifactId).toMatch(/^art-/);
        expect(res.body.result.artifacts[0].parts[0].text).toBe('Hello from Claude!');
        expect(res.body.error).toBeUndefined();

        executor.execute = originalExecute;
      });

      it('rejects message without params.message', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-2',
            method: 'SendMessage',
            params: {},
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      });

      it('rejects message without text parts', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-3',
            method: 'SendMessage',
            params: {
              message: {
                role: 'user',
                parts: [{ type: 'image', url: 'http://example.com/img.png' }],
              },
            },
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      });

      it('accepts legacy method name message/send', async () => {
        const executor = (server as any).executor;
        const originalExecute = executor.execute.bind(executor);
        executor.execute = vi.fn().mockResolvedValueOnce({
          taskId: 'mock-legacy-task',
          status: 'completed',
          output: 'Legacy!',
          duration: 100,
        });

        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-legacy-send',
            method: 'message/send',
            params: {
              message: {
                role: 'user',
                parts: [{ type: 'text', text: 'Legacy method' }],
              },
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.result).toBeDefined();
        expect(res.body.result.status.state).toBe('TASK_STATE_COMPLETED');
        expect(res.body.error).toBeUndefined();

        executor.execute = originalExecute;
      });
    });

    describe('method: GetTask', () => {
      it('returns working status for pending task', async () => {
        // Directly insert a pending task so it stays in the map
        const pendingTasks = (server as any).pendingTasks as Map<string, unknown>;
        pendingTasks.set('a2a-lookup-task', {
          taskId: 'a2a-lookup-task',
          type: 'prompt',
          prompt: 'test',
          clientDid: 'did:test:a2a',
          timeout: 60,
        });

        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-get-1',
            method: 'GetTask',
            params: { id: 'a2a-lookup-task' },
          });

        expect(res.body.result).toBeDefined();
        expect(res.body.result.id).toBe('a2a-lookup-task');
        expect(res.body.result.messageId).toMatch(UUID_REGEX);
        expect(res.body.result.status.state).toBe('TASK_STATE_WORKING');
        expect(res.body.result.status.timestamp).toMatch(ISO_TIMESTAMP_REGEX);

        // Cleanup
        pendingTasks.delete('a2a-lookup-task');
      });

      it('returns TASK_NOT_FOUND for unknown task', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-get-2',
            method: 'GetTask',
            params: { id: 'does-not-exist' },
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.TASK_NOT_FOUND.code);
      });

      it('rejects without params.id', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-get-3',
            method: 'GetTask',
            params: {},
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      });

      it('accepts legacy method name tasks/get', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-get-legacy',
            method: 'tasks/get',
            params: { id: 'does-not-exist' },
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.TASK_NOT_FOUND.code);
      });
    });

    describe('method: CancelTask', () => {
      it('returns TASK_NOT_CANCELLABLE for unknown task', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-cancel-1',
            method: 'CancelTask',
            params: { id: 'nonexistent-task' },
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.TASK_NOT_CANCELLABLE.code);
      });

      it('rejects without params.id', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-cancel-2',
            method: 'CancelTask',
            params: {},
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      });

      it('accepts legacy method name tasks/cancel', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-cancel-legacy',
            method: 'tasks/cancel',
            params: { id: 'nonexistent-task' },
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.TASK_NOT_CANCELLABLE.code);
      });
    });

    describe('unknown method', () => {
      it('returns METHOD_NOT_FOUND error', async () => {
        const res = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            id: 'req-unknown',
            method: 'bogus/method',
          });

        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe(A2A_ERRORS.METHOD_NOT_FOUND.code);
      });
    });
  });

  describe('A2A discoverability', () => {
    let server: BridgeServer;
    let app: any;

    beforeAll(async () => {
      server = new BridgeServer({
        ...testConfig,
        rateLimit: { enabled: false },
        a2a: {
          endpoint: '/a2a',
          methods: ['SendMessage', 'GetTask', 'CancelTask'],
        },
      });
      app = (server as any).app;
    });

    afterAll(async () => {
      await server.stop();
    });

    it('serves /.well-known/a2a.json as alias for agent card', async () => {
      const agentRes = await request(app).get('/.well-known/agent.json');
      const a2aRes = await request(app).get('/.well-known/a2a.json');

      expect(a2aRes.status).toBe(200);
      expect(a2aRes.body.name).toBe(agentRes.body.name);
    });

    it('agent card includes a2a section with methods', async () => {
      const res = await request(app).get('/.well-known/agent.json');

      expect(res.body.a2a).toBeDefined();
      expect(res.body.a2a.endpoint).toBe('/a2a');
      expect(res.body.a2a.methods).toContain('SendMessage');
      expect(res.body.a2a.methods).toContain('GetTask');
      expect(res.body.a2a.methods).toContain('CancelTask');
    });
  });

  describe('with auth (requireAuth: true)', () => {
    let server: BridgeServer;
    let app: any;

    beforeAll(async () => {
      server = new BridgeServer({
        ...testConfig,
        requireAuth: true,
        apiToken: 'a2a-test-secret',
        rateLimit: { enabled: false },
      });
      app = (server as any).app;
    });

    afterAll(async () => {
      await server.stop();
    });

    it('returns 401 with rich error when unauthenticated', async () => {
      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 'req-auth-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [{ type: 'text', text: 'hello' }],
            },
          },
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(res.body.help).toBeDefined();
      expect(res.body.help.agentCard).toBe('/.well-known/agent.json');
    });

    it('succeeds with valid Bearer token', async () => {
      const executor = (server as any).executor;
      const originalExecute = executor.execute.bind(executor);
      executor.execute = vi.fn().mockResolvedValueOnce({
        taskId: 'mock-auth-task',
        status: 'completed',
        output: 'Authenticated!',
        duration: 100,
      });

      const res = await request(app)
        .post('/')
        .set('Authorization', 'Bearer a2a-test-secret')
        .send({
          jsonrpc: '2.0',
          id: 'req-auth-2',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [{ type: 'text', text: 'hello' }],
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.messageId).toMatch(UUID_REGEX);
      expect(res.body.result.status.state).toBe('TASK_STATE_COMPLETED');
      expect(res.body.result.status.timestamp).toMatch(ISO_TIMESTAMP_REGEX);

      executor.execute = originalExecute;
    });
  });
});

describe('A2A JSON-RPC 2.0 — POST /a2a (agent card endpoint)', () => {
  let server: BridgeServer;
  let app: any;

  beforeAll(async () => {
    server = new BridgeServer({
      ...testConfig,
      rateLimit: { enabled: false },
    });
    app = (server as any).app;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('returns valid JSON-RPC response for SendMessage', async () => {
    const executor = (server as any).executor;
    const originalExecute = executor.execute.bind(executor);
    executor.execute = vi.fn().mockResolvedValueOnce({
      taskId: 'mock-a2a-endpoint-task',
      status: 'completed',
      output: 'Hello from /a2a!',
      duration: 200,
    });

    const res = await request(app)
      .post('/a2a')
      .send({
        jsonrpc: '2.0',
        id: 'a2a-req-1',
        method: 'SendMessage',
        params: {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Say hello via /a2a' }],
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe('a2a-req-1');
    expect(res.body.result).toBeDefined();
    expect(res.body.result.id).toMatch(/^a2a-/);
    expect(res.body.result.messageId).toMatch(UUID_REGEX);
    expect(res.body.result.status.state).toBe('TASK_STATE_COMPLETED');
    expect(res.body.result.status.timestamp).toMatch(ISO_TIMESTAMP_REGEX);
    expect(res.body.result.artifacts).toBeDefined();
    expect(res.body.result.artifacts[0].artifactId).toMatch(/^art-/);
    expect(res.body.result.artifacts[0].parts[0].text).toBe('Hello from /a2a!');
    expect(res.body.error).toBeUndefined();

    executor.execute = originalExecute;
  });

  it('returns JSON-RPC error for invalid request', async () => {
    const res = await request(app)
      .post('/a2a')
      .send({ id: 1, method: 'SendMessage' });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_REQUEST.code);
  });

  it('returns METHOD_NOT_FOUND for unknown method', async () => {
    const res = await request(app)
      .post('/a2a')
      .send({
        jsonrpc: '2.0',
        id: 'a2a-req-unknown',
        method: 'bogus/method',
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.METHOD_NOT_FOUND.code);
  });

  it('handles GetTask via /a2a endpoint', async () => {
    const res = await request(app)
      .post('/a2a')
      .send({
        jsonrpc: '2.0',
        id: 'a2a-req-get',
        method: 'GetTask',
        params: { id: 'nonexistent-task' },
      });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe('a2a-req-get');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.TASK_NOT_FOUND.code);
  });

  it('handles CancelTask via /a2a endpoint', async () => {
    const res = await request(app)
      .post('/a2a')
      .send({
        jsonrpc: '2.0',
        id: 'a2a-req-cancel',
        method: 'CancelTask',
        params: { id: 'nonexistent-task' },
      });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe('a2a-req-cancel');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.TASK_NOT_CANCELLABLE.code);
  });
});

describe('A2A multi-type message parts', () => {
  let server: BridgeServer;
  let app: any;

  beforeAll(async () => {
    server = new BridgeServer({
      ...testConfig,
      rateLimit: { enabled: false },
    });
    app = (server as any).app;
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('text + data parts', () => {
    it('accepts message with text and data parts', async () => {
      const executor = (server as any).executor;
      const originalExecute = executor.execute.bind(executor);
      executor.execute = vi.fn().mockResolvedValueOnce({
        taskId: 'mock-multi-1',
        status: 'completed',
        output: 'Processed data',
        duration: 100,
      });

      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'multi-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'text', text: 'Analyze this data' },
                { type: 'data', data: { key: 'value', count: 42 } },
              ],
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status.state).toBe('TASK_STATE_COMPLETED');
      expect(res.body.result.artifacts[0].parts[0].text).toBe('Processed data');

      // Verify the executor received the enriched prompt with data context
      const submitCall = executor.execute.mock.calls[0][0];
      expect(submitCall.prompt).toContain('Analyze this data');
      expect(submitCall.prompt).toContain('Structured data');
      expect(submitCall.attachments).toHaveLength(1);
      expect(submitCall.attachments[0].type).toBe('data');
      expect(submitCall.attachments[0].data).toEqual({ key: 'value', count: 42 });

      executor.execute = originalExecute;
    });
  });

  describe('text + url parts', () => {
    it('accepts message with text and url parts', async () => {
      const executor = (server as any).executor;
      const originalExecute = executor.execute.bind(executor);
      executor.execute = vi.fn().mockResolvedValueOnce({
        taskId: 'mock-multi-2',
        status: 'completed',
        output: 'Fetched content',
        duration: 100,
      });

      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'multi-2',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'text', text: 'Review this file' },
                { type: 'url', url: 'https://example.com/doc.pdf', mediaType: 'application/pdf' },
              ],
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status.state).toBe('TASK_STATE_COMPLETED');

      const submitCall = executor.execute.mock.calls[0][0];
      expect(submitCall.prompt).toContain('Review this file');
      expect(submitCall.prompt).toContain('https://example.com/doc.pdf');
      expect(submitCall.attachments).toHaveLength(1);
      expect(submitCall.attachments[0].type).toBe('url');

      executor.execute = originalExecute;
    });
  });

  describe('text + raw parts', () => {
    it('accepts message with text and raw (base64) parts', async () => {
      const executor = (server as any).executor;
      const originalExecute = executor.execute.bind(executor);
      executor.execute = vi.fn().mockResolvedValueOnce({
        taskId: 'mock-multi-3',
        status: 'completed',
        output: 'File processed',
        duration: 100,
      });

      const base64Content = Buffer.from('Hello, world!').toString('base64');

      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'multi-3',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'text', text: 'Process this file' },
                {
                  type: 'raw',
                  raw: base64Content,
                  mediaType: 'text/plain',
                  filename: 'hello.txt',
                },
              ],
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status.state).toBe('TASK_STATE_COMPLETED');

      const submitCall = executor.execute.mock.calls[0][0];
      expect(submitCall.prompt).toContain('Process this file');
      expect(submitCall.prompt).toContain('hello.txt');
      expect(submitCall.attachments).toHaveLength(1);
      expect(submitCall.attachments[0].type).toBe('raw');
      expect(submitCall.attachments[0].filename).toBe('hello.txt');
      expect(submitCall.attachments[0].mediaType).toBe('text/plain');

      executor.execute = originalExecute;
    });
  });

  describe('metadata support', () => {
    it('passes metadata on parts through to attachments', async () => {
      const executor = (server as any).executor;
      const originalExecute = executor.execute.bind(executor);
      executor.execute = vi.fn().mockResolvedValueOnce({
        taskId: 'mock-meta-1',
        status: 'completed',
        output: 'Done',
        duration: 50,
      });

      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'meta-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                {
                  type: 'text',
                  text: 'With metadata',
                  metadata: { priority: 'high' },
                },
                {
                  type: 'data',
                  data: { x: 1 },
                  metadata: { source: 'sensor' },
                },
              ],
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();

      const submitCall = executor.execute.mock.calls[0][0];
      expect(submitCall.attachments).toHaveLength(1);
      expect(submitCall.attachments[0].metadata).toEqual({ source: 'sensor' });

      executor.execute = originalExecute;
    });
  });

  describe('artifact format', () => {
    it('returns artifacts with artifactId, name, description', async () => {
      const executor = (server as any).executor;
      const originalExecute = executor.execute.bind(executor);
      executor.execute = vi.fn().mockResolvedValueOnce({
        taskId: 'mock-art-1',
        status: 'completed',
        output: 'Result text',
        duration: 100,
      });

      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'art-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [{ type: 'text', text: 'Test artifact format' }],
            },
          },
        });

      expect(res.status).toBe(200);
      const artifact = res.body.result.artifacts[0];
      expect(artifact.artifactId).toMatch(/^art-/);
      expect(artifact.name).toBe('response');
      expect(artifact.description).toBe('Task execution result');
      expect(artifact.parts[0].type).toBe('text');
      expect(artifact.parts[0].text).toBe('Result text');

      executor.execute = originalExecute;
    });

    it('includes filesChanged as data part in artifact', async () => {
      const executor = (server as any).executor;
      const originalExecute = executor.execute.bind(executor);
      executor.execute = vi.fn().mockResolvedValueOnce({
        taskId: 'mock-art-2',
        status: 'completed',
        output: 'Files modified',
        duration: 100,
        filesChanged: ['src/main.ts', 'src/utils.ts'],
      });

      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'art-2',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [{ type: 'text', text: 'Modify files' }],
            },
          },
        });

      expect(res.status).toBe(200);
      const artifact = res.body.result.artifacts[0];
      expect(artifact.parts).toHaveLength(2);
      expect(artifact.parts[0].type).toBe('text');
      expect(artifact.parts[1].type).toBe('data');
      expect(artifact.parts[1].data.filesChanged).toEqual(['src/main.ts', 'src/utils.ts']);

      executor.execute = originalExecute;
    });
  });

  describe('validation of non-text parts', () => {
    it('rejects raw part with invalid base64', async () => {
      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'val-raw-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'text', text: 'Test' },
                { type: 'raw', raw: '!!!invalid!!!', mediaType: 'text/plain' },
              ],
            },
          },
        });

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      expect(res.body.error.data).toContain('invalid base64');
    });

    it('rejects raw part without mediaType', async () => {
      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'val-raw-2',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'text', text: 'Test' },
                { type: 'raw', raw: 'SGVsbG8=' },
              ],
            },
          },
        });

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      expect(res.body.error.data).toContain('mediaType');
    });

    it('rejects url part with non-http scheme', async () => {
      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'val-url-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'text', text: 'Test' },
                { type: 'url', url: 'ftp://evil.com/payload' },
              ],
            },
          },
        });

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      expect(res.body.error.data).toContain('http');
    });

    it('rejects data part with null data', async () => {
      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'val-data-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'text', text: 'Test' },
                { type: 'data', data: null },
              ],
            },
          },
        });

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      expect(res.body.error.data).toContain('data');
    });

    it('rejects unknown part type', async () => {
      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'val-unk-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'text', text: 'Test' },
                { type: 'audio', content: 'something' },
              ],
            },
          },
        });

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      expect(res.body.error.data).toContain('unknown part type');
    });

    it('still requires at least one text part', async () => {
      const res = await request(app)
        .post('/a2a')
        .send({
          jsonrpc: '2.0',
          id: 'val-notext-1',
          method: 'SendMessage',
          params: {
            message: {
              role: 'user',
              parts: [
                { type: 'data', data: { x: 1 } },
                { type: 'url', url: 'https://example.com/file' },
              ],
            },
          },
        });

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
      expect(res.body.error.data).toContain('No text part');
    });
  });
});

describe('A2A SendMessage validation (H-3)', () => {
  let server: BridgeServer;
  let app: any;

  beforeAll(async () => {
    server = new BridgeServer({
      ...testConfig,
      rateLimit: { enabled: false },
    });
    app = (server as any).app;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('rejects prompt exceeding max length', async () => {
    const res = await request(app)
      .post('/a2a')
      .send({
        jsonrpc: '2.0',
        id: 'val-1',
        method: 'SendMessage',
        params: {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'x'.repeat(200_000) }],
          },
        },
      });

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
    expect(res.body.error.data).toMatch(/prompt.*length|too long/i);
  });

  it('rejects empty prompt text', async () => {
    const res = await request(app)
      .post('/a2a')
      .send({
        jsonrpc: '2.0',
        id: 'val-2',
        method: 'SendMessage',
        params: {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: '' }],
          },
        },
      });

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
  });
});

describe('A2A-Version header', () => {
  let server: BridgeServer;
  let app: any;

  beforeAll(async () => {
    server = new BridgeServer({
      ...testConfig,
      rateLimit: { enabled: false },
    });
    app = (server as any).app;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('accepts request without A2A-Version header (defaults to 0.3)', async () => {
    const res = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 'ver-1',
        method: 'GetTask',
        params: { id: 'nonexistent' },
      });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe('2.0');
    // Should proceed normally (TASK_NOT_FOUND, not a version error)
    expect(res.body.error.code).toBe(A2A_ERRORS.TASK_NOT_FOUND.code);
  });

  it('accepts valid A2A-Version header (1.0)', async () => {
    const res = await request(app)
      .post('/')
      .set('A2A-Version', '1.0')
      .send({
        jsonrpc: '2.0',
        id: 'ver-2',
        method: 'GetTask',
        params: { id: 'nonexistent' },
      });

    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(A2A_ERRORS.TASK_NOT_FOUND.code);
  });

  it('accepts valid A2A-Version header (0.3)', async () => {
    const res = await request(app)
      .post('/')
      .set('A2A-Version', '0.3')
      .send({
        jsonrpc: '2.0',
        id: 'ver-3',
        method: 'SendMessage',
        params: {},
      });

    expect(res.status).toBe(200);
    // Should proceed to method validation (not version error)
    expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
  });

  it('rejects malformed A2A-Version header', async () => {
    const res = await request(app)
      .post('/')
      .set('A2A-Version', 'not-a-version')
      .send({
        jsonrpc: '2.0',
        id: 'ver-4',
        method: 'SendMessage',
        params: {},
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.INCOMPATIBLE_VERSION.code);
  });

  it('rejects A2A-Version with three segments', async () => {
    const res = await request(app)
      .post('/')
      .set('A2A-Version', '1.0.0')
      .send({
        jsonrpc: '2.0',
        id: 'ver-5',
        method: 'SendMessage',
        params: {},
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.INCOMPATIBLE_VERSION.code);
  });
});

describe('parseA2AVersion', () => {
  it('returns "0.3" for undefined', () => {
    expect(parseA2AVersion(undefined)).toBe('0.3');
  });

  it('returns "0.3" for empty string', () => {
    expect(parseA2AVersion('')).toBe('0.3');
  });

  it('returns "0.3" for whitespace-only', () => {
    expect(parseA2AVersion('  ')).toBe('0.3');
  });

  it('returns valid version for "1.0"', () => {
    expect(parseA2AVersion('1.0')).toBe('1.0');
  });

  it('returns valid version for "0.3"', () => {
    expect(parseA2AVersion('0.3')).toBe('0.3');
  });

  it('trims whitespace', () => {
    expect(parseA2AVersion(' 1.0 ')).toBe('1.0');
  });

  it('returns null for malformed version', () => {
    expect(parseA2AVersion('abc')).toBeNull();
  });

  it('returns null for three-segment version', () => {
    expect(parseA2AVersion('1.0.0')).toBeNull();
  });

  it('returns null for version with text', () => {
    expect(parseA2AVersion('v1.0')).toBeNull();
  });
});
