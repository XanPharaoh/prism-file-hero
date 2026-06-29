import { describe, it, expect, vi } from 'vitest';
import { ZenithAgent } from '../../zenith/agent';

describe('ZenithAgent 2.0', () => {
    it('should follow the Protocol Director flow', async () => {
        const agent = new ZenithAgent();
        const consoleSpy = vi.spyOn(console, 'log');

        await agent.executeTask('Implement a login form');

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ZENITH 2.0] Protocol Director active'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Atomizer] Applying Decomposition Protocol'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Builder] Protocol: Executing Atom'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ZENITH] Protocol: Execution Cycle complete'));
    });

    it('should apply the Rules Engine for reviews', async () => {
        const agent = new ZenithAgent();
        const consoleSpy = vi.spyOn(console, 'log');
        const findings = await agent.reviewCode('console.log("test")', 'test.ts');

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Reviewer] Protocol: Rules Engine active'));
        expect(Array.isArray(findings)).toBe(true);
    });
});
