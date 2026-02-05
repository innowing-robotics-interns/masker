export type MaskApiResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

const DATA_URL_PREFIX = "data:image/png;base64,";

export const stripDataUrlPrefix = (dataUrl: string): string => {
  return dataUrl.startsWith(DATA_URL_PREFIX)
    ? dataUrl.slice(DATA_URL_PREFIX.length)
    : dataUrl;
};

export const getDatasetNameFromImageUrl = (imageUrl: string): string | null => {
  const match = imageUrl.match(/\/datasets\/([^/]+)\/images\//);
  return match?.[1] ?? null;
};

export const getLabelNameFromImageUrl = (imageUrl: string): string | null => {
  try {
    const fileName = imageUrl.split("/").pop();
    if (!fileName) return null;
    const base = fileName.split(".")[0];
    return `${base}.png`;
  } catch {
    return null;
  }
};

const postLabel = async ({
  datasetName,
  labelName,
  maskBase64,
  type,
}: {
  datasetName: string;
  labelName: string;
  maskBase64: string;
  type: "save" | "upload";
}): Promise<MaskApiResult> => {
  try {
    const response = await fetch(
      `/datasets/${datasetName}/labels/${labelName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          type,
        },
        body: JSON.stringify({ label: maskBase64 }),
      },
    );

    const status = response.status;
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      return {
        ok: false,
        status,
        error: data?.message ?? "Mask request failed",
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

export const saveMaskForImage = async (
  imageUrl: string,
  maskDataUrl: string,
): Promise<MaskApiResult> => {
  const datasetName = getDatasetNameFromImageUrl(imageUrl);
  const labelName = getLabelNameFromImageUrl(imageUrl);

  if (!datasetName || !labelName) {
    return {
      ok: false,
      status: 0,
      error: "Could not determine dataset or label name from image URL",
    };
  }

  return postLabel({
    datasetName,
    labelName,
    maskBase64: stripDataUrlPrefix(maskDataUrl),
    type: "save",
  });
};

export const uploadMask = async ({
  datasetName,
  labelName,
  maskDataUrl,
}: {
  datasetName: string;
  labelName: string;
  maskDataUrl: string;
}): Promise<MaskApiResult> => {
  return postLabel({
    datasetName,
    labelName,
    maskBase64: stripDataUrlPrefix(maskDataUrl),
    type: "upload",
  });
};

export const fetchMaskForImage = async (
  imageUrl: string,
): Promise<MaskApiResult> => {
  const datasetName = getDatasetNameFromImageUrl(imageUrl);
  const labelName = getLabelNameFromImageUrl(imageUrl);

  if (!datasetName || !labelName) {
    return {
      ok: false,
      status: 0,
      error: "Could not determine dataset or label name from image URL",
    };
  }

  try {
    const response = await fetch(
      `/datasets/${datasetName}/labels/${labelName}`,
    );
    const status = response.status;
    const base64 = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status,
        error: "Mask not found",
      };
    }

    return {
      ok: true,
      status,
      data: `data:image/png;base64,${base64}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};
