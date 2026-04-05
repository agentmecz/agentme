#!/usr/bin/env bash
# Generate self-signed CA and per-service certificates for mTLS.
# Usage: ./generate-certs.sh [output-dir]
#
# Creates:
#   ca.pem / ca-key.pem          — Internal CA (10 year validity)
#   {node,bridge,mcp}.pem        — Service certificates (1 year validity)
#   {node,bridge,mcp}-key.pem    — Service private keys
#
# Each service cert includes SANs for the Docker service name and localhost.

set -euo pipefail

CERTS_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
CA_DAYS=3650
CERT_DAYS=365

mkdir -p "$CERTS_DIR"

echo "Generating AgoraMesh internal CA..."
openssl req -x509 -newkey rsa:4096 \
  -keyout "$CERTS_DIR/ca-key.pem" \
  -out "$CERTS_DIR/ca.pem" \
  -days "$CA_DAYS" -nodes \
  -subj "/CN=AgoraMesh Internal CA/O=AgoraMesh"

for SERVICE in node bridge mcp; do
  echo "Generating certificate for $SERVICE..."

  # Create CSR
  openssl req -newkey rsa:2048 \
    -keyout "$CERTS_DIR/$SERVICE-key.pem" \
    -out "$CERTS_DIR/$SERVICE.csr" \
    -nodes -subj "/CN=$SERVICE/O=AgoraMesh"

  # SAN config — Docker service name + localhost for dev
  cat > "$CERTS_DIR/$SERVICE-ext.cnf" <<EOF
[v3_req]
subjectAltName = DNS:$SERVICE,DNS:localhost,IP:127.0.0.1
extendedKeyUsage = serverAuth,clientAuth
EOF

  # Sign with CA
  openssl x509 -req \
    -in "$CERTS_DIR/$SERVICE.csr" \
    -CA "$CERTS_DIR/ca.pem" \
    -CAkey "$CERTS_DIR/ca-key.pem" \
    -CAcreateserial \
    -out "$CERTS_DIR/$SERVICE.pem" \
    -days "$CERT_DAYS" \
    -extfile "$CERTS_DIR/$SERVICE-ext.cnf" \
    -extensions v3_req

  # Clean up intermediates
  rm -f "$CERTS_DIR/$SERVICE.csr" "$CERTS_DIR/$SERVICE-ext.cnf"
done

# Clean up CA serial file
rm -f "$CERTS_DIR/ca.srl"

# Restrict key permissions
chmod 600 "$CERTS_DIR"/*-key.pem

echo ""
echo "Certificates generated in $CERTS_DIR:"
echo "  CA:     ca.pem / ca-key.pem"
echo "  Node:   node.pem / node-key.pem"
echo "  Bridge: bridge.pem / bridge-key.pem"
echo "  MCP:    mcp.pem / mcp-key.pem"
