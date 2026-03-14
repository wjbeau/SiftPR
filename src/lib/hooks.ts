import { useState, useCallback, useEffect } from "react";

/**
 * A hook for persisting state in localStorage with automatic serialization.
 * Updates localStorage whenever the value changes.
 *
 * @param key - The localStorage key
 * @param initialValue - The initial value if nothing is stored
 * @returns A tuple of [value, setValue] like useState
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Initialize state from localStorage or use initial value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (item !== null) {
        return JSON.parse(item) as T;
      }
      return initialValue;
    } catch {
      return initialValue;
    }
  });

  // Sync to localStorage whenever value changes
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(storedValue));
    } catch {
      // Ignore quota errors, etc.
    }
  }, [key, storedValue]);

  // Wrapper that handles both direct values and updater functions
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const nextValue = value instanceof Function ? value(prev) : value;
        return nextValue;
      });
    },
    []
  );

  return [storedValue, setValue];
}

/**
 * A simpler hook for caching data in localStorage without automatic sync.
 * Useful for query caching where you control when to write.
 *
 * @param key - The localStorage key
 * @returns Object with get, set, and remove functions
 */
export function useLocalStorageCache<T>(key: string) {
  const get = useCallback((): T | null => {
    try {
      const item = localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : null;
    } catch {
      return null;
    }
  }, [key]);

  const set = useCallback(
    (value: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Ignore quota errors
      }
    },
    [key]
  );

  const remove = useCallback(() => {
    localStorage.removeItem(key);
  }, [key]);

  return { get, set, remove };
}
