export const fetchImageFromBackend = async (dir: string) => {
  try {
    console.log(dir);
    const response = await fetch(dir);
    if (!response.ok) throw new Error("Image not found");

    const base64Data = await response.text();
    return `data:image/png;base64,${base64Data}`;
  } catch (error) {
    console.error("Error fetching image:", error);
    return null;
  }
};

export const getDatasetList = async (): Promise<string[]> => {
  try {
    const response = await fetch("/datasets/list");
    if (!response.ok) throw new Error("Dataset list not found");
    return await response.json();
  } catch (error) {
    console.error("Error fetching dataset list:", error);
    return [];
  }
};

export const getImageList = async (dataset: string = "test1") => {
  try {
    const response = await fetch(`/datasets/${dataset}/images`);
    if (!response.ok) throw new Error("Image list not found");

    const files = await response.json();
    return files.map((file: string) => ({
      name: file,
      dir: `/datasets/${dataset}/images/${file}`,
    }));
  } catch (error) {
    console.error("Error fetching image list:", error);
    return [];
  }
};
