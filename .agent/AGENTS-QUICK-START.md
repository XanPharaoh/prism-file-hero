# 🚀 Prism File Hero - Agent Quick Reference

## Available Agents (20 Total)

You can now invoke any agent directly using slash commands:

### Development Agents
- `/backend-specialist` - APIs, servers, databases, auth
- `/frontend-specialist` - React, UI, components, styling  
- `/database-architect` - Database design, optimization, migrations
- `/mobile-developer` - React Native, Flutter, iOS, Android
- `/game-developer` - Game logic, physics, graphics, multiplayer

### Quality & Testing
- `/test-engineer` - Unit, E2E, integration tests, TDD
- `/qa-automation-engineer` - Test automation, Playwright, CI/CD pipelines
- `/debugger` - Root cause analysis, error investigation
- `/performance-optimizer` - Profiling, optimization, benchmarking

### Security
- `/security-auditor` - Vulnerability audits, authentication, OWASP
- `/penetration-tester` - Offensive security, red teaming

### DevOps & Infrastructure
- `/devops-engineer` - CI/CD, Docker, deployment, monitoring
- `/documentation-writer` - API docs, README, guides, tutorials

### Architecture & Planning
- `/orchestrator` - Multi-agent coordination
- `/project-planner` - Task breakdown, roadmaps, milestones
- `/explorer-agent` - Codebase analysis, architecture review
- `/code-archaeologist` - Legacy code, refactoring, technical debt
- `/performance-optimizer` - Speed optimization, profiling

### Product
- `/product-manager` - Requirements, user stories, roadmapping
- `/product-owner` - Backlog management, MVP, strategy

### Marketing
- `/seo-specialist` - SEO optimization, rankings, analytics

---

## How to Use Agents

### Method 1: Direct Slash Command
```
/test-engineer help me write unit tests for reconciliationService.ts
```

### Method 2: Natural Trigger Keywords
```
"I need to optimize my database queries"
→ Automatically triggers /database-architect

"Help me debug this flaky test"
→ Automatically triggers /debugger or /test-engineer
```

### Method 3: Multi-Agent Coordination
```
/orchestrator I need to build a new payment feature with testing and deployment
→ Coordinates: project-planner, backend-specialist, test-engineer, devops-engineer
```

---

## Common Agent Use Cases

### I want to build a feature
→ `/project-planner` break it down, then `/backend-specialist` and `/frontend-specialist` implement

### I have a bug to fix
→ `/debugger` to find root cause, then `/test-engineer` to write regression test

### I need to deploy
→ `/devops-engineer` to plan deployment, then `/qa-automation-engineer` for E2E verification

### I'm refactoring legacy code
→ `/code-archaeologist` to analyze, then `/test-engineer` to ensure coverage

### I need to improve performance
→ `/performance-optimizer` to profile, then implement fixes

### I need database help
→ `/database-architect` for schema/optimization OR `/explorer-agent` for impact analysis

---

## Agent Skills Quick Reference

| Agent | Top Skills |
|-------|-----------|
| **backend-specialist** | REST APIs, Node.js, database queries, auth |
| **frontend-specialist** | React, Tailwind CSS, state management, accessibility |
| **database-architect** | SQL optimization, schema design, migrations, Prisma |
| **test-engineer** | Jest/Vitest, TDD, unit/E2E tests, coverage |
| **debugger** | Error analysis, systematic debugging, profiling |
| **devops-engineer** | GitHub Actions, Docker, blue-green deployment |
| **security-auditor** | OWASP Top 10, authentication, encryption |
| **project-planner** | Task breakdown, estimation, roadmapping |
| **explorer-agent** | Architecture analysis, dependency mapping |
| **orchestrator** | Multi-domain synthesis, conflict resolution |

---

## Tips for Best Results

✅ **Be specific**: `/test-engineer write unit tests for fnbExtractService.ts`  
✅ **Provide context**: "I have a React component that renders twice"  
✅ **Use triggers**: Just mention "database" and get `/database-architect` automatically  
✅ **Combine agents**: Use `/orchestrator` for complex tasks requiring multiple specialists  
✅ **Review output**: Agents provide reasoning - understand their recommendations  

---

## Example Workflows

### Flow 1: Build a Feature (Full Stack)
```
1. /project-planner break down "add bank statement export"
2. /backend-specialist design API endpoints
3. /frontend-specialist build export UI
4. /test-engineer write E2E tests
5. /devops-engineer setup deployment
6. /qa-automation-engineer add to CI/CD pipeline
```

### Flow 2: Fix a Bug (Complete)
```
1. /debugger analyze "why are transactions not reconciling?"
2. /database-architect check schema/queries
3. /test-engineer write failing test (TDD)
4. /backend-specialist fix the logic
5. /test-engineer verify tests pass
6. /qa-automation-engineer add E2E test to prevent regression
```

### Flow 3: Optimize Performance
```
1. /performance-optimizer profile the slow code
2. /explorer-agent map dependencies (understand impact)
3. /backend-specialist OR /frontend-specialist fix based on findings
4. /test-engineer ensure no regressions
5. /performance-optimizer validate improvement
```

---

## Still Having Trouble?

If agents aren't responding:

1. **Check the trigger**: Use exact agent name or keywords
2. **Check context**: Provide enough detail about what you need
3. **Try multi-agent**: Use `/orchestrator` for complex tasks
4. **Fallback to natural language**: Just explain your problem, agents will auto-trigger

---

**Happy coding! 🚀**

All 20 agents are ready to help you build world-class software.
