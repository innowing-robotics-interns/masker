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

export type FolderImportResult =
  | { ok: true; status: number; data: { dataset: string; saved: number; skipped: number; subfolders: string[]; message: string } }
  | { ok: false; status: number; error: string };

/**
 * Import a whole ScanRGBD capture folder as a new dataset in one request.
 * Each file's relative path (from the directory picker) is carried in the
 * multipart field NAME, which browsers don't sanitize — the backend
 * reconstructs datasets/<dataset>/{RGB,Frame,Confidence,...}/.
 */
export const importFolderToBackend = async ({
  datasetName,
  files,
}: {
  datasetName: string;
  files: File[];
}): Promise<FolderImportResult> => {
  try {
    const form = new FormData();
    for (const file of files) {
      const rel =
        (file as unknown as { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      form.append(rel, file, file.name);
    }

    const response = await fetch(`/datasets/${datasetName}/import`, {
      method: "POST",
      body: form,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data?.message ?? "Folder import failed",
      };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
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