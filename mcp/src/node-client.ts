/**
 * HTTP client for the AgoraMesh P2P node.
 * Replicates the proven pattern from bridge/src/discovery-proxy.ts.
 * Supports custom CA certificates for mTLS inter-service communication.
 */

import { createRequire } from 'node:module';
import {
  AgoraMeshError,
  AgoraMeshErrorCode,
  type SearchOptions,
  type TaskSubmission,
  type TaskOutcome,
} from '@agoramesh/sdk';

export type { SearchOptions, TaskSubmission, TaskOutcome };

const DEFAULT_TIMEOUT = 5000;
const BRIDGE_TIMEOUT = 65000; // Bridge sync timeout is 60s, give 5s buffer

export class NodeClientError extends AgoraMeshError {
  constructor(public statusCode: number, public body: string) {
    super(
      AgoraMeshErrorCode.NODE_REQUEST_FAILED,
      `P2P node returned ${statusCode}: ${body}`,
      { statusCode, body },
    );
    this.name = 'NodeClientError';
  }
}

export interface NodeClientOptions {
  bridgeUrl?: string;
  bridgeAuth?: string;
  /** PEM-encoded CA certificate for verifying service TLS certs (mTLS) */
  tlsCa?: Buffer;
}

export class NodeClient {
  private bridgeUrl?: string;
  private bridgeAuth: string;
  private extraFetchOptions: Record<string, unknown>;

  constructor(private nodeUrl: string, options?: NodeClientOptions) {
    this.bridgeUrl = options?.bridgeUrl;
    this.bridgeAuth = options?.bridgeAuth ?? 'FreeTier mcp-server';
    this.extraFetchOptions = {};

    if (options?.tlsCa) {
      // Create an undici Agent with custom CA for verifying internal service certs.
      // undici is built into Node.js 20+ and powers global fetch().
      // NODE_EXTRA_CA_CERTS is also set in Docker as a process-level fallback.
      try {
        const require = createRequire(import.meta.url);
        const undici = require('undici') as { Agent: new (opts: { connect: { ca: Buffer } }) => unknown };
        this.extraFetchOptions = { dispatcher: new undici.Agent({ connect: { ca: options.tlsCa } }) };
      } catch {
        // undici not resolvable — rely on NODE_EXTRA_CA_CERTS env var
      }
    }
  }

  async searchAgents(query?: string, options?: SearchOptions): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.minTrust !== undefined) params.set('minTrust', String(options.minTrust));

    const qs = params.toString();
    const url = `${this.nodeUrl}/agents/semantic${qs ? `?${qs}` : ''}`;
    const result = await this.get(url);

    // Node may return array directly or { agents: [...] }
    let items: unknown[];
    if (Array.isArray(result)) items = result;
    else if (result && typeof result === 'object' && 'agents' in result && Array.isArray((result as Record<string, unknown>).agents)) {
      items = (result as Record<string, unknown>).agents as unknown[];
    } else {
      return [];
    }

    // Unwrap search envelope: { did, card: {...}, trust: {...} } → flat object
    return items.map((item) => {
      const obj = item as Record<string, unknown>;
      if (obj.card && typeof obj.card === 'object') {
        const card = obj.card as Record<string, unknown>;
        return { ...card, did: obj.did, trust: obj.trust };
      }
      return item;
    });
  }

  async getAgent(did: string): Promise<unknown | null> {
    const url = `${this.nodeUrl}/agents/${did}`;
    return this.getOrNull(url);
  }

  async getTrust(did: string): Promise<unknown | null> {
    const url = `${this.nodeUrl}/trust/${did}`;
    return this.getOrNull(url);
  }

  async submitTask(input: TaskSubmission): Promise<TaskOutcome> {
    if (!this.bridgeUrl) throw new AgoraMeshError(AgoraMeshErrorCode.BRIDGE_NOT_CONFIGURED, 'Bridge URL not configured');

    const url = `${this.bridgeUrl}/task?wait=true`;
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': this.bridgeAuth,
      },
      body: JSON.stringify({
        agentDid: input.agentDid,
        prompt: input.prompt,
        ...(input.type && { type: input.type }),
        ...(input.timeout && { timeout: input.timeout }),
      }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new NodeClientError(response.status, text);
    }

    return response.json() as Promise<TaskOutcome>;
  }

  async getTask(taskId: string): Promise<TaskOutcome> {
    if (!this.bridgeUrl) throw new AgoraMeshError(AgoraMeshErrorCode.BRIDGE_NOT_CONFIGURED, 'Bridge URL not configured');

    const url = `${this.bridgeUrl}/task/${taskId}`;
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': this.bridgeAuth,
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new NodeClientError(response.status, text);
    }

    return response.json() as Promise<TaskOutcome>;
  }

  /** Wrapper around fetch() that injects the TLS dispatcher when configured. */
  private doFetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, ...this.extraFetchOptions } as RequestInit);
  }

  private async get(url: string): Promise<unknown> {
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new NodeClientError(response.status, text);
    }

    return response.json();
  }

  private async getOrNull(url: string): Promise<unknown | null> {
    const response = await this.doFetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      const text = await response.text();
      throw new NodeClientError(response.status, text);
    }

    return response.json();
  }
}
