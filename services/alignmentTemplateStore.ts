import type { CoordinateConvention } from './pdfCoordinateAdapter';

export interface SavedDividerTemplate {
  fingerprint: string;
  dividers: number[];
  coordinateConvention: CoordinateConvention;
  updatedAt: string;
}

const DATABASE = 'prism-table-alignment';
const STORE = 'divider-templates';

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'fingerprint' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function loadDividerTemplate(fingerprint: string): Promise<SavedDividerTemplate | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(fingerprint);
    request.onsuccess = () => resolve((request.result as SavedDividerTemplate | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function saveDividerTemplate(template: SavedDividerTemplate): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).put(template);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}
