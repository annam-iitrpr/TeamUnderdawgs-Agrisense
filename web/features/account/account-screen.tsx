"use client";

/**
 * Profile, language, and the two rights a farmer has over their own data.
 *
 * Export and deletion are offered plainly rather than buried. Deletion is
 * irreversible, so it asks for a typed confirmation rather than a single tap,
 * and lists what goes with it before the control appears.
 */
import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-provider";
import { Button, Callout, Card, Skeleton, TextField } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError } from "@/lib/api/envelope";
import { useApiQuery } from "@/lib/api/query";
import { me as meApi } from "@/lib/api/routes";
import { AlertTriangle, Download, LogOut, Phone, Trash2, User } from "lucide-react";
import { useState } from "react";

export function AccountScreen() {
  const { user, signOut } = useAuth();
  const uid = user?.uid ?? null;

  const profileQuery = useApiQuery([uid, "me"], (signal) => meApi.get({ signal }), {
    enabled: Boolean(uid),
  });
  const profile = profileQuery.data ?? null;
  const verified = Boolean(user?.phoneNumber);

  return (
    <AppShell title="Account">
      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-forest/10 text-forest">
              <User aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              {profileQuery.isLoading ? (
                <Skeleton className="h-6 w-40" />
              ) : (
                <p className="truncate text-h3 font-semibold text-ink">
                  {profile?.display_name ?? "Farmer"}
                </p>
              )}
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-slate">
                <Phone aria-hidden className="size-3.5 shrink-0" />
                {user?.phoneNumber ?? "—"}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Language</h2>
          <p className="mt-1 text-sm text-slate">
            Changes what AgriSense shows you. Your own records are not translated.
          </p>
          <div className="mt-3">
            <LanguageSwitcher />
          </div>
        </Card>

        <ExportCard verified={verified} />
        <DangerZone verified={verified} />

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Signed in on this device</h2>
          <p className="mt-1 text-sm text-slate">
            Signing out leaves your records untouched. You can sign back in at any time.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void signOut()}>
            <LogOut aria-hidden className="size-4" />
            Sign out
          </Button>
        </Card>
      </div>
    </AppShell>
  );
}

function ExportCard({ verified }: { verified: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "queued">("idle");
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setState("busy");
    setError(null);
    try {
      await meApi.requestExport();
      setState("queued");
    } catch (cause) {
      setState("idle");
      setError(cause instanceof ApiError ? cause.message : "The export could not be started.");
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-ink">Your data</h2>
      <p className="mt-1 text-sm text-slate">
        A copy of everything AgriSense holds for you: fields, seasons, journal entries, costs
        and photos.
      </p>
      {state === "queued" ? (
        <Callout tone="success" className="mt-3">
          Your export is being prepared. It becomes available as a file you can download.
        </Callout>
      ) : null}
      {error ? <p className="mt-2 text-sm text-clay">{error}</p> : null}
      <Button
        variant="secondary"
        className="mt-3"
        onClick={request}
        busy={state === "busy"}
        disabled={!verified || state === "queued"}
      >
        <Download aria-hidden className="size-4" />
        Request a copy of my data
      </Button>
      {!verified ? (
        <p className="mt-2 text-xs text-slate">Verify your phone number to use this.</p>
      ) : null}
    </Card>
  );
}

function DangerZone({ verified }: { verified: boolean }) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (typed !== "DELETE" || busy) return;
    setBusy(true);
    setError(null);
    try {
      await meApi.deleteAccount();
      await signOut();
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof ApiError ? cause.message : "The account could not be deleted.");
    }
  }

  return (
    <Card className="border-clay/40 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-clay">
        <AlertTriangle aria-hidden className="size-4" />
        Delete my account
      </h2>
      <p className="mt-1 text-sm text-slate">
        This removes your fields, seasons, journal entries, costs and photos. It cannot be
        undone, and AgriSense cannot recover them afterwards.
      </p>

      {!open ? (
        <Button
          variant="secondary"
          className="mt-3 border-clay/50 text-clay"
          onClick={() => setOpen(true)}
          disabled={!verified}
        >
          <Trash2 aria-hidden className="size-4" />
          Delete my account
        </Button>
      ) : (
        <div className="mt-3 space-y-3">
          <Callout tone="blocked" title="This cannot be undone">
            Type <span className="font-mono font-semibold">DELETE</span> to confirm.
          </Callout>
          <TextField
            label="Type DELETE to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
          {error ? <p className="text-sm text-clay">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-clay text-white hover:bg-clay/90"
              onClick={remove}
              busy={busy}
              disabled={typed !== "DELETE"}
            >
              Delete everything
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
              disabled={busy}
            >
              Keep my account
            </Button>
          </div>
        </div>
      )}
      {!verified ? (
        <p className="mt-2 text-xs text-slate">Verify your phone number to use this.</p>
      ) : null}
    </Card>
  );
}
