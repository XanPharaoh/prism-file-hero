import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook that manages object URLs with automatic cleanup on unmount.
 * Prevents memory leaks from URL.createObjectURL calls.
 */
export function useManagedObjectUrls() {
  const urlsRef = useRef<Set<string>>(new Set());

  const createObjectUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    urlsRef.current.add(url);
    return url;
  }, []);

  const revokeObjectUrl = useCallback((url: string): void => {
    if (urlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(url);
    }
  }, []);

  const revokeAll = useCallback((): void => {
    urlsRef.current.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    });
    urlsRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      revokeAll();
    };
  }, [revokeAll]);

  return { createObjectUrl, revokeObjectUrl, revokeAll };
}