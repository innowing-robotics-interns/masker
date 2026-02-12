/**
 * @file This file contains the API functions for the Magic Pen feature.
 * @module api/magicPen
 */

interface Crop {
  id: number;
  image_base64: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  canvas_width: number;
  canvas_height: number;
  timestamp: number;
  line_distance: number;
}

interface PredictionOptions {
  predict_mode?: string;
  apply_morphology?: boolean;
  morph_kernel_size?: number;
  morph_iterations?: number;
  apply_dbscan?: boolean;
  db_eps?: number;
  db_min_samples?: number;
  sensitivity?: number;
}

/** Default prediction options matching the legacy canvas.js constructor */
const DEFAULT_PREDICTION_OPTIONS: Required<PredictionOptions> = {
  predict_mode: "normal",
  apply_morphology: true,
  morph_kernel_size: 3,
  morph_iterations: 2,
  apply_dbscan: true,
  db_eps: 10,
  db_min_samples: 5,
  sensitivity: 2,
};

/**
 * Sends all collected crops to the server in a single batch request for prediction.
 * This mirrors the legacy `sendCropsForPrediction` which POSTs everything at once
 * to `/magic_pen/predict_crops` instead of firing N individual requests.
 *
 * @param {Crop[]} crops - An array of crop objects to be sent for prediction.
 * @param {PredictionOptions} options - Additional options for the prediction.
 * @returns {Promise<any>} A promise that resolves with the prediction result from the server.
 */
export const predictCrops = async (
  crops: Crop[],
  options: PredictionOptions = {},
): Promise<any> => {
  if (crops.length === 0) {
    console.warn("No crops to send for prediction");
    return { status: "error", message: "No crops to send" };
  }

  const mergedOptions = { ...DEFAULT_PREDICTION_OPTIONS, ...options };

  try {
    console.log(`Sending ${crops.length} crops for prediction...`);

    const response = await fetch("/magic_pen/predict_crops", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        crops,
        mode: mergedOptions.predict_mode,
        apply_morphology: mergedOptions.apply_morphology,
        morph_kernel_size: mergedOptions.morph_kernel_size,
        morph_iterations: mergedOptions.morph_iterations,
        apply_dbscan: mergedOptions.apply_dbscan,
        db_eps: mergedOptions.db_eps,
        db_min_samples: mergedOptions.db_min_samples,
        sensitivity: mergedOptions.sensitivity,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.status === "success") {
      console.log(`Successfully processed ${result.num_crops_processed} crops`);
      return result;
    } else {
      throw new Error(result.message || "Prediction failed");
    }
  } catch (error) {
    console.error("Error sending crops for prediction:", error);
    throw error;
  }
};
