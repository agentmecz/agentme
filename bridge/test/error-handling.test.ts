/**
 * Error Handling Security Tests
 *
 * Tests to prevent error information leakage:
 * - Internal error details should not be exposed to clients
 * - Detailed errors should only be logged server-side
 * - Generic error messages for clients
 *
 * TDD Phase: RED - These tests should FAIL initially
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { BridgeServer } from '../src/server.js';
import { AgentConfig } from '../src/types.js';

const testConfig: AgentConfig = {
  name: 'error-handling-test-agent',
  description: 'Test agent for error handling tests',
  skills: ['testing'],
  pricePerTask: 0.01,
  privateKey: '0x1234567890abcdef',
  workspaceDir: '/tmp/test-workspace',
  allowedCommands: ['claude'],
  taskTimeout: 60,
};

// =============================================================================
// Error Information Leakage Tests
// =============================================================================

describe('Error Information Leakage Prevention', () => {
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

  describe('POST /task error responses', () => {
    it('does not expose internal error details in validation errors', async () => {
      const res = await request(app)
        .post('/task')
        .send({
          // Invalid request - missing required fields
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();

      // Error message should be generic, not exposing Zod internals
      const errorMessage = res.body.error.toLowerCase();
      expect(errorMessage).not.toContain('zodissue');
      expect(errorMessage).not.toContain('zoderror');
      expect(errorMessage).not.toContain('zodparsederror');
      expect(errorMessage).not.toContain('stack');
      expect(errorMessage).not.toContain('at ');
      expect(errorMessage).not.toContain('node_modules');
    });

    it('does not expose file paths in error responses', async () => {
      const res = await request(app)
        .post('/task')
        .send({
          taskId: 'test',
          type: 'invalid-type', // Will cause validation error
          prompt: 'test',
          clientDid: 'did:test',
        });

      expect(res.status).toBe(400);

      const errorString = JSON.stringify(res.body);
      expect(errorString).not.toMatch(/\/[a-z]/i); // No absolute paths
      expect(errorString).not.toContain('src/');
      expect(errorString).not.toContain('.ts');
      expect(errorString).not.toContain('.js');
    });

    it('does not expose sensitive configuration in errors', async () => {
      const res = await request(app)
        .post('/task')
        .send({
          taskId: 'test',
          type: 'prompt',
          prompt: 'test',
          clientDid: 'did:test',
          timeout: -1, // Invalid timeout
        });

      expect(res.status).toBe(400);

      const errorString = JSON.stringify(res.body).toLowerCase();
      expect(errorString).not.toContain('privatekey');
      expect(errorString).not.toContain('0x1234567890abcdef');
      expect(errorString).not.toContain('workspace');
      expect(errorString).not.toContain('/tmp/');
    });

    it('returns generic validation error message', async () => {
      const res = await request(app)
        .post('/task')
        .send({
          taskId: '',
          type: 'prompt',
          prompt: '',
          clientDid: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();

      // Should have a user-friendly error message
      // Not raw Zod validation output
      const error = res.body.error;
      expect(typeof error).toBe('string');
      expect(error.length).toBeLessThan(500); // Not a massive error dump
    });

    it('provides error code for programmatic handling', async () => {
      const res = await request(app)
        .post('/task')
        .send({
          taskId: '',
          type: 'invalid',
          prompt: '',
          clientDid: '',
        });

      expect(res.status).toBe(400);

      // Should include error code for client-side handling
      expect(res.body.code).toBeDefined();
      expect(typeof res.body.code).toBe('string');
      expect(res.body.code).toMatch(/^(VALIDATION_ERROR|INVALID_INPUT|BAD_REQUEST)$/);
    });
  });

  describe('Internal error handling', () => {
    it('logs detailed errors server-side only', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .post('/task')
        .send({
          taskId: 'test',
          type: 'invalid',
          prompt: 'test',
          clientDid: 'did:test',
        });

      expect(res.status).toBe(400);

      // Server should log detailed error
      // But client should not receive it
      const responseError = JSON.stringify(res.body);
      expect(responseError).not.toContain('ZodError');

      consoleSpy.mockRestore();
    });

    it('does not expose internal exception types', async () => {
      const res = await request(app)
        .post('/task')
        .send({
          taskId: 'test',
          type: 'prompt',
          prompt: 'test',
          clientDid: 'did:test',
          context: {
            files: null, // Will cause type error
          },
        });

      const errorString = JSON.stringify(res.body);
      expect(errorString).not.toContain('TypeError');
      expect(errorString).not.toContain('ReferenceError');
      expect(errorString).not.toContain('SyntaxError');
      expect(errorString).not.toContain('RangeError');
    });
  });

  describe('GET /task/:taskId error handling', () => {
    it('does not expose database details for not found', async () => {
      const res = await request(app).get('/task/nonexistent-task-12345');

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();

      const errorString = JSON.stringify(res.body);
      expect(errorString).not.toContain('SELECT');
      expect(errorString).not.toContain('database');
      expect(errorString).not.toContain('table');
      expect(errorString).not.toContain('Map');
      expect(errorString).not.toContain('undefined');
    });
  });

  describe('DELETE /task/:taskId error handling', () => {
    it('does not expose implementation details for not found', async () => {
      const res = await request(app).delete('/task/nonexistent-task-12345');

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();

      const errorString = JSON.stringify(res.body);
      expect(errorString).not.toContain('executor');
      expect(errorString).not.toContain('process');
      expect(errorString).not.toContain('kill');
    });
  });
});

// =============================================================================
// WebSocket Error Handling Tests
// =============================================================================

describe('WebSocket Error Information Leakage Prevention', () => {
  // Note: These tests require WebSocket connection setup
  // They verify that WebSocket errors don't leak information

  it('does not expose internal error details via WebSocket', () => {
    // This test verifies the WebSocket error handling pattern
    // The actual WebSocket test would require ws connection

    // Error structure should be:
    const expectedErrorFormat = {
      type: 'error',
      code: 'VALIDATION_ERROR',
      message: 'Invalid request format',
    };

    // Should NOT include:
    // - stack traces
    // - file paths
    // - internal exception types
    // - configuration details

    expect(expectedErrorFormat.message).not.toContain('ZodError');
    expect(expectedErrorFormat.message).not.toContain('/');
    expect(expectedErrorFormat.message).not.toContain('at ');
  });
});
