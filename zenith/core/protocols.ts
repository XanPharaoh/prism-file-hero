/**
 * ZENITH 2.0: Declarative Protocol Definitions
 * These interfaces define the structured requirements for the Antigravity 2.0 AI-native engine.
 */

export enum BuildState {
    IDLE = 'IDLE',
    GENERATING = 'GENERATING',
    VALIDATING = 'VALIDATING',
    FIXING = 'FIXING',
    VERIFIED = 'VERIFIED',
    FAILED = 'FAILED'
}

export interface Atom {
    id: string;
    requirement: string;
    acceptanceCriteria: string[];
    dependencies: string[];
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
}

export interface ReviewFinding {
    line: number;
    message: string;
    severity: 'error' | 'warning' | 'info';
    ruleId: string;
    suggestion?: string;
}

export interface DecompositionProtocol {
    validateRequirement(requirement: string): boolean;
    getStructuralConstraints(): string[];
}

export interface BuildVerifyLoopProtocol {
    getExecutionSteps(atom: Atom): string[];
    getValidationCommands(atom: Atom): string[];
    getMaxRetries(): number;
}

export interface RulesEngineProtocol {
    getRuleset(): { id: string; description: string; priority: number }[];
    getDiagnosticBlueprint(): string;
}
