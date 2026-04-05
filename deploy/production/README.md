# AgoraMesh Production Deployment

## TLS Setup

Inter-service communication uses mTLS (mutual TLS) with a self-signed internal CA. Each service (node, bridge, mcp) has its own certificate signed by the CA and verifies peer certificates against the same CA.

### Generate Certificates

```bash
cd deploy/production/certs
./generate-certs.sh
```

This creates:
- `ca.pem` / `ca-key.pem` — Internal CA (10-year validity)
- `node.pem` / `node-key.pem` — Node service certificate
- `bridge.pem` / `bridge-key.pem` — Bridge service certificate
- `mcp.pem` / `mcp-key.pem` — MCP service certificate

Each certificate includes SANs for the Docker service name and localhost.

### How It Works

| Service | Server TLS | Client TLS |
|---------|-----------|------------|
| Node    | HTTPS on :8080, verifies client certs | — |
| Bridge  | HTTPS on :3402, verifies client certs | Verifies node cert via CA |
| MCP     | HTTPS on :3403, verifies client certs | Verifies node + bridge certs via CA |

The `docker-compose.yml` mounts certificates as read-only volumes and sets:
- `TLS_CERT` / `TLS_KEY` — Service certificate and key paths
- `TLS_CA` — CA certificate path (enables mTLS client verification)
- `NODE_EXTRA_CA_CERTS` — Process-level CA trust (belt-and-suspenders)

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TLS_CERT` | Path to PEM-encoded service certificate | For HTTPS |
| `TLS_KEY` | Path to PEM-encoded service private key | For HTTPS |
| `TLS_CA` | Path to PEM-encoded CA certificate | For mTLS |
| `NODE_EXTRA_CA_CERTS` | Node.js process-level CA trust | Recommended |

When `TLS_CERT` and `TLS_KEY` are not set, services fall back to plain HTTP (development mode).

### Certificate Rotation

1. Run `generate-certs.sh` to create new certificates
2. Restart services: `docker compose restart`

The CA has a 10-year validity. Service certificates are valid for 1 year. Plan annual rotation for service certs.

### Troubleshooting

**Connection refused between services**: Verify certificates exist in `certs/` and are mounted correctly. Check `docker compose logs <service>` for TLS errors.

**Certificate verification failed**: Ensure all service certs are signed by the same CA. Regenerate with `generate-certs.sh` if needed.

**Development mode**: Omit `TLS_CERT`/`TLS_KEY` env vars to run services on plain HTTP.
