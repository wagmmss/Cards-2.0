import { useCallback, useEffect, useState } from 'react';
import {
  CanonicalCard,
  ClinicalMapResponse,
  DeckCurationStats,
  ExtractedDeckMetadata,
  GuidRegistryData,
} from '../types/deck';
import { sanitizeDeckKey } from '../utils/apiClient';
import { computeDeterministicDeckId, resolveOrCreateNoteGuid } from '../utils/wozniakLinter';

const STORAGE_DECK_STATE_KEY = 'cards2_deck_state_v2';
const STORAGE_GUID_REGISTRY_KEY = 'cards2_guid_registry_v2';

export interface SavedDeckSnapshot {
  deckKey: string;
  rawJsonText: string;
  extractedMeta: ExtractedDeckMetadata;
  clinicalMap: ClinicalMapResponse | null;
  cards: CanonicalCard[];
  curationStats: DeckCurationStats | null;
}

function loadSavedGuidRegistry(): GuidRegistryData {
  try {
    const raw = localStorage.getItem(STORAGE_GUID_REGISTRY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.entries === 'object' && parsed.entries !== null) {
        return { version: 1, entries: parsed.entries };
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return { version: 1, entries: {} };
}

export function loadSavedDeckSnapshot(): Partial<SavedDeckSnapshot> | null {
  try {
    const saved = localStorage.getItem(STORAGE_DECK_STATE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && Array.isArray(parsed.cards) && parsed.cards.length > 0) {
      return parsed as Partial<SavedDeckSnapshot>;
    }
  } catch {
    // Ignore invalid saved state
  }
  return null;
}

function buildSafeStorageSnapshot(snapshot: SavedDeckSnapshot): SavedDeckSnapshot {
  const safeCards = snapshot.cards.map((card) => {
    if (!card.imageAlternatives || card.imageAlternatives.length === 0) {
      return card;
    }
    const nonInlineAlts = card.imageAlternatives.filter(
      (alt) => !alt.thumbUrl.startsWith('data:') && !alt.fullUrl.startsWith('data:')
    );
    if (nonInlineAlts.length === card.imageAlternatives.length) {
      return card;
    }
    return {
      ...card,
      imageAlternatives: nonInlineAlts.length > 0 ? nonInlineAlts : undefined,
    };
  });
  return { ...snapshot, cards: safeCards };
}

export function useDeckPersistence(snapshot: SavedDeckSnapshot) {
  const [guidRegistry, setGuidRegistry] = useState<GuidRegistryData>(() =>
    loadSavedGuidRegistry()
  );

  // Debounced auto-save to prevent synchronous JSON.stringify blocking on every keystroke
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (snapshot.cards.length > 0 || snapshot.deckKey.trim()) {
          const safeSnapshot = buildSafeStorageSnapshot(snapshot);
          const serialized = JSON.stringify(safeSnapshot);
          if (serialized.length < 4_200_000) {
            localStorage.setItem(STORAGE_DECK_STATE_KEY, serialized);
          }
        }
      } catch {
        // Ignore quota exceeded
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    snapshot.cards,
    snapshot.deckKey,
    snapshot.rawJsonText,
    snapshot.extractedMeta,
    snapshot.clinicalMap,
    snapshot.curationStats,
  ]);

  // Keep deterministic FSRS GUIDs synced whenever cards or deckKey change
  useEffect(() => {
    if (snapshot.cards.length === 0) return;
    const effectiveKey = sanitizeDeckKey(snapshot.deckKey);
    const deckId = computeDeterministicDeckId(effectiveKey);

    setGuidRegistry((prev) => {
      const next: GuidRegistryData = {
        version: 1,
        entries: { ...prev.entries },
      };
      let changed = false;
      for (const card of snapshot.cards) {
        const regKey = `${effectiveKey}:id:${card.id}`;
        if (!next.entries[regKey]) {
          resolveOrCreateNoteGuid(effectiveKey, deckId, card.id, next.entries);
          changed = true;
        }
      }
      if (changed) {
        try {
          localStorage.setItem(STORAGE_GUID_REGISTRY_KEY, JSON.stringify(next));
        } catch {
          // Ignore storage write error
        }
        return next;
      }
      return prev;
    });
  }, [snapshot.cards, snapshot.deckKey]);

  const mergeGuidEntries = useCallback((entries: Record<string, string>) => {
    if (!entries || typeof entries !== 'object') return;
    setGuidRegistry((prev) => {
      const next: GuidRegistryData = {
        version: 1,
        entries: { ...prev.entries, ...entries },
      };
      try {
        localStorage.setItem(STORAGE_GUID_REGISTRY_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage write error
      }
      return next;
    });
  }, []);

  const importGuidRegistryJson = useCallback(
    (jsonText: string): number => {
      const parsed = JSON.parse(jsonText);
      const entries =
        parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : parsed;
      if (!entries || typeof entries !== 'object') {
        throw new Error('Formato inválido para note_guid_registry.json');
      }
      const nextEntries = { ...guidRegistry.entries, ...entries };
      const merged: GuidRegistryData = { version: 1, entries: nextEntries };
      setGuidRegistry(merged);
      try {
        localStorage.setItem(STORAGE_GUID_REGISTRY_KEY, JSON.stringify(merged));
      } catch {
        // Ignore
      }
      return Object.keys(merged.entries).length;
    },
    [guidRegistry.entries]
  );

  const exportGuidRegistryFile = useCallback(() => {
    const jsonString = JSON.stringify(guidRegistry, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'note_guid_registry.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [guidRegistry]);

  return {
    guidRegistry,
    mergeGuidEntries,
    importGuidRegistryJson,
    exportGuidRegistryFile,
  };
}
