export interface BackendHealth {
  status: string;
  sam3_loaded: boolean;
  yolo_available: boolean;
  cache_landfills: boolean;
  cache_solar: boolean;
  streetview_configured: boolean;
  landfills_fetched_at?: number | null;
  solar_fetched_at?: number | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export async function fetchBackendHealth(): Promise<BackendHealth | null> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as BackendHealth;
  } catch {
    return null;
  }
}

export function formatFetchedAt(epochSeconds?: number | null): string | null {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return null;
  return new Date(epochSeconds * 1000).toLocaleString();
}
