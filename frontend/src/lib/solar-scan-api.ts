// Client for the persisted solar-panel scan/review-queue backend (POST /scan,
// GET/POST /detections*, GET /coverage, GET /detection-stats, exports).
// Follows a fetch-with-timeout pattern consistent with the rest of the app's API clients.
const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

export interface SolarDetectionProperties {
  id: number;
  status: "pending" | "confirmed" | "rejected";
  filter_reason: string | null;
  model: string;
  detector: string;
  confidence: number | null;
  area_m2: number;
  compactness: number;
  rectangularity: number;
  aspect_ratio: number;
  scan_id: number | null;
  lng: number;
  lat: number;
}

export interface SolarDetectionFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: SolarDetectionProperties;
}

export interface ScanResult {
  type: "FeatureCollection";
  features: SolarDetectionFeature[];
  engine: string;
  model: string;
  count: number;
  scan_id: number;
  stored: { pending: number; confirmed: number; skipped: number; by_reason: Record<string, number> };
}

export interface DetectionStats {
  pending: number;
  confirmed: number;
  rejected: number;
  total: number;
  scanned_area_km2: number;
  scans: number;
}

const REVIEWER_KEY = "solartrace-reviewer-id";

/**
 * Stable per-browser id, sent as X-Reviewer so the backend's audit trail can
 * attribute each decision. Generated once and kept in localStorage — this
 * identifies a workstation, not a person, and is not an authentication token.
 */
export function reviewerId(): string {
  try {
    let id = localStorage.getItem(REVIEWER_KEY);
    if (!id) {
      id = `reviewer-${crypto.randomUUID().slice(0, 8)}`;
      localStorage.setItem(REVIEWER_KEY, id);
    }
    return id;
  } catch {
    // Private mode or storage disabled — still attribute the write to a browser.
    return "browser";
  }
}

/** Headers for a mutating request. `actor` overrides the reviewer id (the AI panel sends "agent"). */
function writeHeaders(actor?: string): Record<string, string> {
  return { "Content-Type": "application/json", "X-Reviewer": actor ?? reviewerId() };
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const raw = await res.text();
    // FastAPI returns errors as {"detail": "..."} — surface just the message so the
    // UI shows "detections do not overlap…" rather than a raw JSON blob.
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { detail?: unknown };
      if (typeof parsed?.detail === "string") message = parsed.detail;
    } catch {
      // Not JSON — fall through and use the raw body.
    }
    throw new Error(message || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function scanArea(
  bbox: [number, number, number, number],
  model: "sam3",
  opts?: { center?: [number, number]; radius_m?: number; auto_confirm?: boolean; actor?: string },
): Promise<ScanResult> {
  return withTimeout((signal) =>
    fetch(`${API_BASE}/scan`, {
      method: "POST",
      headers: writeHeaders(opts?.actor),
      body: JSON.stringify({ bbox, model, ...opts, actor: undefined }),
      signal,
    }).then((r) => asJson<ScanResult>(r)),
  );
}

export function paintAt(
  center: [number, number],
  radius_m = 55,
): Promise<{ features: SolarDetectionFeature[]; candidates: number }> {
  return withTimeout((signal) =>
    fetch(`${API_BASE}/paint`, {
      method: "POST",
      // Paint only returns a preview shape; nothing is stored until the caller
      // saves it, so there is no audit actor to attribute here.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ center, radius_m }),
      signal,
    }).then((r) => asJson(r)),
  );
}

export function saveManualDetection(
  geometry: GeoJSON.Polygon,
  opts?: { model?: string; confidence?: number; status?: "pending" | "confirmed"; actor?: string },
): Promise<SolarDetectionFeature> {
  return withTimeout((signal) =>
    fetch(`${API_BASE}/detections/manual`, {
      method: "POST",
      headers: writeHeaders(opts?.actor),
      body: JSON.stringify({ geometry, ...opts, actor: undefined }),
      signal,
    }).then((r) => asJson(r)),
  );
}

export function fetchDetections(status?: "pending" | "confirmed" | "rejected"): Promise<{
  features: SolarDetectionFeature[];
  count: number;
}> {
  const qs = status ? `?status=${status}` : "";
  return withTimeout((signal) =>
    fetch(`${API_BASE}/detections${qs}`, { signal }).then((r) => asJson(r)),
  );
}

export function decideDetection(
  id: number,
  action: "confirm" | "reject" | "restore",
  actor?: string,
): Promise<{ id: number; status: string; previous: string }> {
  return withTimeout((signal) =>
    fetch(`${API_BASE}/detections/${id}/${action}`, {
      method: "POST",
      headers: writeHeaders(actor),
      signal,
    }).then((r) => asJson(r)),
  );
}

export function decideBatch(
  ids: number[],
  status: "confirmed" | "rejected" | "pending",
  actor?: string,
): Promise<{ updated: number; status: string }> {
  return withTimeout((signal) =>
    fetch(`${API_BASE}/detections/confirm-batch`, {
      method: "POST",
      headers: writeHeaders(actor),
      body: JSON.stringify({ ids, status }),
      signal,
    }).then((r) => asJson(r)),
  );
}

export function mergeDetections(
  ids: number[],
  actor?: string,
): Promise<{ merged_id: number; rejected_ids: number[] }> {
  return withTimeout((signal) =>
    fetch(`${API_BASE}/detections/merge`, {
      method: "POST",
      headers: writeHeaders(actor),
      body: JSON.stringify({ ids }),
      signal,
    }).then((r) => asJson(r)),
  );
}

export function eraseCircle(
  center: [number, number],
  radius_m: number,
  actor?: string,
): Promise<{ erased: number; ids: number[] }> {
  return withTimeout((signal) =>
    fetch(`${API_BASE}/detections/erase-circle`, {
      method: "POST",
      headers: writeHeaders(actor),
      body: JSON.stringify({ center, radius_m }),
      signal,
    }).then((r) => asJson(r)),
  );
}

export function fetchCoverage(): Promise<{
  features: Array<{ type: "Feature"; geometry: GeoJSON.Geometry; properties: Record<string, unknown> }>;
  scanned_area_km2: number;
}> {
  return withTimeout((signal) => fetch(`${API_BASE}/coverage`, { signal }).then((r) => asJson(r)));
}

export function fetchDetectionStats(): Promise<DetectionStats> {
  return withTimeout((signal) => fetch(`${API_BASE}/detection-stats`, { signal }).then((r) => asJson(r)));
}

export function exportUrl(format: "gpkg" | "csv"): string {
  return `${API_BASE}/detections/export/confirmed.${format}`;
}
