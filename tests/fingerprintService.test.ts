import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FingerprintService } from '../services/fingerprintService';

describe('FingerprintService', () => {
    let service: FingerprintService;
    let mockStorage: Storage;

    beforeEach(() => {
        const store: Record<string, string> = {};
        mockStorage = {
            getItem: vi.fn((key: string) => store[key] || null),
            setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
            removeItem: vi.fn((key: string) => { delete store[key]; }),
            clear: vi.fn(() => {
                for (const key in store) {
                    delete store[key];
                }
            }),
            length: 0,
            key: vi.fn(),
        } as unknown as Storage;

        // Inject our mock storage for testing
        service = new FingerprintService(mockStorage);
    });

    describe('generateFingerprint', () => {
        it('should generate a deterministic fingerprint string from an array of headers', async () => {
            const headers = ['Transaction Date', 'Reference', 'Amount', 'Balance'];
            const fingerprint1 = await service.generateFingerprint(headers);
            const fingerprint2 = await service.generateFingerprint(headers);

            expect(typeof fingerprint1).toBe('string');
            expect(fingerprint1).toEqual(fingerprint2);
            expect(fingerprint1.length).toBeGreaterThan(0);
        });

        it('should generate different fingerprints for different headers', async () => {
            const hash1 = await service.generateFingerprint(['Date', 'Description']);
            const hash2 = await service.generateFingerprint(['Description', 'Date']);
            expect(hash1).not.toEqual(hash2);
        });

        it('should generate identical fingerprints for different header casings (case-insensitive)', async () => {
            const hash1 = await service.generateFingerprint(['DATE']);
            const hash2 = await service.generateFingerprint(['date']);
            expect(hash1).toEqual(hash2);
        });
    });

    describe('Mapping Storage', () => {
        const sampleFingerprint = 'mocked-fingerprint-123';
        const sampleMapping = {
            'Transaction Date': 'Date',
            'Reference': 'Description',
            'Amount': 'Amount'
        };

        it('should save a column mapping to storage', () => {
            service.saveMapping(sampleFingerprint, sampleMapping);

            expect(mockStorage.setItem).toHaveBeenCalledWith(
                `prism_fingerprint_${sampleFingerprint}`,
                JSON.stringify(sampleMapping)
            );
        });

        it('should retrieve a previously saved column mapping', () => {
            service.saveMapping(sampleFingerprint, sampleMapping);
            const retrieved = service.getMapping(sampleFingerprint);

            expect(mockStorage.getItem).toHaveBeenCalledWith(`prism_fingerprint_${sampleFingerprint}`);
            expect(retrieved).toEqual(sampleMapping);
        });

        it('should return null for an unknown fingerprint', () => {
            const retrieved = service.getMapping('unknown-hash-999');
            expect(retrieved).toBeNull();
        });

        it('should return null if the stored value is invalid JSON', () => {
            // Manually poison the storage
            mockStorage.setItem(`prism_fingerprint_${sampleFingerprint}`, '{ bad json');
            const retrieved = service.getMapping(sampleFingerprint);

            expect(retrieved).toBeNull();
        });

        it('should clear all fingerprints from storage', () => {
            service.saveMapping('fp1', { 'A': 'B' });
            service.saveMapping('fp2', { 'C': 'D' });
            mockStorage.setItem('unrelated_key', 'value'); // Should not be cleared

            // Re-mock to test iteration/removal logic if clearAll is implemented via removeItem
            const store = {
                'prism_fingerprint_fp1': '{"A":"B"}',
                'prism_fingerprint_fp2': '{"C":"D"}',
                'unrelated_key': 'value'
            };

            (mockStorage as any).length = 3;
            (mockStorage.key as any) = vi.fn((i: number) => Object.keys(store)[i]);
            (mockStorage.removeItem as any) = vi.fn((k: string) => { delete store[k as keyof typeof store]; });

            service.clearAllMappings();

            expect(mockStorage.removeItem).toHaveBeenCalledWith('prism_fingerprint_fp1');
            expect(mockStorage.removeItem).toHaveBeenCalledWith('prism_fingerprint_fp2');
            expect(mockStorage.removeItem).not.toHaveBeenCalledWith('unrelated_key');
            expect(store['unrelated_key']).toBe('value');
            expect(Object.keys(store).length).toBe(1);
        });
    });
});
