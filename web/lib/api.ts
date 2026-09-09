/** Typed access to the backend. Every failure returns a user readable message. */

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

export type Provenance = {
  source: string;
  live: boolean;
  fetched_at: string;
  note: string | null;
  substituted_for: string | null;
};

export type SprayWindow = {
  start: string;
  end: string;
  score: number;
  hours: number;
};

export type ValueEstimate = {
  low_inr: number;
  high_inr: number;
  per_acre_low_inr: number;
  per_acre_high_inr: number;
  basis: string;
  delay_days: number;
  stress_days: number;
  area_ha: number;
  label: string;
};

export type FieldRecord = {
  id: number;
  farmer_id: number;
  name: string;
  crop: string;
  lat: number;
  lon: number;
  area_ha: number;
  sowing_date: string;
  soil_ph: number;
  soil_ph_source: string;
};

export type Farmer = {
  id: number;
  name: string;
  phone: string;
  preferred_language: string;
  village: string;
  district: string;
  state: string;
};

export type ScoreResponse = {
  readiness_score: number;
  need: number;
  timing_fit: number;
  viability: number;
  driving_stress: string | null;
  window: SprayWindow | null;
  candidate_day: string | null;
  stage: string;
  product_kind: string;
  value_estimate: ValueEstimate | null;
  blocked_reason: string | null;
  check_again_on: string | null;
  factors: string[];
  actionable: boolean;
  reason_text: string;
  gdd_since_sowing: number;
  season_yield_risk: number | null;
  provenance: Provenance[];
  recommendation_id: number;
  field: FieldRecord;
};

export type DayStress = {
  date: string;
  scores: Record<string, number | null>;
};

export type ProjectionResponse = {
  crop: string;
  days: DayStress[];
  onsets: Record<
    string,
    { stress_type: string; date: string; value: number; threshold: number }
  >;
  accumulated_gdd: number;
  season_yield_risk: number | null;
  not_applicable: string[];
  onset_threshold: number;
  provenance: Provenance[];
};

export type HourScore = {
  timestamp: string;
  viable: boolean;
  score: number;
  delta_t: number;
  wind_kmh: number;
  temperature_c: number;
  humidity_pct: number;
  rain_free_hours: number;
  rejection_rule: string | null;
  rejection_reason: string | null;
};

export type HoursResponse = {
  hours: HourScore[];
  windows: SprayWindow[];
  best_window: SprayWindow | null;
  provenance: Provenance[];
};

export type DashboardRow = {
  field_id: number;
  field_name: string;
  farmer_name: string;
  village: string;
  crop: string;
  lat: number;
  lon: number;
  area_ha: number;
  readiness_score: number;
  need: number;
  driving_stress: string | null;
  stress_level: number;
  window_start: string | null;
  window_end: string | null;
  actionable: boolean;
  blocked_reason: string | null;
  journal_entries: number;
  sprays_logged: number;
};

export type DashboardResponse = {
  stats: {
    fields_monitored: number;
    open_windows: number;
    adherence_rate: number;
    journal_entries: number;
  };
  rows: DashboardRow[];
  provenance: Provenance[];
};

export type ConfigResponse = {
  data_mode: string;
  badge: "live" | "mixed" | "demo";
  sources: Record<
    string,
    { primary: string; live: boolean; substitute: string | null }
  >;
  algorithm_flags: Record<string, number | boolean>;
  build_sprint: string[];
  provenance: Provenance[];
};

export type JournalEntry = {
  id: number;
  field_id: number;
  recommendation_id: number | null;
  logged_at: string;
  actual_spray_at: string | null;
  entry_type: string;
  text: string;
  photo_path: string | null;
  outcome_rating: number | null;
};

export type JournalResponse = {
  items: JournalEntry[];
  recommendations: {
    id: number;
    generated_at: string;
    window_start: string | null;
    window_end: string | null;
    readiness_score: number;
    reason_text: string;
    status: string;
  }[];
  provenance: Provenance[];
};

/** Thrown with a message that is safe to render directly to a user. */
export class ApiError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "ApiError";
    this.retryable = retryable;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    // The backend being down is the single most likely failure in a demo, so it
    // gets a specific message rather than a generic network error.
    throw new ApiError(
      "We cannot reach the AgriSense service right now. Check that it is running, then try again.",
      true,
    );
  }

  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    let retryable = true;
    try {
      const body = await response.json();
      if (body?.user_message) message = body.user_message;
      if (typeof body?.retryable === "boolean") retryable = body.retryable;
    } catch {
      /* keep the default message */
    }
    throw new ApiError(message, retryable);
  }

  return (await response.json()) as T;
}

export const api = {
  config: () => request<ConfigResponse>("/api/config"),
  farmers: () => request<{ items: Farmer[] }>("/api/farmers"),
  fields: () => request<{ items: FieldRecord[] }>("/api/fields"),
  field: (id: number) => request<{ item: FieldRecord }>(`/api/fields/${id}`),
  createField: (body: Record<string, unknown>) =>
    request<{ item: FieldRecord }>("/api/fields", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  score: (id: number, language = "en") =>
    request<ScoreResponse>(`/api/fields/${id}/score?language=${language}`, {
      method: "POST",
    }),
  projection: (id: number) =>
    request<ProjectionResponse>(`/api/fields/${id}/projection`),
  hours: (id: number) => request<HoursResponse>(`/api/fields/${id}/hours`),
  journal: (id: number) => request<JournalResponse>(`/api/fields/${id}/journal`),
  addJournal: (id: number, body: Record<string, unknown>) =>
    request<{ item: JournalEntry }>(`/api/fields/${id}/journal`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadPhoto: (entryId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ item: JournalEntry }>(`/api/journal/${entryId}/photo`, {
      method: "POST",
      body: form,
    });
  },
  dashboard: () => request<DashboardResponse>("/api/dashboard/summary"),
  backtest: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/backtest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
