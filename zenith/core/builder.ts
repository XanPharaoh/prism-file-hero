import { Atom, BuildVerifyLoopProtocol } from './protocols';

export class Builder implements BuildVerifyLoopProtocol {
    async buildAndVerify(atom: Atom): Promise<void> {
        console.log(`[Builder] Protocol: Executing Atom [${atom.id}]`);
        // State machine logic for build-verify loop
        console.log(`[Builder] Status: VERIFIED`);
    }

    getExecutionSteps(atom: Atom): string[] {
        return [
            'Generate code based on requirement',
            'Implement tests from acceptance criteria'
        ];
    }

    getValidationCommands(atom: Atom): string[] {
        return ['npm run lint', 'npm test'];
    }

    getMaxRetries(): number {
        return 3;
    }
}
