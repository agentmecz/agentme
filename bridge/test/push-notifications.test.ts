/**
 * Push Notification CRUD + Extended Agent Card Auth Tests
 *
 * Tests for A2A v1.0.0 push notification support:
 * - JSON-RPC CRUD: CreatePushNotificationConfig, GetPushNotificationConfig,
 *   ListPushNotificationConfigs, DeletePushNotificationConfig
 * - REST CRUD: POST/GET/DELETE /tasks/:id/pushNotificationConfigs
 * - Extended agent card requires authentication
 * - Extended card includes additional skills/capabilities for authenticated clients
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { BridgeServer, ErrorCode } from '../src/server.js';
import { A2A_ERRORS } from '../src/a2a.js';
import type { AgentConfig, RichAgentConfig } from '../src/types.js';

const testConfig: AgentConfig = {
  name: 'push-notification-test-agent',
  description: 'Test agent for push notification tests',
  skills: ['testing'],
  pricePerTask: 0.01,
  privateKey: '0x1234567890abcdef',
  workspaceDir: '/tmp/test-workspace',
  allowedCommands: ['claude'],
  taskTimeout: 60,
};

// =============================================================================
// JSON-RPC Push Notification CRUD
// =============================================================================

describe('Push Notification CRUD — JSON-RPC', () => {
  let server: BridgeServer;
  let app: any;

  beforeAll(() => {
    server = new BridgeServer({
      ...testConfig,
      rateLimit: { enabled: false },
    });
    app = (server as any).app;
  });

  afterAll(async () => {
    await server.stop();
  });

  function jsonRpc(method: string, params?: Record<string, unknown>) {
    return request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      });
  }

  it('CreatePushNotificationConfig creates a config', async () => {
    const res = await jsonRpc('CreatePushNotificationConfig', {
      id: 'test-task-001',
      pushNotificationConfig: {
        url: 'https://example.com/webhook',
        token: 'secret-token',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.id).toMatch(/^pnc-/);
    expect(res.body.result.taskId).toBe('test-task-001');
    expect(res.body.result.pushNotificationConfig.url).toBe('https://example.com/webhook');
    expect(res.body.result.pushNotificationConfig.token).toBe('secret-token');
  });

  it('CreatePushNotificationConfig rejects missing pushNotificationConfig', async () => {
    const res = await jsonRpc('CreatePushNotificationConfig', {
      id: 'test-task-002',
    });

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
  });

  it('CreatePushNotificationConfig rejects invalid URL', async () => {
    const res = await jsonRpc('CreatePushNotificationConfig', {
      id: 'test-task-002',
      pushNotificationConfig: {
        url: 'not-a-url',
      },
    });

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
  });

  it('CreatePushNotificationConfig rejects missing taskId', async () => {
    const res = await jsonRpc('CreatePushNotificationConfig', {
      pushNotificationConfig: {
        url: 'https://example.com/webhook',
      },
    });

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.INVALID_PARAMS.code);
  });

  it('ListPushNotificationConfigs returns created configs', async () => {
    // Create a config first
    const createRes = await jsonRpc('CreatePushNotificationConfig', {
      id: 'test-task-list',
      pushNotificationConfig: {
        url: 'https://example.com/webhook-list',
      },
    });
    expect(createRes.body.result).toBeDefined();

    const res = await jsonRpc('ListPushNotificationConfigs', {
      id: 'test-task-list',
    });

    expect(res.body.result).toBeDefined();
    expect(Array.isArray(res.body.result)).toBe(true);
    expect(res.body.result.length).toBeGreaterThanOrEqual(1);
    expect(res.body.result[0].pushNotificationConfig.url).toBe('https://example.com/webhook-list');
  });

  it('GetPushNotificationConfig returns a specific config', async () => {
    // Create a config
    const createRes = await jsonRpc('CreatePushNotificationConfig', {
      id: 'test-task-get',
      pushNotificationConfig: {
        url: 'https://example.com/webhook-get',
      },
    });
    const configId = createRes.body.result.id;

    const res = await jsonRpc('GetPushNotificationConfig', {
      id: 'test-task-get',
      configId,
    });

    expect(res.body.result).toBeDefined();
    expect(res.body.result.id).toBe(configId);
    expect(res.body.result.pushNotificationConfig.url).toBe('https://example.com/webhook-get');
  });

  it('GetPushNotificationConfig returns error for nonexistent config', async () => {
    const res = await jsonRpc('GetPushNotificationConfig', {
      id: 'test-task-get',
      configId: 'nonexistent',
    });

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.PUSH_NOTIFICATION_CONFIG_NOT_FOUND.code);
  });

  it('DeletePushNotificationConfig removes a config', async () => {
    // Create
    const createRes = await jsonRpc('CreatePushNotificationConfig', {
      id: 'test-task-delete',
      pushNotificationConfig: {
        url: 'https://example.com/webhook-delete',
      },
    });
    const configId = createRes.body.result.id;

    // Delete
    const deleteRes = await jsonRpc('DeletePushNotificationConfig', {
      id: 'test-task-delete',
      configId,
    });
    expect(deleteRes.body.result).toEqual({ success: true });

    // Verify gone
    const getRes = await jsonRpc('GetPushNotificationConfig', {
      id: 'test-task-delete',
      configId,
    });
    expect(getRes.body.error).toBeDefined();
    expect(getRes.body.error.code).toBe(A2A_ERRORS.PUSH_NOTIFICATION_CONFIG_NOT_FOUND.code);
  });

  it('DeletePushNotificationConfig returns error for nonexistent config', async () => {
    const res = await jsonRpc('DeletePushNotificationConfig', {
      id: 'test-task-nonexistent',
      configId: 'nonexistent',
    });

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(A2A_ERRORS.PUSH_NOTIFICATION_CONFIG_NOT_FOUND.code);
  });
});

// =============================================================================
// REST Push Notification CRUD
// =============================================================================

describe('Push Notification CRUD — REST', () => {
  let server: BridgeServer;
  let app: any;

  beforeAll(() => {
    server = new BridgeServer({
      ...testConfig,
      rateLimit: { enabled: false },
    });
    app = (server as any).app;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('POST /tasks/:id/pushNotificationConfigs creates a config', async () => {
    const res = await request(app)
      .post('/tasks/rest-task-001/pushNotificationConfigs')
      .send({
        pushNotificationConfig: {
          url: 'https://example.com/rest-webhook',
          token: 'rest-token',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^pnc-/);
    expect(res.body.taskId).toBe('rest-task-001');
    expect(res.body.pushNotificationConfig.url).toBe('https://example.com/rest-webhook');
    expect(res.body.pushNotificationConfig.token).toBe('rest-token');
  });

  it('POST /tasks/:id/pushNotificationConfigs rejects missing config', async () => {
    const res = await request(app)
      .post('/tasks/rest-task-002/pushNotificationConfigs')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('POST /tasks/:id/pushNotificationConfigs rejects invalid URL', async () => {
    const res = await request(app)
      .post('/tasks/rest-task-002/pushNotificationConfigs')
      .send({
        pushNotificationConfig: { url: 'ftp://invalid' },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('GET /tasks/:id/pushNotificationConfigs lists configs', async () => {
    // Create
    await request(app)
      .post('/tasks/rest-task-list/pushNotificationConfigs')
      .send({
        pushNotificationConfig: { url: 'https://example.com/list-1' },
      });

    const res = await request(app).get('/tasks/rest-task-list/pushNotificationConfigs');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /tasks/:id/pushNotificationConfigs/:configId returns a config', async () => {
    const createRes = await request(app)
      .post('/tasks/rest-task-get/pushNotificationConfigs')
      .send({
        pushNotificationConfig: { url: 'https://example.com/get-1' },
      });
    const configId = createRes.body.id;

    const res = await request(app).get(`/tasks/rest-task-get/pushNotificationConfigs/${configId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(configId);
  });

  it('GET /tasks/:id/pushNotificationConfigs/:configId returns 404 for nonexistent', async () => {
    const res = await request(app).get('/tasks/rest-task-get/pushNotificationConfigs/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('DELETE /tasks/:id/pushNotificationConfigs/:configId removes a config', async () => {
    const createRes = await request(app)
      .post('/tasks/rest-task-del/pushNotificationConfigs')
      .send({
        pushNotificationConfig: { url: 'https://example.com/del-1' },
      });
    const configId = createRes.body.id;

    const res = await request(app).delete(`/tasks/rest-task-del/pushNotificationConfigs/${configId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify deleted
    const getRes = await request(app).get(`/tasks/rest-task-del/pushNotificationConfigs/${configId}`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE /tasks/:id/pushNotificationConfigs/:configId returns 404 for nonexistent', async () => {
    const res = await request(app).delete('/tasks/nonexistent-task/pushNotificationConfigs/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.NOT_FOUND);
  });
});

// =============================================================================
// Extended Agent Card auth requirement
// =============================================================================

describe('Extended Agent Card — auth requirement', () => {
  it('returns 401 for unauthenticated request when requireAuth is true', async () => {
    const server = new BridgeServer({
      ...testConfig,
      requireAuth: true,
      apiToken: 'secret-token-for-auth-test',
      rateLimit: { enabled: false },
    });
    const app = (server as any).app;

    // Request WITHOUT sending the token
    const res = await request(app).get('/extendedAgentCard');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);

    await server.stop();
  });

  it('returns 200 with extended card when authenticated via Bearer', async () => {
    const token = 'test-api-token-extended';
    const server = new BridgeServer({
      ...testConfig,
      apiToken: token,
      rateLimit: { enabled: false },
    });
    const app = (server as any).app;

    const res = await request(app)
      .get('/extendedAgentCard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('push-notification-test-agent');

    await server.stop();
  });

  it('returns 200 with extended card when authenticated via x-api-key', async () => {
    const token = 'test-api-key-extended';
    const server = new BridgeServer({
      ...testConfig,
      apiToken: token,
      rateLimit: { enabled: false },
    });
    const app = (server as any).app;

    const res = await request(app)
      .get('/extendedAgentCard')
      .set('x-api-key', token);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('push-notification-test-agent');

    await server.stop();
  });
});

// =============================================================================
// Extended Agent Card content
// =============================================================================

describe('Extended Agent Card — additional skills and capabilities', () => {
  let server: BridgeServer;
  let app: any;
  const token = 'test-token-for-extended-card';

  beforeAll(() => {
    server = new BridgeServer({
      ...testConfig,
      apiToken: token,
      rateLimit: { enabled: false },
    });
    app = (server as any).app;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('extended card includes pushNotifications capability', async () => {
    const res = await request(app)
      .get('/extendedAgentCard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.capabilities.pushNotifications).toBe(true);
  });

  it('extended card includes multiTurnConversations capability', async () => {
    const res = await request(app)
      .get('/extendedAgentCard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.capabilities.multiTurnConversations).toBe(true);
  });

  it('extended card includes taskCancellation capability', async () => {
    const res = await request(app)
      .get('/extendedAgentCard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.capabilities.taskCancellation).toBe(true);
  });

  it('extended card includes additional priority-execution skill', async () => {
    const res = await request(app)
      .get('/extendedAgentCard')
      .set('Authorization', `Bearer ${token}`);

    const skills = res.body.skills;
    const prioritySkill = skills.find((s: any) => s.id === 'priority-execution');
    expect(prioritySkill).toBeDefined();
    expect(prioritySkill.name).toBe('Priority Execution');
  });

  it('extended card includes additional extended-output skill', async () => {
    const res = await request(app)
      .get('/extendedAgentCard')
      .set('Authorization', `Bearer ${token}`);

    const skills = res.body.skills;
    const extOutputSkill = skills.find((s: any) => s.id === 'extended-output');
    expect(extOutputSkill).toBeDefined();
    expect(extOutputSkill.name).toBe('Extended Output');
  });

  it('public card does NOT include extended-only skills', async () => {
    const res = await request(app).get('/.well-known/agent.json');

    expect(res.status).toBe(200);
    const skills = res.body.skills;
    const prioritySkill = skills.find((s: any) => s.id === 'priority-execution');
    expect(prioritySkill).toBeUndefined();
  });
});

// =============================================================================
// Agent Card pushNotifications capability
// =============================================================================

describe('Agent Card — pushNotifications capability', () => {
  let server: BridgeServer;
  let app: any;

  beforeAll(() => {
    server = new BridgeServer({
      ...testConfig,
      rateLimit: { enabled: false },
    });
    app = (server as any).app;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('public agent card declares pushNotifications: true', async () => {
    const res = await request(app).get('/.well-known/agent.json');

    expect(res.status).toBe(200);
    expect(res.body.capabilities.pushNotifications).toBe(true);
  });

  it('public agent card declares streaming: true', async () => {
    const res = await request(app).get('/.well-known/agent.json');

    expect(res.body.capabilities.streaming).toBe(true);
  });
});
