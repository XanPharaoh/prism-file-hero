// A transient, module-level cache for File objects.
// This prevents React/Zustand from tracking binary data in memory.
const fileCache = new Map<string, File>();

export const setCachedFile = (id: string, file: File) => fileCache.set(id, file);
export const getCachedFile = (id: string) => fileCache.get(id);
export const clearCachedFile = (id: string) => fileCache.delete(id);
export const clearAllCachedFiles = () => fileCache.clear();