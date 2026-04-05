#!/usr/bin/env node
/**
 * AgoraMesh MCP Server — Streamable HTTP entrypoint.
 * Usage: AGORAMESH_NODE_URL=https://api.agoramesh.ai node dist/http.js
 */

import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createMcpRequestHandler } from './http-handler.js';

const port = parseInt(process.env.AGORAMESH_MCP_PORT || '3401');
const nodeUrl = process.env.AGORAMESH_NODE_URL || 'http://localhost:8080';
const bridgeUrl = process.env.AGORAMESH_BRIDGE_URL || undefined;
const publicUrl = process.env.AGORAMESH_PUBLIC_URL || 'https://api.agoramesh.ai';
const authToken = process.env.AGORAMESH_MCP_AUTH_TOKEN || undefined;
const corsOrigin = process.env.AGORAMESH_CORS_ORIGIN || undefined;
const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS || undefined;

// TLS configuration for HTTPS + mTLS (optional, falls back to HTTP)
const tlsCertPath = process.env.TLS_CERT;
const tlsKeyPath = process.env.TLS_KEY;
const tlsCaPath = process.env.TLS_CA;
const tlsCa = tlsCaPath ? readFileSync(tlsCaPath) : undefined;

const handler = createMcpRequestHandler({ nodeUrl, bridgeUrl, publicUrl, authToken, corsOrigin, allowedOrigins, tlsCa });

const httpServer = (tlsCertPath && tlsKeyPath)
  ? createHttpsServer(
    {
      cert: readFileSync(tlsCertPath),
      key: readFileSync(tlsKeyPath),
      ...(tlsCa && { ca: tlsCa, requestCert: true, rejectUnauthorized: true }),
    },
    handler,
  )
  : createHttpServer(handler);

const protocol = (tlsCertPath && tlsKeyPath) ? 'https' : 'http';
httpServer.listen(port, () => {
  console.error(`AgoraMesh MCP ${protocol.toUpperCase()} server running on port ${port} (node: ${nodeUrl}${bridgeUrl ? `, bridge: ${bridgeUrl}` : ''})`);
});

// Graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 30_000;
let shutdownInProgress = false;

function shutdown(signal: string) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  console.error(`[MCP] ${signal} received, graceful shutdown initiated...`);

  // Force exit after timeout
  const forceTimer = setTimeout(() => {
    console.error('[MCP] Force exit after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS + 5_000);
  forceTimer.unref();

  // Stop accepting new connections and close existing ones
  httpServer.close(() => {
    console.error('[MCP] HTTP server closed');
    process.exit(0);
  });

  // Close keep-alive connections that would delay shutdown
  httpServer.closeAllConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
