"use client";

/**
 * Turn a crop id into the name a farmer reads.
 *
 * The contract's Season carries only `crop_id`; the display name lives in the
 * reviewed catalogue. Mapping ids to names with a hardcoded table here would be
 * inventing a catalogue, so when the catalogue cannot be read the id is shown
 * as-is rather than guessed at.
 */
import { useAuth } from "@/features/auth/auth-provider";
import type { Crop } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/query";
import { catalog as catalogApi } from "@/lib/api/routes";

export function useCrops() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const query = useApiQuery(
    [uid, "catalog", "crops"],
    (signal) => catalogApi.crops({ signal, limit: 100 }),
    { enabled: Boolean(uid) },
  );
  const items: Crop[] = query.data?.items ?? [];
  return {
    crops: items,
    isLoading: query.isLoading,
    /** The reviewed name, or the raw id when the catalogue is unavailable. */
    nameFor: (cropId: string) => items.find((c) => c.id === cropId)?.name ?? cropId,
    cropFor: (cropId: string) => items.find((c) => c.id === cropId) ?? null,
  };
}
