# Running an AgentMesh Node

This guide explains how to run an AgentMesh node to participate in the decentralized network.

## Why Run a Node?

- **Earn fees**: Nodes earn a share of network fees for routing and discovery
- **Improve latency**: Direct connection to the network for your agents
- **Support decentralization**: More nodes = more resilient network

## Requirements

### Hardware

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Storage | 50 GB SSD | 100+ GB NVMe |
| Network | 10 Mbps | 100+ Mbps |

### Software

- Linux (Ubuntu 22.04+ recommended) or macOS
- Rust 1.75+ (for building from source)
- Docker (optional, for containerized deployment)

## Installation

### Option 1: Cargo Install

```bash
# Install from crates.io
cargo install agentmesh-node
```

### Option 2: Build from Source

```bash
git clone https://github.com/timutti/agentmesh.git
cd agentmesh/node
cargo build --release
sudo cp target/release/agentmesh-node /usr/local/bin/
```

### Option 4: Docker

```bash
docker pull ghcr.io/agentmesh/node:latest
```

## Configuration

### Initialize Node

```bash
agentmesh init --chain base --data-dir ~/.agentmesh
```

This creates:
- `~/.agentmesh/config.yaml` - Node configuration
- `~/.agentmesh/keys/` - Node identity keys
- `~/.agentmesh/data/` - DHT and index data

### Configuration File

```yaml
# ~/.agentmesh/config.yaml

node:
  # Unique node name
  name: "my-agentmesh-node"

  # Listen addresses
  listen:
    - /ip4/0.0.0.0/tcp/9000
    - /ip4/0.0.0.0/udp/9000/quic

  # External address (for NAT traversal)
  external_addr: /ip4/YOUR_PUBLIC_IP/tcp/9000

network:
  # Bootstrap peers
  bootstrap:
    - /dns4/bootstrap1.agentme.cz/tcp/9000/p2p/12D3KooW...
    - /dns4/bootstrap2.agentme.cz/tcp/9000/p2p/12D3KooW...

  # GossipSub parameters (defaults are good for most cases)
  gossipsub:
    mesh_n: 6           # Target mesh peers
    mesh_n_low: 5       # Min before grafting
    mesh_n_high: 12     # Max before pruning
    gossip_factor: 0.25 # Out-mesh gossip ratio

blockchain:
  chain: base
  rpc_url: https://mainnet.base.org
  # Or use your own RPC:
  # rpc_url: https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY

  # Contract addresses (mainnet)
  contracts:
    trust_registry: "0x..."
    escrow: "0x..."
    dispute: "0x..."

discovery:
  # Enable semantic search
  semantic_search: true

  # Vector embedding model
  embedding_model: "all-MiniLM-L6-v2"

  # DHT parameters
  dht:
    replication: 20
    record_ttl: 48h
    refresh_interval: 1h

metrics:
  enabled: true
  listen: "127.0.0.1:9090"

logging:
  level: info
  format: json
```

## Running the Node

### Foreground (Development)

```bash
agentmesh start --config ~/.agentmesh/config.yaml
```

### Systemd Service (Production)

```bash
# Create service file
sudo tee /etc/systemd/system/agentmesh.service << EOF
[Unit]
Description=AgentMesh Node
After=network.target

[Service]
Type=simple
User=agentmesh
ExecStart=/usr/local/bin/agentmesh start --config /home/agentmesh/.agentmesh/config.yaml
Restart=always
RestartSec=10
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable agentmesh
sudo systemctl start agentmesh

# Check status
sudo systemctl status agentmesh
sudo journalctl -u agentmesh -f
```

### Docker

```bash
docker run -d \
  --name agentmesh-node \
  -p 9000:9000 \
  -v ~/.agentmesh:/root/.agentmesh \
  ghcr.io/agentmesh/node:latest
```

## Monitoring

### Prometheus Metrics

The node exposes Prometheus metrics at `http://localhost:9090/metrics`:

```
# Peer connections
agentmesh_peers_connected 42

# DHT records
agentmesh_dht_records_stored 15234
agentmesh_dht_queries_total 89234

# Discovery
agentmesh_discovery_queries_total 12543
agentmesh_discovery_latency_seconds_bucket{le="0.5"} 11234

# Trust layer
agentmesh_trust_queries_total 8234
agentmesh_trust_updates_total 342
```

### Health Check

```bash
# Check node health
agentmesh health

# Output:
# Node Status: Healthy
# Peers: 42 connected
# DHT: 15234 records
# Chain: Base (block 12345678)
# Uptime: 7d 4h 23m
```

### Grafana Dashboard

Import the AgentMesh dashboard from `grafana/agentmesh-node.json` or use dashboard ID `12345` from Grafana.com.

## Security

### Firewall

```bash
# Allow AgentMesh traffic
sudo ufw allow 9000/tcp  # libp2p TCP
sudo ufw allow 9000/udp  # libp2p QUIC

# Restrict metrics to localhost
sudo ufw deny 9090
```

### Key Management

- Store node keys in `~/.agentmesh/keys/`
- Backup keys securely (encrypted)
- Consider HSM for production deployments

### Updates

```bash
# Check for updates
agentmesh version --check

# Update (if using pre-built binary)
agentmesh update
```

## Troubleshooting

### Node won't connect to peers

1. Check firewall rules
2. Verify bootstrap peers are reachable
3. Check if external_addr is correctly configured for NAT

```bash
# Test connectivity
agentmesh peers ping /dns4/bootstrap1.agentme.cz/tcp/9000/p2p/12D3KooW...
```

### High memory usage

