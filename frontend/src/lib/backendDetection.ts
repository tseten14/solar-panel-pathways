import type { DetectionEngineId, DetectionResult } from "@/types/detection";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

const DETECTION_TIMEOUT_MS = 8 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function postDetect(
  imageFile: File,
  mode: "streetview" | "satellite",
  engine: DetectionEngineId,
  signal: AbortSignal,
): Promise<DetectionResult> {
  const formData = new FormData();
  formData.append("file", imageFile);

  const response = await fetch(`${API_BASE}/detect?mode=${mode}&engine=${engine}`, {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(err || `Detection failed: ${response.status}`);
  }

  return (await response.json()) as DetectionResult;
}

export async function runBackendDetection(
  imageFile: File,
  mode: "streetview" | "satellite" = "streetview",
  engine: DetectionEngineId = "sam3",
): Promise<DetectionResult> {
  if (imageFile.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Image is too large (${(imageFile.size / (1024 * 1024)).toFixed(1)} MB). Maximum is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DETECTION_TIMEOUT_MS);

  try {
    try {
      return await postDetect(imageFile, mode, engine, controller.signal);
    } catch (firstErr) {
      if (controller.signal.aborted) throw firstErr;
      await new Promise((r) => setTimeout(r, 1500));
      return await postDetect(imageFile, mode, engine, controller.signal);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
