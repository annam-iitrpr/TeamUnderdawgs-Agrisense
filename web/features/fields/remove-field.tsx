"use client";

/**
 * Remove a field.
 *
 * The API archives rather than erases, which is the right behaviour: a season's
 * history stays auditable and nothing a farmer recorded is destroyed. The
 * wording says exactly that, because "delete" would promise an erasure that
 * does not happen, and a farmer deciding to remove a field deserves to know
 * their records survive.
 *
 * A field with an open season cannot be removed, and the API refuses it. That
 * is explained here rather than surfaced as a raw conflict.
 */
import { Button, Callout, Card } from "@/components/ui";
import type { Field } from "@/lib/api/contract";
import { newIdempotencyKey } from "@/lib/api/client";
import { ApiError } from "@/lib/api/envelope";
import { fields as fieldsApi } from "@/lib/api/routes";
import { AlertTriangle, Archive } from "lucide-react";
import { useState } from "react";

export function RemoveField({ field, onRemoved }: { field: Field; onRemoved: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await fieldsApi.archive(field.id, field.version, newIdempotencyKey());
      onRemoved();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.status === 409
            ? "This field still has an open season. Close the season first, then remove the field."
            : cause.message
          : "The field could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" className="border-clay/50 text-clay" onClick={() => setOpen(true)}>
        <Archive aria-hidden className="size-4" />
        Remove this field
      </Button>
    );
  }

  return (
    <Card className="border-clay/40 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-clay">
        <AlertTriangle aria-hidden className="size-4" />
        Remove {field.name}?
      </p>
      <Callout tone="caution" className="mt-2">
        <p>
          The field stops appearing in AgriSense and no further advice is produced for it.
        </p>
        <p className="mt-1">
          Your journal entries, costs and past seasons for this field are kept, so your history
          stays intact.
        </p>
      </Callout>
      {error ? <p className="mt-2 text-sm text-clay">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="bg-clay text-white hover:bg-clay/90" onClick={remove} busy={busy}>
          Yes, remove it
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
          Keep the field
        </Button>
      </div>
    </Card>
  );
}
