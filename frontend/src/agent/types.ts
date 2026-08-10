/** Shared types for the Solar Detections map agent. */

import type { ScanTool } from "@/components/SolarScanMap";
import type { DetectionStats } from "@/lib/solar-scan-api";

/** What the agent knows about the map on any given turn. */
export interface AgentMapContext {
  mapTool: ScanTool;
  squares: Array<[number, number]>;
  radiusM: number;
  selectedDetectionIds: number[];
  focusedDetectionId: number | null;
  viewportBbox: [number, number, number, number] | null;
  mapCenter: [number, number] | null;
  mapZoom: number | null;
  queueLength: number;
  busy: boolean;
  sam3Ready: boolean;
  stats: DetectionStats | Record<string, never>;
}

export type AgentMessageRole = "user" | "assistant";

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  timestamp: number;
}

export interface AgentActivityStep {
  id: string;
  tool: string;
  label: string;
  phase: "running" | "done" | "error";
  detail?: string;
}

export interface AgentConfirmation {
  actionId: string;
  tool: string;
  summary: string;
  impact?: Record<string, unknown>;
}

/** Result the browser reports back after running a scan the agent asked for. */
export interface ClientToolOutcome {
  ok: boolean;
  scanned?: number;
  found?: number;
  skipped?: number;
  error?: string;
}

/**
 * Everything the agent can do to the page. The Solar Detections page supplies
 * these; the panel only calls them.
 */
export interface AgentActions {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  setScanSquare: (center: [number, number], radiusM?: number) => void;
  addScanSquares: (squares: Array<[number, number]>) => void;
  clearScanSquares: () => void;
  setScanRadius: (radiusM: number) => void;
  setMapTool: (tool: ScanTool) => void;
  focusDetection: (id: number) => void;
  runScan: (
    center: [number, number],
    radiusM: number,
    onStatus?: (message: string) => void,
  ) => Promise<ClientToolOutcome>;
  runScanMultiple: (
    squares: Array<{ center: [number, number]; radiusM: number }>,
    onStatus?: (message: string) => void,
  ) => Promise<ClientToolOutcome>;
  refresh: () => Promise<void>;
}
