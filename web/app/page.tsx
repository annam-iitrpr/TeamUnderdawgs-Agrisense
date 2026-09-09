"use client";

import { PhoneFrame } from "@/components/phone-frame";
import { useApp } from "@/components/providers";
import { Button, Card, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError, type FieldRecord } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChevronRight, MapPin, Sprout } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Turn = {
  from: "app" | "farmer";
  text: string;
};

type Step = "crop" | "location" | "area" | "sowing" | "product" | "working";

const CROPS = [
  { value: "cotton", key: "cropCotton" as const },
  { value: "rice", key: "cropRice" as const },
  { value: "wheat", key: "cropWheat" as const },
];

const LOCATIONS = [
  { label: "Nagpur", lat: 21.15, lon: 79.09 },
  { label: "Warangal", lat: 17.98, lon: 79.6 },
  { label: "Ludhiana", lat: 30.9, lon: 75.85 },
  { label: "Amravati", lat: 20.93, lon: 77.75 },
];

const AREAS = [1, 2, 4, 8];
const SOWING = [
  { label: "4", weeks: 4 },
  { label: "8", weeks: 8 },
  { label: "10", weeks: 10 },
  { label: "14", weeks: 14 },
];

export default function ConversationPage() {
  const { t, language } = useApp();
  const router = useRouter();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [step, setStep] = useState<Step>("crop");
  const [typing, setTyping] = useState(false);
  const [existing, setExisting] = useState<FieldRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = useRef<Record<string, unknown>>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTurns([
      { from: "app", text: t("chatGreeting") },
      { from: "app", text: t("chatAskCrop") },
    ]);
    api
      .fields()
      .then((r) => setExisting(r.items))
      .catch(() => setExisting([]));
    // Re-seeding the opening turns on a language change keeps the thread coherent.
  }, [t]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, typing]);

  /** Adds the farmer's reply, then the app's next question after a short pause. */
  function advance(answer: string, nextStep: Step, question: string | null) {
    setTurns((prev) => [...prev, { from: "farmer", text: answer }]);
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      if (question) setTurns((prev) => [...prev, { from: "app", text: question }]);
      setStep(nextStep);
    }, 700);
  }

  async function submit(productKind: string) {
    draft.current.product = productKind;
    setTurns((prev) => [...prev, { from: "farmer", text: productKind }]);
    setStep("working");
    setTyping(true);

    try {
      const farmers = await api.farmers();
      const created = await api.createField({
        farmer_id: farmers.items[0]?.id ?? 1,
        name: `${String(draft.current.locationLabel)} ${String(draft.current.crop)} field`,
        crop: draft.current.crop,
        lat: draft.current.lat,
        lon: draft.current.lon,
        area_ha: Number(draft.current.area) * 0.404686,
        sowing_date: draft.current.sowing,
        soil_ph: 6.4,
        soil_ph_source: "assumed",
      });
      router.push(`/field/${created.item.id}`);
    } catch (e) {
      setTyping(false);
      setError(
        e instanceof ApiError
          ? e.message
          : "We could not set up your field. Please try again.",
      );
    }
  }

  if (error) {
    return (
      <PhoneFrame>
        <div className="p-4">
          <ErrorState
            title={t("errorTitle")}
            message={error}
            retryLabel={t("retry")}
            onRetry={() => {
              setError(null);
              setStep("crop");
            }}
          />
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <div className="flex min-h-full flex-col px-4 pb-4 pt-4">
        <div className="flex-1 space-y-3">
          {turns.map((turn, i) => (
            <Bubble key={i} from={turn.from} text={turn.text} />
          ))}
          {typing ? <TypingBubble /> : null}
          <div ref={endRef} />
        </div>

        <div className="mt-5 space-y-3">
          {step === "crop" ? (
            <ChipRow>
              {CROPS.map((c) => (
                <Chip
                  key={c.value}
                  onClick={() => {
                    draft.current.crop = c.value;
                    advance(t(c.key), "location", t("chatAskLocation"));
                  }}
                >
                  {t(c.key)}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {step === "location" ? (
            <ChipRow>
              {LOCATIONS.map((l) => (
                <Chip
                  key={l.label}
                  onClick={() => {
                    draft.current.lat = l.lat;
                    draft.current.lon = l.lon;
                    draft.current.locationLabel = l.label;
                    advance(l.label, "area", t("chatAskArea"));
                  }}
                >
                  <MapPin aria-hidden className="size-4" />
                  {l.label}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {step === "area" ? (
            <ChipRow>
              {AREAS.map((a) => (
                <Chip
                  key={a}
                  onClick={() => {
                    draft.current.area = a;
                    advance(`${a} ${t("acres")}`, "sowing", t("chatAskSowing"));
                  }}
                >
                  {a} {t("acres")}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {step === "sowing" ? (
            <ChipRow>
              {SOWING.map((s) => (
                <Chip
                  key={s.weeks}
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() - s.weeks * 7);
                    draft.current.sowing = d.toISOString().slice(0, 10);
                    advance(
                      `${s.label} ${t("weeksAgo")}`,
                      "product",
                      t("chatAskProduct"),
                    );
                  }}
                >
                  {s.label} {t("weeksAgo")}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {step === "product" ? (
            <ChipRow>
              <Chip onClick={() => submit(t("productStressBuster"))}>
                {t("productStressBuster")}
              </Chip>
              <Chip onClick={() => submit(t("productYieldBooster"))}>
                {t("productYieldBooster")}
              </Chip>
            </ChipRow>
          ) : null}

          {step === "working" ? (
            <Card className="space-y-2 p-4">
              <p className="text-sm font-semibold">{t("chatWorking")}</p>
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </Card>
          ) : null}

          {/* Existing seeded fields, so a demo can jump straight to a story. */}
          {step !== "working" && existing && existing.length > 0 ? (
            <div className="border-t border-mist pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate">
                {t("useExisting")}
              </p>
              <ul className="space-y-1.5">
                {existing.slice(0, 4).map((f) => (
                  <li key={f.id}>
                    <Button
                      variant="secondary"
                      className="w-full justify-between"
                      onClick={() => router.push(`/field/${f.id}`)}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Sprout aria-hidden className="size-4 shrink-0 text-sprout" />
                        <span className="truncate">{f.name}</span>
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {existing === null ? <Skeleton className="h-11 w-full" /> : null}
        </div>
      </div>
    </PhoneFrame>
  );
}

/* -------------------------------------------------------------- fragments */

function Bubble({ from, text }: { from: "app" | "farmer"; text: string }) {
  const isApp = from === "app";
  return (
    <div className={cn("flex", isApp ? "justify-start" : "justify-end")}>
      <p
        className={cn(
          "animate-bubble max-w-[80%] rounded-card px-3.5 py-2.5 text-body",
          isApp
            ? "rounded-tl-sm bg-[color-mix(in_srgb,var(--mist)_60%,var(--card))] text-ink"
            : "rounded-tr-sm bg-forest text-white",
        )}
      >
        {text}
      </p>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="Typing">
      <div className="flex gap-1 rounded-card rounded-tl-sm bg-[color-mix(in_srgb,var(--mist)_60%,var(--card))] px-3.5 py-3.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-pulse rounded-full bg-slate"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Chip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-forest bg-card px-4 text-sm font-semibold text-forest transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--sprout)_10%,transparent)]"
    >
      {children}
    </button>
  );
}
