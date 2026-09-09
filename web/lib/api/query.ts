"use client";

/**
 * A small, disciplined request hook.
 *
 * The spec permits TanStack Query only if the bootstrap pins it; no bootstrap
 * exists, so adding it would be an independent dependency upgrade (decisions.md
 * D-004). This provides the specific discipline the spec actually requires:
 *
 *  - A query key that includes the actor, field, season, input version and any
 *    scenario, so two different subjects can never share cached state.
 *  - Stale-result rejection. Switching from Field A to Field B while A is still
 *    in flight must not render A's numbers under B's heading. The in-flight
 *    request is aborted AND its result is discarded on arrival, because an
 *    abort is not guaranteed to win the race.
 *  - No global cache of authenticated responses. State is per-hook and cleared
 *    when the key changes or the component unmounts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./envelope";
import type { Meta } from "./envelope";
import type { Result } from "./client";

/** Key parts. `null`/`undefined` members are dropped, so an absent season and
 *  a season of "null" cannot collide. */
export type QueryKey = ReadonlyArray<string | number | boolean | null | undefined>;

export function serializeKey(key: QueryKey): string {
  return key
    .filter((part): part is string | number | boolean => part !== null && part !== undefined)
    .map((part) => String(part))
    .join("|");
}

export type QueryState<T> = {
  data: T | null;
  meta: Meta | null;
  error: ApiError | null;
  /** True on the first load for the current key, when there is nothing to show. */
  isLoading: boolean;
  /** True while refetching with previous data still on screen. */
  isRefetching: boolean;
  refetch: () => void;
};

export type UseApiQueryOptions = {
  /** When false the request is not issued (e.g. no field selected yet). */
  enabled?: boolean;
};

export function useApiQuery<T>(
  key: QueryKey,
  fetcher: (signal: AbortSignal) => Promise<Result<T>>,
  options: UseApiQueryOptions = {},
): QueryState<T> {
  const enabled = options.enabled ?? true;
  const keyString = serializeKey(key);

  const [state, setState] = useState<{
    key: string;
    data: T | null;
    meta: Meta | null;
    error: ApiError | null;
    loading: boolean;
  }>({ key: keyString, data: null, meta: null, error: null, loading: enabled });

  // Identifies the request the component currently cares about. Compared on
  // arrival so a late response for a previous key is dropped.
  const activeKeyRef = useRef(keyString);
  const controllerRef = useRef<AbortController | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    activeKeyRef.current = keyString;

    if (!enabled) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setState({ key: keyString, data: null, meta: null, error: null, loading: false });
      return;
    }

    // Drop anything already in flight for a previous key.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState((prev) =>
      prev.key === keyString
        ? { ...prev, loading: true, error: null }
        : // Key changed: clear the previous subject's data so it cannot be read
          // as belonging to the new one, even for one frame.
          { key: keyString, data: null, meta: null, error: null, loading: true },
    );

    fetcher(controller.signal)
      .then((result) => {
        if (activeKeyRef.current !== keyString || controller.signal.aborted) return;
        setState({
          key: keyString,
          data: result.data,
          meta: result.meta,
          error: null,
          loading: false,
        });
      })
      .catch((cause: unknown) => {
        if (activeKeyRef.current !== keyString || controller.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setState({
          key: keyString,
          data: null,
          meta: null,
          error:
            cause instanceof ApiError
              ? cause
              : new ApiError({
                  code: "unknown",
                  status: 0,
                  message: "Something went wrong. Please try again.",
                  details: cause,
                }),
          loading: false,
        });
      });

    return () => controller.abort();
    // `fetcher` is intentionally excluded: callers commonly pass an inline
    // closure, and the key is the declared identity of the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyString, enabled, reloadToken]);

  const isCurrent = state.key === keyString;
  const data = isCurrent ? state.data : null;
  const meta = isCurrent ? state.meta : null;
  const error = isCurrent ? state.error : null;
  const loading = isCurrent ? state.loading : enabled;

  return {
    data,
    meta,
    error,
    isLoading: loading && data === null,
    isRefetching: loading && data !== null,
    refetch,
  };
}
