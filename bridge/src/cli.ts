#!/usr/bin/env node
import 'dotenv/config';
import { BridgeServer } from './server.js';
import { AgentConfig } from './types.js';

function loadConfig(): AgentConfig {
  const required = (key: string): string => {
    const value = process.env[key];
    if (!value) {
      console.error(`❌ Missing required env: ${key}`);
      console.error(`   Copy .env.example to .env and fill in values`);
      process.exit(1);
    }
    return value;
  };

  return {
    name: process.env.AGENT_NAME || 'Claude Code Agent',
    description: process.env.AGENT_DESCRIPTION || 'AI-powered development agent',
    skills: (process.env.AGENT_SKILLS || 'typescript,javascript').split(','),
    pricePerTask: parseFloat(process.env.AGENT_PRICE_PER_TASK || '5'),
    privateKey: required('AGENT_PRIVATE_KEY'),
    workspaceDir: process.env.WORKSPACE_DIR || process.cwd(),
    allowedCommands: (process.env.ALLOWED_COMMANDS || 'claude,git,npm,node').split(','),
    taskTimeout: parseInt(process.env.TASK_TIMEOUT || '300', 10),
  };
}

async function main() {
  console.log('🚀 AgentMesh Bridge - Claude Code Worker');
  console.log('=========================================\n');

  const config = loadConfig();
  const port = parseInt(process.env.BRIDGE_PORT || '3402', 10);
  const host = process.env.BRIDGE_HOST || '127.0.0.1';

  const server = new BridgeServer({ ...config, host });

  // Graceful shutdown
  async function shutdown(): Promise<void> {
    console.log('\n[Bridge] Shutting down...');
    await server.stop();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start(port);

  console.log('\n📡 Ready to receive tasks!');
  console.log(`   REST API: http://localhost:${port}/task`);
  console.log(`   WebSocket: ws://localhost:${port}`);
  console.log(`   Agent Card: http://localhost:${port}/.well-known/agent.json`);
  console.log('\nPress Ctrl+C to stop\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
