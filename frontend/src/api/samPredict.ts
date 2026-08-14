/**
 * @file API function for full-image SAM3 text-prompt segmentation.
 * @module api/samPredict
 */

export interface SamOptions {
  /** Text prompt to ground on (default backend prompt is "cracks"). */
  textPrompt?: string;
  /** Detection keep threshold 0..1 (backend default 0.5; lower finds more). */
  confidenceThreshold?: number;
}

/**
 * Sends the full canvas image to the SAM3 backend for text-prompt segmentation.
 *
 * @param imageBase64 - Base64-encoded data URL of the image (from canvas.toDataURL())
 * @param options - Optional prompt / confidence-threshold overrides.
 * @returns A promise resolving with { status, merged_mask_base64, num_detections, scores, prompt_used, threshold_used }
 */
export const predictSam = async (
  imageBase64: string,
  options: SamOptions = {},
): Promise<any> => {
  try {
    console.log("Sending image to SAM for analysis...");

    const body: Record<string, unknown> = { image_base64: imageBase64 };
    if (options.textPrompt) body.text_prompt = options.textPrompt;
    if (options.confidenceThreshold != null)
      body.confidence_threshold = options.confidenceThreshold;

    const response = await fetch("/magic_pen/predict_sam", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.status === "success") {
      console.log("SAM analysis completed successfully");
      return result;
    } else {
      throw new Error(result.message || "SAM prediction failed");
    }
  } catch (error) {
    console.error("Error sending image for SAM prediction:", error);
    throw error;
  }
};
