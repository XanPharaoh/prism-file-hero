export class FingerprintService {
    private storage: Storage;
    private PREFIX = 'prism_fingerprint_';

    constructor(storage: Storage = window.localStorage) {
        this.storage = storage;
    }

    /**
     * Generates a deterministic fingerprint hash from an array of headers.
     * Uses SHA-256 for a robust, collision-resistant hash.
     */
    async generateFingerprint(headers: string[]): Promise<string> {
        // Normalize the headers to ensure consistent hashing
        const normalized = headers.map(h => h.trim().toLowerCase()).join('|');
        const encoder = new TextEncoder();
        const data = encoder.encode(normalized);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    /**
     * Saves a mapping of raw columns to canonical columns against a fingerprint.
     */
    saveMapping(fingerprint: string, mapping: Record<string, string>): void {
        const key = `${this.PREFIX}${fingerprint}`;
        this.storage.setItem(key, JSON.stringify(mapping));
    }

    /**
     * Retrieves the saved mapping for a given fingerprint, if it exists.
     */
    getMapping(fingerprint: string): Record<string, string> | null {
        const key = `${this.PREFIX}${fingerprint}`;
        const item = this.storage.getItem(key);
        if (!item) return null;

        try {
            return JSON.parse(item);
        } catch (e) {
            console.error('Failed to parse fingerprint mapping from storage:', e);
            return null;
        }
    }

    /**
     * Clears all stored fingerprint mappings from storage.
     */
    clearAllMappings(): void {
        // Iterate securely to only remove our specific keys
        const keysToRemove: string[] = [];
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key && key.startsWith(this.PREFIX)) {
                keysToRemove.push(key);
            }
        }

        for (const key of keysToRemove) {
            this.storage.removeItem(key);
        }
    }
}
