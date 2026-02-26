import type { MaskApiResult } from "./masks";

const DATA_URL_PREFIX_PNG = "data:image/png;base64,";
const DATA_URL_PREFIX_JPEG = "data:image/jpeg;base64,";
const DATA_URL_PREFIX_JPG = "data:image/jpg;base64,";

const stripImageDataUrlPrefix = (dataUrl: string): string => {
  if (dataUrl.startsWith(DATA_URL_PREFIX_PNG)) {
    return dataUrl.slice(DATA_URL_PREFIX_PNG.length);
  }
  if (dataUrl.startsWith(DATA_URL_PREFIX_JPEG)) {
    return dataUrl.slice(DATA_URL_PREFIX_JPEG.length);
  }
  if (dataUrl.startsWith(DATA_URL_PREFIX_JPG)) {
    return dataUrl.slice(DATA_URL_PREFIX_JPG.length);
  }
  return dataUrl;
};

export const uploadImageToBackend = async ({
  datasetName,
  imageName,
  imageDataUrl,
}: {
  datasetName: string;
  imageName: string;
  imageDataUrl: string;
}): Promise<MaskApiResult> => {
  try {
    const response = await fetch(
      `/datasets/${datasetName}/images/${imageName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          type: "upload",
        },
        body: JSON.stringify({ image: stripImageDataUrlPrefix(imageDataUrl) }),
      },
    );

    const status = response.status;
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      return {
        ok: false,
        status,
        error: data?.message ?? "Image upload failed",
      };
    }

    return { ok: true, status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};