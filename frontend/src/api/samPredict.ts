/**
 * @file API function for full-image SAM3 text-prompt segmentation.
 * @module api/samPredict
 */

/**
 * Sends the full canvas image to the SAM3 backend for text-prompt segmentation.
 *
 * @param {string} imageBase64 - Base64-encoded data URL of the image (e.g. from canvas.toDataURL())
 * @returns {Promise<any>} A promise that resolves with { status, merged_mask_base64 }
 */
export const predictSam = async (imageBase64: string): Promise<any> => {
  try {
    console.log("Sending image to SAM for analysis...");

    const response = await fetch("/magic_pen/predict_sam", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_base64: imageBase64,
      }),
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
