import { useState, useEffect, useContext } from "react";
import { getImageList, getDatasetList } from "../utils/fetchImages";
import { CanvasContext } from "../contexts/Contexts";

type ImageItem = { name: string; dir: string };

export default function FileManager({
  onClose,
}: { onClose?: () => void } = {}) {
  const [datasets, setDatasets] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [imageList, setImageList] = useState<ImageItem[]>([]);
  const { setCurrentImageUrl } = useContext(CanvasContext);

  const handleImageClick = (url: string) => {
    setCurrentImageUrl(url);
    console.log("Image clicked:", url);
    // Close the file manager after selecting an image
    if (onClose) {
      onClose();
    }
  };

  // Load the list of datasets once, and pick a sensible default.
  useEffect(() => {
    const fetchDatasets = async () => {
      const names = await getDatasetList();
      setDatasets(names);
      setSelectedDataset((prev) => {
        if (prev) return prev;
        if (names.includes("test1")) return "test1";
        return names[0] ?? "";
      });
    };
    fetchDatasets();
  }, []);

  // Reload the image list whenever the selected dataset changes.
  useEffect(() => {
    if (!selectedDataset) {
      setImageList([]);
      return;
    }
    const fetchImages = async () => {
      const images = await getImageList(selectedDataset);
      setImageList(images);
    };
    fetchImages();
  }, [selectedDataset]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onClose && onClose()}
      />

      {/* Modal container */}
      <div className="relative bg-white rounded-md shadow-md w-[min(90%,600px)] max-h-[80vh] overflow-auto p-4">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="text-lg font-semibold">Image Files</h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Dataset</span>
            <select
              value={selectedDataset}
              onChange={(e) => setSelectedDataset(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm max-w-[220px]"
            >
              {datasets.length === 0 && <option value="">(none)</option>}
              {datasets.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-2">
          {imageList.length === 0 && (
            <div className="text-sm text-gray-500">No images found.</div>
          )}

          {imageList.map((image, index) => (
            <div
              key={index}
              onClick={() => handleImageClick(image.dir)}
              className={`flex items-center justify-between p-3 rounded cursor-pointer transition-colors hover:bg-blue-50`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">📸</span>
                <span className="text-sm font-medium">{image.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={image.dir}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  Open
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
