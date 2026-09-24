"use client";

import { useSyncExternalStore } from "react";

/**
 * Hydration-safe "has the client taken over?" flag.
 *
 * `useState(false) + useEffect(() => set(true))` is the usual idiom but the
 * React Compiler lint rules reject setState called synchronously in an effect.
 * Reading an external store sidesteps both the lint rule and the hydration
 * mismatch, because the server snapshot is always `false`.
 */
const subscribe = () => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
