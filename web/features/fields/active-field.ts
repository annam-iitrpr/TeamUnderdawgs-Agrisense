"use client";

/**
 * Which field the farmer is currently looking at.
 *
 * A farmer can own several fields, and every screen after this one is scoped to
 * one of them. The choice is remembered per account so a returning farmer lands
 * on the field they were last working with, which the spec asks for explicitly.
 *
 * Stored under the `agrisense.activeField` prefix that the auth provider purges
 * on sign-out and on any change of identity — a field id is not secret, but it
 * is a pointer to someone's farm and has no business surviving a logout.
 */
import { useCallback, useEffect, useState } from "react";

const KEY_PREFIX = "agrisense.activeField";

function key(uid: string): string {
  return `${KEY_PREFIX}.${uid}`;
}

export function readActiveFieldId(uid: string): string | null {
  try {
    return window.localStorage.getItem(key(uid));
  } catch {
    return null;
  }
}

export function writeActiveFieldId(uid: string, fieldId: string): void {
  try {
    window.localStorage.setItem(key(uid), fieldId);
  } catch {
    /* preference simply does not persist */
  }
}

/**
 * Resolves the active field against the fields that actually exist.
 *
 * `availableIds` is the authority: a stored id that has been archived or that
 * belongs to a different account must not be honoured, or the dashboard would
 * request a field the farmer cannot see and render a 404 as if it were their own.
 */
export function useActiveField(
  uid: string | null,
  availableIds: readonly string[],
): { activeId: string | null; setActiveId: (id: string) => void } {
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setStored(null);
      return;
    }
    setStored(readActiveFieldId(uid));
  }, [uid]);

  const setActiveId = useCallback(
    (id: string) => {
      setStored(id);
      if (uid) writeActiveFieldId(uid, id);
    },
    [uid],
  );

  const activeId =
    stored && availableIds.includes(stored) ? stored : (availableIds[0] ?? null);

  return { activeId, setActiveId };
}
