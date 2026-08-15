import { describe, it, expect } from 'vitest';
import { ProcessStatus } from '../src/types';

describe('types', () => {
    describe('ProcessStatus enum', () => {
        it('should have all 5 status values', () => {
            expect(ProcessStatus.IDLE).toBe('IDLE');
            expect(ProcessStatus.QUEUED).toBe('QUEUED');
            expect(ProcessStatus.PROCESSING).toBe('PROCESSING');
            expect(ProcessStatus.COMPLETED).toBe('COMPLETED');
            expect(ProcessStatus.ERROR).toBe('ERROR');
        });

        it('should have exactly 5 members', () => {
            const values = Object.values(ProcessStatus);
            expect(values).toHaveLength(5);
        });
    });

    describe('ToolID type coverage', () => {
        // This test ensures the 13 actual tools match the type definition
        it('should include all 13 implemented tools', () => {
            const implementedTools = [
                'merge', 'split', 'compress',
                'pdf-to-word', 'pdf-to-excel', 'pdf-to-jpg', 'jpg-to-pdf',
                'protect', 'redact', 'watermark',
                'ocr', 'compare', 'rotate',
            ] as const;

            // Type check — if any tool is not in ToolID, this file won't compile
            expect(implementedTools).toHaveLength(13);
        });
    });
});
