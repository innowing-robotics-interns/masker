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

/**
 * Sends the collected crops to the server for prediction.
 *
 * @param {Crop[]} crops - An array of crop objects to be sent for prediction.
 * @param {PredictionOptions} options - Additional options for the prediction.
 * @returns {Promise<any>} A promise that resolves with the prediction result from the server.
 */
export const predictCrops = async (
  crops: Crop[],
  options: PredictionOptions,
): Promise<any> => {
  const predictions = await Promise.all(
    crops.map(async (crop) => {
      try {
        const response = await fetch("/predict", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image: crop.image_base64,
            ...options,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        // Add the crop's coordinates to the result, so we know where to place the mask
        return {
          ...result,
          centerX: crop.centerX,
          centerY: crop.centerY,
          width: crop.width,
          height: crop.height,
        };
      } catch (error) {
        console.error("Error sending a crop for prediction:", error);
        return null;
      }
    }),
  );

  // Filter out any failed predictions
  const successfulPredictions = predictions.filter(
    (p) => p && p.status === "success",
  );

  if (successfulPredictions.length > 0) {
    return {
      status: "success",
      predictions: successfulPredictions,
    };
  } else {
    return {
      status: "error",
      message: "All crop predictions failed.",
    };
  }
};
