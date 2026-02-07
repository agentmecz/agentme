/**
 * x402 Payment Middleware Tests
 *
 * TDD tests for HTTP 402 Payment Required flow.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { generatePrivateKey } from 'viem/accounts';
import {
  createX402Middleware,
  createPaymentRequirement,
  parsePaymentPayload,
  validatePayment,
  createTestPaymentPayload,
  createSignedPaymentPayload,
  _resetUsedNonces,
  X402Config,
  X402_HEADERS,
  PaymentPayload,
  PaymentRequirement,
} from '../src/middleware/x402.js';

// Test configuration
const TEST_CONFIG: X402Config = {
  payTo: '0x1234567890123456789012345678901234567890',
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  priceUsdc: 0.01,
  network: 'eip155:8453',
  validityPeriod: 300,
};

describe('x402 Middleware', () => {
  let app: Express;

  beforeEach(() => {
    _resetUsedNonces();
    app = express();
    app.use(express.json());
    app.use(createX402Middleware(TEST_CONFIG));

    // Protected endpoint
    app.post('/task', (req: Request, res: Response) => {
      res.json({ success: true, payment: (req as any).x402Payment });
    });

    // Free endpoints
    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok' });
    });

    app.get('/.well-known/agent.json', (_req: Request, res: Response) => {
      res.json({ name: 'test-agent' });
    });
  });

  // ========== TDD Tests: 402 Response Without Payment ==========

  describe('requests without payment', () => {
    it('returns 402 Payment Required for protected endpoint', async () => {
      const res = await request(app).post('/task').send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
    });

    it('includes x-payment-required header in 402 response', async () => {
      const res = await request(app).post('/task').send({ taskId: 'test-1' });

      expect(res.headers[X402_HEADERS.PAYMENT_REQUIRED]).toBeDefined();
    });

    it('returns payment requirements in body', async () => {
      const res = await request(app).post('/task').send({ taskId: 'test-1' });

      expect(res.body.error).toBe('Payment Required');
      expect(res.body.paymentInfo).toBeDefined();
      expect(res.body.paymentInfo.scheme).toBe('exact');
      expect(res.body.paymentInfo.network).toBe('eip155:8453');
    });

    it('returns USDC contract address in payment requirements', async () => {
      const res = await request(app).post('/task').send({ taskId: 'test-1' });

      expect(res.body.paymentInfo.resource).toBe(TEST_CONFIG.usdcAddress);
    });

    it('returns recipient address in payment requirements', async () => {
      const res = await request(app).post('/task').send({ taskId: 'test-1' });

      expect(res.body.paymentInfo.payTo).toBe(TEST_CONFIG.payTo);
    });

    it('returns correct amount in micro USDC', async () => {
      const res = await request(app).post('/task').send({ taskId: 'test-1' });

      // 0.01 USDC = 10000 micro USDC (6 decimals)
      expect(res.body.paymentInfo.maxAmountRequired).toBe('10000');
    });

    it('returns future validUntil timestamp', async () => {
      const res = await request(app).post('/task').send({ taskId: 'test-1' });
      const now = Math.floor(Date.now() / 1000);

      expect(res.body.paymentInfo.validUntil).toBeGreaterThan(now);
    });
  });

  // ========== TDD Tests: Skip Payment for Free Endpoints ==========

  describe('free endpoints bypass payment', () => {
    it('allows /health without payment', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('allows /.well-known/agent.json without payment', async () => {
      const res = await request(app).get('/.well-known/agent.json');

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('test-agent');
    });
  });

  // ========== TDD Tests: Valid Payment Accepted ==========

  describe('requests with valid payment', () => {
    it('accepts valid payment and returns 200', async () => {
      // Use a properly signed payment
      const privateKey = generatePrivateKey();
      const payment = await createSignedPaymentPayload(TEST_CONFIG, privateKey);
      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('attaches payment info to request', async () => {
      // Use a properly signed payment
      const privateKey = generatePrivateKey();
      const payment = await createSignedPaymentPayload(TEST_CONFIG, privateKey);
      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.body.payment).toBeDefined();
      expect(res.body.payment.amount).toBe(payment.amount);
    });
  });

  // ========== TDD Tests: Invalid Payment Rejected ==========

  describe('requests with invalid payment', () => {
    it('rejects malformed payment header', async () => {
      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, 'not-valid-base64!!!')
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid Payment');
    });

    it('rejects payment with wrong network', async () => {
      const payment = createTestPaymentPayload(TEST_CONFIG);
      payment.network = 'eip155:1'; // Ethereum mainnet instead of Base
      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      expect(res.body.message).toContain('Network mismatch');
    });

    it('rejects payment with insufficient amount', async () => {
      const payment = createTestPaymentPayload(TEST_CONFIG);
      payment.amount = '1'; // 0.000001 USDC instead of 0.01 USDC
      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      expect(res.body.message).toContain('Insufficient');
    });

    it('rejects payment with wrong token contract', async () => {
      const payment = createTestPaymentPayload(TEST_CONFIG);
      payment.resource = '0x0000000000000000000000000000000000000000'; // Wrong token
      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      expect(res.body.message).toContain('Token contract mismatch');
    });

    it('rejects expired payment', async () => {
      const payment = createTestPaymentPayload(TEST_CONFIG);
      payment.timestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      expect(res.body.message).toContain('expired');
    });

    it('rejects payment without signature', async () => {
      const payment = createTestPaymentPayload(TEST_CONFIG);
      payment.signature = '';
      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      expect(res.body.message).toContain('signature');
    });
  });
});

// ========== TDD Tests: Helper Functions ==========

describe('createPaymentRequirement', () => {
  it('creates requirement with correct network', () => {
    const requirement = createPaymentRequirement(TEST_CONFIG);
    expect(requirement.network).toBe('eip155:8453');
  });

  it('converts USDC price to micro USDC', () => {
    const requirement = createPaymentRequirement(TEST_CONFIG);
    // 0.01 USDC = 10000 micro USDC
    expect(requirement.maxAmountRequired).toBe('10000');
  });

  it('uses exact scheme', () => {
    const requirement = createPaymentRequirement(TEST_CONFIG);
    expect(requirement.scheme).toBe('exact');
  });

  it('sets validUntil in the future', () => {
    const requirement = createPaymentRequirement(TEST_CONFIG);
    const now = Math.floor(Date.now() / 1000);
    expect(requirement.validUntil).toBeGreaterThan(now);
    expect(requirement.validUntil).toBeLessThanOrEqual(now + 300 + 1);
  });
});

describe('parsePaymentPayload', () => {
  it('parses valid base64 encoded JSON', () => {
    const payload: PaymentPayload = {
      scheme: 'exact',
      network: 'eip155:8453',
      signature: '0xabc123',
      resource: TEST_CONFIG.usdcAddress,
      amount: '10000',
      from: '0x1234',
      timestamp: Date.now(),
      nonce: '12345',
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

    const result = parsePaymentPayload(encoded);

    expect(result).not.toBeNull();
    expect(result?.scheme).toBe('exact');
    expect(result?.network).toBe('eip155:8453');
  });

  it('returns null for invalid base64', () => {
    const result = parsePaymentPayload('not-valid-base64!!!');
    expect(result).toBeNull();
  });

  it('returns null for non-JSON content', () => {
    const encoded = Buffer.from('not json').toString('base64');
    const result = parsePaymentPayload(encoded);
    expect(result).toBeNull();
  });
});

describe('validatePayment', () => {
  let requirement: PaymentRequirement;
  let validPayload: PaymentPayload;

  beforeEach(() => {
    requirement = createPaymentRequirement(TEST_CONFIG);
    validPayload = createTestPaymentPayload(TEST_CONFIG);
  });

  it('validates correct payment', () => {
    const result = validatePayment(validPayload, requirement);
    expect(result.valid).toBe(true);
  });

  it('rejects mismatched scheme', () => {
    validPayload.scheme = 'streaming';
    const result = validatePayment(validPayload, requirement);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('scheme');
  });

  it('rejects mismatched network', () => {
    validPayload.network = 'eip155:1';
    const result = validatePayment(validPayload, requirement);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Network');
  });

  it('rejects insufficient amount', () => {
    validPayload.amount = '1';
    const result = validatePayment(validPayload, requirement);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Insufficient');
  });

  it('accepts higher amount than required', () => {
    validPayload.amount = '1000000'; // 1 USDC instead of 0.01 USDC
    const result = validatePayment(validPayload, requirement);
    expect(result.valid).toBe(true);
  });

  it('validates payment timing', () => {
    validPayload.timestamp = Math.floor(Date.now() / 1000) - 600;
    const result = validatePayment(validPayload, requirement);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });
});

// ========== H-10: Nonce rollback vulnerability tests ==========

describe('x402 nonce not rolled back on validation failure', () => {
  let app: Express;

  beforeEach(() => {
    _resetUsedNonces();
    app = express();
    app.use(express.json());
    app.use(createX402Middleware(TEST_CONFIG));
    app.post('/task', (req: Request, res: Response) => {
      res.json({ success: true });
    });
  });

  it('does not allow nonce reuse after a failed validation', async () => {
    // Create a payment with wrong network (will fail basic validation)
    const payment = createTestPaymentPayload(TEST_CONFIG);
    payment.network = 'eip155:1'; // Wrong network
    const nonce = payment.nonce;
    const encoded = Buffer.from(JSON.stringify(payment)).toString('base64');

    // First request: should fail validation
    const res1 = await request(app)
      .post('/task')
      .set(X402_HEADERS.PAYMENT_SIGNATURE, encoded)
      .send({ taskId: 'test-1' });
    expect(res1.status).toBe(402);

    // Second request: fix the network but reuse the same nonce
    payment.network = 'eip155:8453';
    const encoded2 = Buffer.from(JSON.stringify(payment)).toString('base64');
    const res2 = await request(app)
      .post('/task')
      .set(X402_HEADERS.PAYMENT_SIGNATURE, encoded2)
      .send({ taskId: 'test-2' });

    // Nonce should be rejected (already used)
    expect(res2.status).toBe(402);
    expect(res2.body.message).toContain('Nonce');
  });
});

// ========== H-10: Nonce uniqueness tests ==========

describe('x402 nonce generation uses crypto randomness', () => {
  it('createTestPaymentPayload generates unique nonces', () => {
    const p1 = createTestPaymentPayload(TEST_CONFIG);
    const p2 = createTestPaymentPayload(TEST_CONFIG);
    expect(p1.nonce).not.toBe(p2.nonce);
  });

  it('createSignedPaymentPayload generates unique nonces', async () => {
    const privateKey = generatePrivateKey();
    const p1 = await createSignedPaymentPayload(TEST_CONFIG, privateKey);
    const p2 = await createSignedPaymentPayload(TEST_CONFIG, privateKey);
    expect(p1.nonce).not.toBe(p2.nonce);
  });
});
