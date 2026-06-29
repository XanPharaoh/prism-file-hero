import { Atom, BuildState } from './core/protocols';
import { Atomizer } from './core/atomizer';
import { Builder } from './core/builder';
import { Reviewer } from './core/reviewer';

export class ZenithAgent {
    private atomizer: Atomizer;
    private builder: Builder;
    private reviewer: Reviewer;

    constructor() {
        this.atomizer = new Atomizer();
        this.builder = new Builder();
        this.reviewer = new Reviewer();
    }

    async executeTask(taskDescription: string) {
        console.log(`[ZENITH 2.0] Protocol Director active for: ${taskDescription}`);

        // 1. Decomposition Phase
        const atoms = await this.atomizer.decompose(taskDescription);
        console.log(`[ZENITH] Protocol: Decomposition complete. ${atoms.length} atoms identified.`);

        // 2. Build-Verify Loop Phase
        for (const atom of atoms) {
            await this.builder.buildAndVerify(atom);
        }

        console.log(`[ZENITH] Protocol: Execution Cycle complete.`);
    }

    async reviewCode(fileContent: string, fileName: string) {
        console.log(`[ZENITH] Protocol: Diagnostic Review active for: ${fileName}`);
        return await this.reviewer.review(fileContent, fileName);
    }

    /**
     * ZENITH 2.0 Help Protocol
     * Explains the declarative structure and capabilities of the agent.
     */
    help() {
        return {
            agent: 'ZENITH 2.0 (Zero-Error Nexus)',
            paradigm: 'Declarative Protocol Director',
            capabilities: [
                'Atomic Decomposition (core/atomizer)',
                'Build-Verify Loop (core/builder)',
                'Rules Engine Diagnostic (core/reviewer)'
            ],
            protocols: {
                decomposition: 'Breaks complex PRDs into independently verifiable atoms.',
                execution: 'Continuous cycle of generation and validation until success.',
                review: 'Applies Antigravity IDE standards for deep diagnostic scans.'
            }
        };
    }
}