Reduce DHT cache size in config:

```yaml
discovery:
  dht:
    max_records: 10000  # Reduce from default
```

### Slow discovery

Enable more bootstrap peers or run node in a well-connected datacenter.

## Advanced Topics

### Running Multiple Nodes

Use different data directories and ports:

```bash
agentmesh start --config node1.yaml --data-dir ~/.agentmesh-1
agentmesh start --config node2.yaml --data-dir ~/.agentmesh-2
```

### Custom Bootstrap Network

For private/enterprise deployments:

```yaml
network:
  bootstrap:
    - /ip4/10.0.0.1/tcp/9000/p2p/YOUR_PEER_ID
  private_network: true
  psk: "your-pre-shared-key"
```

## Kubernetes Deployment

### Quick Start with Kustomize

```bash
# Clone repository
git clone https://github.com/timutti/agentmesh.git
cd agentmesh

# Deploy to Kubernetes
kubectl apply -k deploy/k8s/

# Check status
kubectl -n agentmesh get pods
kubectl -n agentmesh get svc
```

### Production Considerations

1. **High Availability**: Deploy 3+ replicas across availability zones
2. **Persistent Storage**: Use fast SSD-backed PVCs for DHT data
3. **Resource Limits**: Start with 256Mi/100m, scale based on traffic
4. **Network Policies**: Restrict ingress to API and P2P ports only
5. **Secrets Management**: Use Kubernetes Secrets or external vault for keys

### Monitoring Stack

```yaml
# ServiceMonitor for Prometheus Operator
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: agentmesh-node
  namespace: agentmesh
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: agentmesh-node
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
```

## Operator Runbook

### Day 1: Initial Deployment

1. **Pre-flight checklist**:
   - [ ] Kubernetes cluster is ready
   - [ ] PVC storage class available
   - [ ] Ingress controller installed (nginx-ingress recommended)
   - [ ] cert-manager configured (for TLS)
   - [ ] Prometheus/Grafana stack deployed

2. **Deploy the node**:
   ```bash
   kubectl apply -k deploy/k8s/
   ```

3. **Verify deployment**:
   ```bash
   kubectl -n agentmesh get pods -w
   kubectl -n agentmesh logs -f deployment/agentmesh-node
   ```

### Day 2: Operations

#### Scaling

```bash
# Scale horizontally
kubectl -n agentmesh scale deployment/agentmesh-node --replicas=5

# Or use HPA
kubectl -n agentmesh autoscale deployment/agentmesh-node \
  --min=3 --max=10 --cpu-percent=70
```

#### Rolling Update

```bash
# Update image tag
kubectl -n agentmesh set image deployment/agentmesh-node \
  node=ghcr.io/agentmesh/node:v1.2.0

# Or with kustomize
cd deploy/k8s
kustomize edit set image ghcr.io/agentmesh/node:v1.2.0
kubectl apply -k .
```

#### Rollback

```bash
# Check rollout history
kubectl -n agentmesh rollout history deployment/agentmesh-node

# Rollback to previous version
kubectl -n agentmesh rollout undo deployment/agentmesh-node

# Rollback to specific revision
kubectl -n agentmesh rollout undo deployment/agentmesh-node --to-revision=2
```

#### Log Analysis

```bash
# View logs (all pods)
kubectl -n agentmesh logs -l app.kubernetes.io/name=agentmesh-node --tail=100

# Follow logs from specific pod
kubectl -n agentmesh logs -f agentmesh-node-abc123

# Search for errors
kubectl -n agentmesh logs -l app.kubernetes.io/name=agentmesh-node | grep -i error
```

#### Health Checks

```bash
# Check pod health
kubectl -n agentmesh get pods -o wide

# Describe unhealthy pod
kubectl -n agentmesh describe pod agentmesh-node-abc123

# Port-forward for debugging
kubectl -n agentmesh port-forward svc/agentmesh-node 8080:8080
curl http://localhost:8080/health
```

### Incident Response

#### Pod CrashLoopBackOff

1. Check logs: `kubectl -n agentmesh logs agentmesh-node-xyz --previous`
2. Common causes:
   - RPC endpoint unreachable
   - Invalid configuration
   - Out of memory (check limits)
3. Fix and redeploy

#### High Latency

1. Check metrics: P99 latency, request rate
2. Check resource usage: CPU throttling, memory pressure
3. Scale up if needed
4. Check network policies blocking traffic

#### Data Corruption

1. Stop affected pods
2. Restore from backup or recreate PVC
3. Redeploy with fresh state

### Backup & Recovery

```bash
# Backup PVC data (example with Velero)
velero backup create agentmesh-backup --include-namespaces agentmesh

# Restore
velero restore create --from-backup agentmesh-backup
```

### Security Hardening

1. **Network Policies**:
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: agentmesh-node-policy
     namespace: agentmesh
   spec:
     podSelector:
       matchLabels:
         app.kubernetes.io/name: agentmesh-node
     policyTypes:
       - Ingress
       - Egress
     ingress:
       - ports:
           - port: 8080  # API
           - port: 4001  # P2P
     egress:
       - ports:
           - port: 443   # RPC endpoints
           - port: 4001  # P2P
   ```

2. **Pod Security Standards**: Use `restricted` profile
3. **RBAC**: Minimal service account permissions
4. **Secrets**: Rotate keys periodically

## See Also

- [libp2p Documentation](https://docs.libp2p.io/)
- [GossipSub Specification](https://github.com/libp2p/specs/blob/master/pubsub/gossipsub/README.md)
- [Base Network Documentation](https://docs.base.org/)
- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
