/**
 * Preferences kept in browser storage.
 *
 * Storage can be missing or refuse access (private browsing, some embedded
 * views), so every read and write goes through here and fails quietly: a
 * preference that cannot be kept still holds for the session.
 */

/** The part of `Storage` this needs, so tests can hand in a plain object. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

const storage = (): KeyValueStore | null => {
  try {
    return window.localStorage;
  } catch {
    // Private browsing and some embedded webviews throw on storage access.
    return null;
  }
};

/** A setting's stored value, or null when there is none or storage is unavailable. */
export function readSetting(key: string, store: KeyValueStore | null = storage()): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeSetting(
  key: string,
  value: string,
  store: KeyValueStore | null = storage(),
): void {
  try {
    store?.setItem(key, value);
  } catch {
    /* storage unavailable or full; the setting still holds for this session */
  }
}
