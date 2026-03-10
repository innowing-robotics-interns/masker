import { useState, useEffect, useContext } from "react";
import { getImageList } from "../utils/fetchImages";
import { CanvasContext } from "../contexts/Contexts";

type ImageItem = { name: string; dir: string };

export default function FileManager({
  onClose,
}: { onClose?: () => void } = {}) {
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

  useEffect(() => {
    const fetchImages = async () => {
      const images = await getImageList();
      setImageList(images); // Update state with fetched images
    };

    fetchImages();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onClose && onClose()}
      />

      {/* Modal container */}
      <div className="relative bg-white rounded-md shadow-md w-[min(90%,600px)] max-h-[80vh] overflow-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Image Files</h2>
        </div>

        <div className="grid gap-2">
          {imageList.length === 0 && (
            <div className="text-sm text-gray-500">No images found.</div>
          )}

          {imageList.map((image, index) => (
            <div
              key={index}
              onClick={() => handleImageClick(image.dir)}
              className={`flex items-center justify-between p-3 rounded cursor-pointer transition-colors $ hover:bg-blue-50`}
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
