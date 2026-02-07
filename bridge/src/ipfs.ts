/**
 * IPFS Service
 *
 * Handles uploading capability cards and other data to IPFS.
 * Supports Pinata as the primary provider.
 *
 * @see https://docs.pinata.cloud/files/uploading-files
 */

/**
 * Supported IPFS providers.
 */
export type IPFSProvider = 'pinata';

/**
 * Configuration for the IPFS service.
 */
export interface IPFSConfig {
  /** IPFS provider to use */
  provider: IPFSProvider;
  /** Pinata JWT token for authentication */
  pinataJwt: string;
  /** Custom IPFS gateway URL (optional) */
  gateway?: string;
}

/**
 * Metadata for Pinata pinning.
 */
export interface PinataMetadata {
  /** Name for the pinned content */
  name?: string;
  /** Key-value pairs for filtering */
  keyvalues?: Record<string, string>;
}

/**
 * Response from Pinata pinJSONToIPFS endpoint.
 */
interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

/** Default Pinata gateway */
const DEFAULT_PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

/** Pinata API endpoint for JSON uploads */
const PINATA_JSON_ENDPOINT = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

/**
 * Service for uploading data to IPFS.
 *
 * @example
 * ```typescript
 * const ipfs = new IPFSService({
 *   provider: 'pinata',
 *   pinataJwt: process.env.PINATA_JWT!,
 * });
 *
 * const cid = await ipfs.uploadJSON({
 *   name: 'My Agent',
 *   description: 'Agent capability card',
 * });
 *
 * console.log(`Uploaded to: ${ipfs.getUrl(cid)}`);
 * ```
 */
export class IPFSService {
  private readonly config: IPFSConfig;
  private readonly gateway: string;

  /**
   * Create a new IPFS service.
   *
   * @param config - Service configuration
   */
  constructor(config: IPFSConfig) {
    this.config = config;
    this.gateway = config.gateway || DEFAULT_PINATA_GATEWAY;
  }

  /**
   * Create an IPFS service from environment variables.
   *
   * Environment variables:
   * - PINATA_JWT: Pinata JWT token
   * - IPFS_GATEWAY: Custom gateway URL (optional)
   *
   * @returns Configured IPFS service
   */
  static createFromEnv(): IPFSService {
    return new IPFSService({
      provider: 'pinata',
      pinataJwt: process.env.PINATA_JWT || '',
      gateway: process.env.IPFS_GATEWAY,
    });
  }

  /**
   * Check if the service is properly configured.
   *
   * @returns True if JWT is configured
   */
  isConfigured(): boolean {
    return this.config.pinataJwt !== '';
  }

  /**
   * Get the configured gateway URL.
   */
  getGatewayUrl(): string {
    return this.gateway;
  }

  /**
   * Get the full URL for a CID.
   *
   * @param cid - Content identifier
   * @returns Full gateway URL
   */
  getUrl(cid: string): string {
    return `${this.gateway}/${cid}`;
  }

  /**
   * Upload JSON data to IPFS.
   *
   * @param data - JSON-serializable data to upload
   * @param metadata - Optional Pinata metadata
   * @returns Content identifier (CID)
   * @throws Error if upload fails
   */
  async uploadJSON(
    data: unknown,
    metadata?: PinataMetadata
  ): Promise<string> {
    const body: {
      pinataContent: unknown;
      pinataMetadata?: PinataMetadata;
    } = {
      pinataContent: data,
    };

    if (metadata) {
      body.pinataMetadata = metadata;
    }

    const response = await fetch(PINATA_JSON_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.pinataJwt}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`IPFS upload failed: ${error}`);
    }

    const result = (await response.json()) as PinataResponse;
    return result.IpfsHash;
  }
}
