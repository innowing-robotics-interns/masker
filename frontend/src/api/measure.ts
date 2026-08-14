/**
 * @file API functions for crack-width measurement and per-image metadata.
 * @module api/measure
 *
 * Mirrors the return-shape conventions in utils/masks.ts (discriminated
 * { ok } results) so callers switch on `ok` without try/catch at the call site.
 */

export interface SampleMeasurement {
  row: number;
  col: number;
  width_mm: number;
  good: boolean;
  rms_mm: number;
  inlier_pct: number;
}

export interface MeasureData {
  samples: SampleMeasurement[];
  max_width_mm: number | null;
  /** Good samples used for the headline max (matches the overlay). */
  num_samples: number;
  /** Flagged samples excluded from the headline max. */
  num_excluded?: number;
  /** Total samples measured (good + excluded). */
  num_total_samples?: number;
  overlay_base64: string;
}

export type MeasureResult =
  | { ok: true; data: MeasureData }
  | { ok: false; reason: string; message: string };

/**
 * Run the crack-width pipeline for a saved mask.
 * POST /measure/<dataset>/<filename>
 *
 * The backend returns HTTP 200 with status "no_depth" as a first-class state
 * (not an error), so callers should branch on `reason === "no_depth"`.
 */
export const measureCrack = async (
  datasetName: string,
  labelName: string,
): Promise<MeasureResult> => {
  try {
    const response = await fetch(`/measure/${datasetName}/${labelName}`, {
      method: "POST",
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;

    if (response.ok && json?.status === "success") {
      return { ok: true, data: json as MeasureData };
    }

    return {
      ok: false,
      reason: json?.reason ?? "error",
      message: json?.message ?? `Measurement request failed (${response.status})`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "network",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

export interface ImageMeta {
  severity?: string;
  crack_direction?: string;
  annotator?: string;
  timestamp?: string;
  capture_distance_m?: number;
  [key: string]: unknown;
}

export type MetaResult =
  | { ok: true; meta: ImageMeta }
  | { ok: false; status: number; error: string };

/** GET /datasets/<dataset>/meta/<filename> */
export const getMeta = async (
  datasetName: string,
  filename: string,
): Promise<MetaResult> => {
  try {
    const response = await fetch(`/datasets/${datasetName}/meta/${filename}`);
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (response.ok && json?.status === "success") {
      return { ok: true, meta: json.meta as ImageMeta };
    }
    return {
      ok: false,
      status: response.status,
      error: json?.message ?? "No metadata",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

/** POST /datasets/<dataset>/meta/<filename> */
export const saveMeta = async (
  datasetName: string,
  filename: string,
  meta: ImageMeta,
): Promise<MetaResult> => {
  try {
    const response = await fetch(`/datasets/${datasetName}/meta/${filename}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (response.ok && json?.status === "success") {
      return { ok: true, meta: json.meta as ImageMeta };
    }
    return {
      ok: false,
      status: response.status,
      error: json?.message ?? "Failed to save metadata",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};
