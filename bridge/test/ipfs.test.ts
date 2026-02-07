/**
 * IPFS Service Tests
 *
 * Tests for uploading capability cards to IPFS.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { IPFSService, IPFSConfig } from '../src/ipfs.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('IPFSService', () => {
  let service: IPFSService;

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with Pinata config', () => {
      const config: IPFSConfig = {
        provider: 'pinata',
        pinataJwt: 'test-jwt-token',
      };

      service = new IPFSService(config);
      expect(service).toBeDefined();
    });

    it('should create service with custom gateway', () => {
      const config: IPFSConfig = {
        provider: 'pinata',
        pinataJwt: 'test-jwt',
        gateway: 'https://custom-gateway.io/ipfs',
      };

      service = new IPFSService(config);
      expect(service.getGatewayUrl()).toBe('https://custom-gateway.io/ipfs');
    });

    it('should use default gateway if not specified', () => {
      const config: IPFSConfig = {
        provider: 'pinata',
        pinataJwt: 'test-jwt',
      };

      service = new IPFSService(config);
      expect(service.getGatewayUrl()).toBe('https://gateway.pinata.cloud/ipfs');
    });
  });

  describe('uploadJSON', () => {
    beforeEach(() => {
      service = new IPFSService({
        provider: 'pinata',
        pinataJwt: 'test-jwt-token',
      });
    });

    it('should upload JSON to Pinata and return CID', async () => {
      const testData = {
        name: 'Test Agent',
        description: 'A test capability card',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          IpfsHash: 'QmTestCID123456789',
          PinSize: 256,
          Timestamp: '2026-02-01T00:00:00Z',
        }),
      });

      const cid = await service.uploadJSON(testData);

      expect(cid).toBe('QmTestCID123456789');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.pinata.cloud/pinning/pinJSONToIPFS',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-jwt-token',
          }),
        })
      );
    });

    it('should include metadata in Pinata request', async () => {
      const testData = { name: 'Test' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          IpfsHash: 'QmTest',
          PinSize: 100,
          Timestamp: '2026-02-01T00:00:00Z',
        }),
      });

      await service.uploadJSON(testData, {
        name: 'capability-card',
        keyvalues: { type: 'agent-card' },
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.pinataMetadata).toEqual({
        name: 'capability-card',
        keyvalues: { type: 'agent-card' },
      });
    });

    it('should throw on Pinata API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(service.uploadJSON({ test: 'data' }))
        .rejects.toThrow('IPFS upload failed');
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.uploadJSON({ test: 'data' }))
        .rejects.toThrow('Network error');
    });
  });

  describe('getUrl', () => {
    it('should return full IPFS URL for CID', () => {
      service = new IPFSService({
        provider: 'pinata',
        pinataJwt: 'test-jwt',
        gateway: 'https://ipfs.io/ipfs',
      });

      const url = service.getUrl('QmTestCID');
      expect(url).toBe('https://ipfs.io/ipfs/QmTestCID');
    });
  });

  describe('isConfigured', () => {
    it('should return true when JWT is configured', () => {
      service = new IPFSService({
        provider: 'pinata',
        pinataJwt: 'test-jwt',
      });

      expect(service.isConfigured()).toBe(true);
    });

    it('should return false when JWT is empty', () => {
      service = new IPFSService({
        provider: 'pinata',
        pinataJwt: '',
      });

      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('createFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create service from environment variables', () => {
      process.env.PINATA_JWT = 'env-jwt-token';
      process.env.IPFS_GATEWAY = 'https://my-gateway.io/ipfs';

      const service = IPFSService.createFromEnv();

      expect(service.isConfigured()).toBe(true);
      expect(service.getGatewayUrl()).toBe('https://my-gateway.io/ipfs');
    });

    it('should create unconfigured service when env vars missing', () => {
      delete process.env.PINATA_JWT;

      const service = IPFSService.createFromEnv();

      expect(service.isConfigured()).toBe(false);
    });
  });
});
