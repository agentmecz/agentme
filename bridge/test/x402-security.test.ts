/**
 * x402 Signature Verification Security Tests
 *
 * TDD tests for ECDSA signature verification in x402 payment flow.
 * These tests verify that the signature actually proves ownership of the payer address.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { hashMessage, recoverAddress } from 'viem';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import {
  createX402Middleware,
  validatePayment,
  createPaymentRequirement,
  createTestPaymentPayload,
  verifyPaymentSignature,
  createSignedPaymentPayload,
  _resetUsedNonces,
  X402Config,
  X402_HEADERS,
  PaymentPayload,
} from '../src/middleware/x402.js';

// Test configuration
const TEST_CONFIG: X402Config = {
  payTo: '0x1234567890123456789012345678901234567890',
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  priceUsdc: 0.01,
  network: 'eip155:8453',
  validityPeriod: 300,
};

describe('x402 Signature Verification Security', () => {
  let app: Express;

  beforeEach(() => {
    _resetUsedNonces();
    app = express();
    app.use(express.json());
    app.use(createX402Middleware(TEST_CONFIG));

    app.post('/task', (req: Request, res: Response) => {
      res.json({ success: true, payment: (req as any).x402Payment });
    });
  });

  // ========== RED Phase: Tests that should fail with current implementation ==========

  describe('rejects invalid signatures', () => {
    it('rejects payment with invalid signature (random bytes)', async () => {
      const payment = createTestPaymentPayload(TEST_CONFIG);
      // Invalid signature - just random hex that won't recover to any address
      payment.signature = '0x' + 'ff'.repeat(65);
      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      expect(res.body.message).toMatch(/signature/i);
    });

    it('rejects payment with mismatched payer address', async () => {
      // Generate a real signature from a different account
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      const payment = createTestPaymentPayload(TEST_CONFIG);
      // Set `from` to a different address than the one that signed
      payment.from = '0x0000000000000000000000000000000000000001';

      // Create a valid signature from our account (but from address doesn't match)
      const message = createPaymentMessage(payment);
      const signature = await account.signMessage({ message });
      payment.signature = signature;

      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      expect(res.body.message).toMatch(/signer.*mismatch|address.*mismatch/i);
    });

    it('rejects payment with tampered amount after signing', async () => {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      const payment: PaymentPayload = {
        scheme: 'exact',
        network: TEST_CONFIG.network || 'eip155:8453',
        signature: '',
        resource: TEST_CONFIG.usdcAddress,
        amount: '10000', // Original amount
        from: account.address,
        timestamp: Math.floor(Date.now() / 1000),
        nonce: Date.now().toString(),
      };

      // Sign with original amount
      const message = createPaymentMessage(payment);
      payment.signature = await account.signMessage({ message });

      // Tamper with amount after signing
      payment.amount = '1'; // Changed amount

      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      // After tampering, either the signature check fails OR the basic validation catches the amount
      expect(res.body.message).toMatch(/signature|tamper|mismatch|insufficient/i);
    });
  });

  describe('accepts valid signatures', () => {
    it('accepts payment with valid ECDSA signature', async () => {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      const payment: PaymentPayload = {
        scheme: 'exact',
        network: TEST_CONFIG.network || 'eip155:8453',
        signature: '',
        resource: TEST_CONFIG.usdcAddress,
        amount: '10000',
        from: account.address,
        timestamp: Math.floor(Date.now() / 1000),
        nonce: Date.now().toString(),
      };

      // Create valid signature
      const message = createPaymentMessage(payment);
      payment.signature = await account.signMessage({ message });

      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('accepts payment using createSignedPaymentPayload helper', async () => {
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
  });

  describe('rejects expired payments with valid signatures', () => {
    it('rejects expired payment even with valid ECDSA signature', async () => {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      // Create a payment with an expired timestamp (10 minutes ago)
      const payment: PaymentPayload = {
        scheme: 'exact',
        network: TEST_CONFIG.network || 'eip155:8453',
        signature: '',
        resource: TEST_CONFIG.usdcAddress,
        amount: '10000',
        from: account.address,
        timestamp: Math.floor(Date.now() / 1000) - 600, // 10 minutes ago - expired
        nonce: Date.now().toString(),
      };

      // Create a VALID signature for the expired payment
      const message = createPaymentMessage(payment);
      payment.signature = await account.signMessage({ message });

      const encodedPayment = Buffer.from(JSON.stringify(payment)).toString('base64');

      const res = await request(app)
        .post('/task')
        .set(X402_HEADERS.PAYMENT_SIGNATURE, encodedPayment)
        .send({ taskId: 'test-1' });

      // Should reject for expiration, not invalid signature
      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Payment Invalid');
      expect(res.body.message).toMatch(/expired/i);
    });
  });
});

describe('verifyPaymentSignature function', () => {
  it('returns false for invalid signature bytes', async () => {
    const payment = createTestPaymentPayload(TEST_CONFIG);
    payment.signature = '0x' + 'ff'.repeat(65);

    const result = await verifyPaymentSignature(payment);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it('returns false when recovered address does not match from', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const payment: PaymentPayload = {
      scheme: 'exact',
      network: 'eip155:8453',
      signature: '',
      resource: TEST_CONFIG.usdcAddress,
      amount: '10000',
      from: '0x0000000000000000000000000000000000000001', // Different address
      timestamp: Math.floor(Date.now() / 1000),
      nonce: Date.now().toString(),
    };

    const message = createPaymentMessage(payment);
    payment.signature = await account.signMessage({ message });

    const result = await verifyPaymentSignature(payment);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signer.*mismatch|address.*mismatch/i);
  });

  it('returns true for valid signature matching from address', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const payment: PaymentPayload = {
      scheme: 'exact',
      network: 'eip155:8453',
      signature: '',
      resource: TEST_CONFIG.usdcAddress,
      amount: '10000',
      from: account.address,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: Date.now().toString(),
    };

    const message = createPaymentMessage(payment);
    payment.signature = await account.signMessage({ message });

    const result = await verifyPaymentSignature(payment);
    expect(result.valid).toBe(true);
  });

  it('detects tampered payment data', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const payment: PaymentPayload = {
      scheme: 'exact',
      network: 'eip155:8453',
      signature: '',
      resource: TEST_CONFIG.usdcAddress,
      amount: '10000',
      from: account.address,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: Date.now().toString(),
    };

    const message = createPaymentMessage(payment);
    payment.signature = await account.signMessage({ message });

    // Tamper with data
    payment.amount = '1';

    const result = await verifyPaymentSignature(payment);
    expect(result.valid).toBe(false);
  });
});

/**
 * Creates the message that should be signed for a payment.
 * This is the canonical format that both signer and verifier use.
 */
function createPaymentMessage(payment: PaymentPayload): string {
  const { signature, ...paymentWithoutSig } = payment;
  return JSON.stringify(paymentWithoutSig);
}
