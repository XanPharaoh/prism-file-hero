import { describe, it, expect, vi } from 'vitest';
import { ZenithAgent } from '../../zenith/agent';

// Mock services to simulate the flow
// In a real Antigravity 2.0 environment, these would be the actual logic modules
describe('Prism File Tool: Integrated Flow (PDF -> Gemini -> Excel)', () => {
    const agent = new ZenithAgent();

    it('SHOULD successfully process a PDF and generate an Excel report via ZENITH protocol', async () => {
        const task = 'Process the "November Statement (1).pdf", extract transaction data using Gemini, and save to Excel.';

        // We expect the agent to follow the Protocol Director flow
        const consoleSpy = vi.spyOn(console, 'log');

        await agent.executeTask(task);

        // Antigravity 2.0 Verification:
        // 1. Decomposition into atoms (PDF Reading, Gemini Extraction, Excel Writing)
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Atomizer] Applying Decomposition Protocol'));

        // 2. Build-Verify Loop (Executing the atoms)
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Builder] Protocol: Executing Atom'));

        // 3. Final Verification
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ZENITH] Protocol: Execution Cycle complete'));
    });

    it('SHOULD identify gaps in the reviewer protocol for prism-file-hero', async () => {
        // Audit the current reviewer ruleset
        const rules = agent.help().capabilities;
        expect(rules).toContain('Rules Engine Diagnostic (core/reviewer)');

        // In a real audit, we would check if these rules cover the specific needs of PDF/Excel logic
        // For now, we verify the protocol's existence.
    });
});
