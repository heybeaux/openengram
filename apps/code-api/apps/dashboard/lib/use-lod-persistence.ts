'use client';

import { useCallback, useEffect, useState } from 'react';
import { lodLevelSchema, type LodLevel } from './schemas';

export const LOD_STORAGE_KEY = 'ec-dashboard:lod';

function readStoredLod(): LodLevel | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(LOD_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = lodLevelSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeStoredLod(value: LodLevel): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(LOD_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures (private mode, quota, etc).
  }
}

export function useLodPersistence(initial: LodLevel): [LodLevel, (next: LodLevel) => void] {
  const [lod, setLodState] = useState<LodLevel>(initial);

  useEffect(() => {
    const stored = readStoredLod();
    if (stored !== null && stored !== lod) {
      setLodState(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLod = useCallback((next: LodLevel) => {
    setLodState(next);
    writeStoredLod(next);
  }, []);

  return [lod, setLod];
}
