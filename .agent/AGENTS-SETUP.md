# 🤖 How to Summon Agents in Prism File Hero

Your 20 specialist agents are now ready to use! Here's how to invoke them.

## ✅ Installation Complete

We've set up:
- ✅ **agents-registry.json** - Master registry of all 20 agents
- ✅ **agents-loader.js** - CLI tool to load agents
- ✅ **mcp_config.json** - Updated MCP server configuration

## 🚀 How to Summon Agents

### Method 1: Using Triggers (Natural Language)
Simply mention an agent's trigger keywords in your request:

```
# Triggers the backend-specialist
"I need help with my API endpoints and database schema"

# Triggers the frontend-specialist  
"I need to build a React component with Tailwind CSS"

# Triggers the debugger
"There's an error in my code, help me troubleshoot"

# Triggers the devops-engineer
"I need to set up Docker and CI/CD for my project"
```

### Method 2: Using Agent Loader CLI
```bash
# List all available agents
node .agent/agents-loader.js list

# Load a specific agent
node .agent/agents-loader.js load backend-specialist

# Search for an agent
node .agent/agents-loader.js search database
```

### Method 3: Using Workflows (Slash Commands)
Workflows in `.agent/workflows/` provide structured procedures:

```
/brainstorm    - Socratic discovery & ideation
/create        - Create new features
/debug         - Debug issues systematically
/deploy        - Deploy your application
/enhance       - Improve existing code
/orchestrate   - Multi-agent coordination
/plan          - Break down tasks
/preview       - Preview changes
/test          - Run tests
```

### Method 4: Direct Agent ID Reference
Reference agents by their ID:

```
@orchestrator          - Multi-agent coordination
@backend-specialist    - API & server-side logic
@frontend-specialist   - Web UI/UX
@database-architect    - Schema & SQL
@debugger              - Root cause analysis
@security-auditor      - Security compliance
@test-engineer         - Testing strategies
```

## 📋 Available Agents

| Agent | Purpose | Triggers |
|-------|---------|----------|
| **orchestrator** | Multi-agent coordination | orchestrate, coordinate |
| **backend-specialist** | API, server logic | backend, api, database, auth |
| **frontend-specialist** | Web UI/UX | frontend, ui, react, web |
| **database-architect** | Schema, SQL | database, schema, sql |
| **mobile-developer** | iOS, Android, React Native | mobile, ios, android |
| **game-developer** | Game logic & mechanics | game, graphics, physics |
| **devops-engineer** | CI/CD, Docker, deployment | devops, docker, deploy |
| **security-auditor** | Security compliance | security, audit, vulnerability |
| **penetration-tester** | Offensive security | penetration, pentest, red-team |
| **test-engineer** | Testing strategies | test, testing, qa, e2e |
| **debugger** | Root cause analysis | debug, bug, error, troubleshoot |
| **performance-optimizer** | Speed optimization | performance, optimize, speed |
| **seo-specialist** | SEO & ranking | seo, ranking, search |
| **documentation-writer** | Manuals & docs | documentation, docs, manual |
| **product-manager** | Requirements & stories | product, requirements |
| **product-owner** | Backlog & strategy | backlog, mvp, strategy |
| **qa-automation-engineer** | E2E testing | qa, automation, playwright |
| **code-archaeologist** | Legacy code refactoring | refactor, legacy, code-review |
| **project-planner** | Task planning | plan, planning, discovery |
| **explorer-agent** | Codebase analysis | explore, analysis |

## 🎯 Example Usage

### Example 1: Get Backend Help
```
"I need to build a REST API with Node.js and PostgreSQL"

→ Triggers: backend-specialist
→ Loads skills: api-patterns, nodejs-best-practices, database-design
```

### Example 2: Debug an Issue
```
"My React component is rendering twice and causing performance issues"

→ Triggers: debugger OR frontend-specialist
→ Loads skills: systematic-debugging, react-best-practices
```

### Example 3: Multi-Agent Orchestration
```
"Plan, build, test, and deploy a new feature"

→ Triggers: orchestrator
→ Coordinates: project-planner, backend-specialist, test-engineer, devops-engineer
```

## 🔧 Configuration

The agent system reads from:
- `.agent/agents-registry.json` - Registry of all agents
- `.agent/mcp_config.json` - MCP server configuration  
- `.agent/agents/*.md` - Individual agent definitions
- `.agent/skills/` - Skills loaded by agents
- `.agent/workflows/` - Slash command workflows

## ❓ Troubleshooting

### "I can't summon agents"
1. Verify all 20 `.md` files exist in `.agent/agents/`
2. Run `node .agent/agents-loader.js list` to verify registry
3. Check that trigger keywords match your request

### "Agent loaded but not responding"
1. Ensure the agent's `.md` file is properly formatted (YAML frontmatter)
2. Check that required skills are present in `.agent/skills/`
3. Verify MCP configuration in `.agent/mcp_config.json`

### "Skills not loading"
Check that skills referenced in agent files exist:
```bash
node .agent/agents-loader.js search skill-name
```

## 📚 Learn More

- See `ARCHITECTURE.md` for complete system overview
- Check individual agent files in `agents/` for detailed personas
- Review workflows in `workflows/` for structured procedures

---

**Ready to summon your agents!** 🚀
