#!/usr/bin/env node

/**
 * Prism File Hero - Agents Loader
 * Loads and initializes all agents from registry
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, 'agents-registry.json');
const AGENTS_DIR = path.join(__dirname, 'agents');

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error('❌ Registry not found at:', REGISTRY_PATH);
    process.exit(1);
  }
  
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  return registry;
}

function loadAgent(agentId) {
  const registry = loadRegistry();
  const agentConfig = registry.agents.find(a => a.id === agentId);
  
  if (!agentConfig) {
    console.error(`❌ Agent "${agentId}" not found in registry`);
    console.log('Available agents:', registry.agents.map(a => a.id).join(', '));
    process.exit(1);
  }
  
  const agentPath = path.join(__dirname, agentConfig.file);
  if (!fs.existsSync(agentPath)) {
    console.error(`❌ Agent file not found: ${agentPath}`);
    process.exit(1);
  }
  
  console.log(`✅ Loaded agent: ${agentConfig.name} (${agentId})`);
  return {
    id: agentConfig.id,
    name: agentConfig.name,
    triggers: agentConfig.triggers,
    file: agentPath,
    content: fs.readFileSync(agentPath, 'utf-8')
  };
}

function listAgents() {
  const registry = loadRegistry();
  console.log('\n📋 Available Agents:\n');
  
  registry.agents.forEach(agent => {
    console.log(`  ${agent.id.padEnd(25)} - ${agent.name}`);
    console.log(`    Triggers: ${agent.triggers.join(', ')}`);
  });
  
  console.log(`\nTotal: ${registry.agents.length} agents\n`);
}

function searchAgents(keyword) {
  const registry = loadRegistry();
  const results = registry.agents.filter(agent =>
    agent.id.includes(keyword) ||
    agent.name.toLowerCase().includes(keyword.toLowerCase()) ||
    agent.triggers.some(t => t.includes(keyword.toLowerCase()))
  );
  
  if (results.length === 0) {
    console.log(`❌ No agents found matching "${keyword}"`);
    return;
  }
  
  console.log(`\n🔍 Search results for "${keyword}":\n`);
  results.forEach(agent => {
    console.log(`  ${agent.id} - ${agent.name}`);
  });
  console.log('');
}

// CLI
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'list':
    listAgents();
    break;
  case 'load':
    if (!arg) {
      console.error('Usage: agents-loader load <agent-id>');
      process.exit(1);
    }
    loadAgent(arg);
    break;
  case 'search':
    if (!arg) {
      console.error('Usage: agents-loader search <keyword>');
      process.exit(1);
    }
    searchAgents(arg);
    break;
  default:
    console.log('Prism File Hero - Agents Loader\n');
    console.log('Usage:');
    console.log('  agents-loader list                    - List all agents');
    console.log('  agents-loader load <agent-id>        - Load specific agent');
    console.log('  agents-loader search <keyword>       - Search agents\n');
    console.log('Example:');
    console.log('  agents-loader load backend-specialist');
    console.log('  agents-loader search database\n');
}
