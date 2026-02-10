import { useRef, useEffect, useState, useCallback, useContext } from "react";
import { fetchImageFromBackend } from "../utils/fetchImages";
import { CanvasContext } from "../contexts/Contexts";
import type { Tool, Crop } from "../types";
import Toolbar from "./Toolbar";
import { predictCrops } from "../api/magicPen";
import ColorPickerPopover from "./ColorPickerPopover";
import {
  saveMaskForImage,
  uploadMask,
  getDatasetNameFromImageUrl,
  fetchMaskForImage,
} from "../utils/masks";
import SliderDemo from "./Slider";

export default function Canvas({
  toggleFiles,
  activeTool,
  setActiveTool,
  scrollContainerRef,
}: {
  toggleFiles: () => void;
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}) {
  const [brushMode, setBrushMode] = useState<"draw" | "magic" | "erase">(
    "draw",
  );
  const [brushSize, setBrushSize] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const [maskPreviewRgb, setMaskPreviewRgb] = useState({
    r: 255,
    g: 255,
    b: 255,
  });
  const [showMaskSavedToast, setShowMaskSavedToast] = useState(false);
  const saveToastTimeoutRef = useRef<number | null>(null);
  const [colorPickerAnchor, setColorPickerAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const maskPreviewColorCss = `rgb(${maskPreviewRgb.r}, ${maskPreviewRgb.g}, ${maskPreviewRgb.b})`;
  const maskPreviewColorRef = useRef(maskPreviewColorCss);
  const lastPosRef = useRef<[number, number] | null>(null);
  const {
    maskCanvasRef,
    imageCanvasRef,
    storeState,
    currentImageUrl,
    canvasVersion,
    zoomLevel,
    setZoomLevel,
  } = useContext(CanvasContext);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const previewQueuedRef = useRef(false);
  const minZoom = 0.2;
  const maxZoom = 5.0;
  const zoomStep = 0.1;

  const zoomTo = useCallback(
    (nextZoom: number) => {
      const container = scrollContainerRef?.current;
      if (!container) {
        setZoomLevel(nextZoom);
        return;
      }

      const { scrollLeft, scrollTop, clientWidth, clientHeight } = container;
      const centerX = (scrollLeft + clientWidth / 2) / zoomLevel;
      const centerY = (scrollTop + clientHeight / 2) / zoomLevel;

      setZoomLevel(nextZoom);

      requestAnimationFrame(() => {
        container.scrollLeft = centerX * nextZoom - clientWidth / 2;
        container.scrollTop = centerY * nextZoom - clientHeight / 2;
      });
    },
    [scrollContainerRef, setZoomLevel, zoomLevel],
  );

  // Magic pen overlay canvas
  const magicPenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const cropSizeRef = useRef<number>(200); // size of each crop square
  const cropEveryLenRef = useRef<number>(100); // distance between crops
  const magicPenColor = "rgba(255, 0, 255, 0.9)";

  // Collected crops
  const cropsRef = useRef<Crop[]>([]);

  // History / sampling controls
  const foregroundColor = "rgb(255, 255, 255)"; // White
  const backgroundColor = "rgb(0, 0, 0)"; // Black, used for erase mode logic
  const brushSpacing = 1;

  useEffect(() => {
    maskPreviewColorRef.current = maskPreviewColorCss;
  }, [maskPreviewColorCss]);

  useEffect(() => {
    if (activeTool === "erase") {
      setBrushMode("erase");
    } else if (activeTool === "magic") {
      setBrushMode("magic");
    } else if (activeTool === "brush") {
      setBrushMode("draw");
    }
  }, [activeTool]);

  const getMouseXY = useCallback(
    (e: MouseEvent): [number, number] => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return [0, 0];

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoomLevel;
      const y = (e.clientY - rect.top) / zoomLevel;

      return [x, y];
    },
    [maskCanvasRef, zoomLevel],
  );

  const dist = useCallback(
    (x1: number, y1: number, x2: number, y2: number): number => {
      return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
    },
    [],
  );

  // Draw a filled circle on the provided context
  const drawCircle = useCallback(
    (
      x: number,
      y: number,
      width: number,
      ctx: CanvasRenderingContext2D,
      mode?: "draw" | "erase" | "magic",
    ) => {
      const color =
        mode === "magic"
          ? magicPenColor
          : mode === "erase"
            ? backgroundColor
            : foregroundColor;

      ctx.fillStyle = color;
      ctx.strokeStyle = color;

      if (mode === "erase") {
        ctx.globalCompositeOperation = "destination-out";
      } else {
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.beginPath();
      ctx.imageSmoothingEnabled = false;
      ctx.arc(
        x,
        y,
        mode === "magic" ? cropSizeRef.current / 2 : brushSize,
        0,
        2 * Math.PI,
      );
      ctx.fill();
    },
    [magicPenColor, backgroundColor, foregroundColor, brushSize],
  );

  // Flood fill (used on right click)
  const floodFill = useCallback(
    (
      x: number,
      y: number,
      ctx: CanvasRenderingContext2D,
      tolerance: number = 50,
    ) => {
      const imageData = ctx.getImageData(
        0,
        0,
        ctx.canvas.width,
        ctx.canvas.height,
      );
      const { data, width, height } = imageData;

      const [fillR, fillG, fillB, fillA] =
        foregroundColor === "rgb(255, 255, 255)"
          ? [255, 255, 255, 255]
          : [0, 0, 0, 255];

      const startX = Math.floor(x);
      const startY = Math.floor(y);
      const startIdx = (startY * width + startX) * 4;
      const startColor = [
        data[startIdx],
        data[startIdx + 1],
        data[startIdx + 2],
        data[startIdx + 3],
      ];

      if (
        startColor[0] === fillR &&
        startColor[1] === fillG &&
        startColor[2] === fillB &&
        startColor[3] === fillA
      ) {
        return;
      }

      const matchColor = (idx: number) =>
        Math.abs(data[idx] - startColor[0]) <= tolerance &&
        Math.abs(data[idx + 1] - startColor[1]) <= tolerance &&
        Math.abs(data[idx + 2] - startColor[2]) <= tolerance &&
        Math.abs(data[idx + 3] - startColor[3]) <= tolerance;

      const setColor = (idx: number) => {
        data[idx] = fillR;
        data[idx + 1] = fillG;
        data[idx + 2] = fillB;
        data[idx + 3] = fillA;
      };

      const queue: [number, number][] = [[startX, startY]];
      const visited = new Set<string>([`${startX},${startY}`]);

      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) continue;
        const [currentX, currentY] = next;

        const currentIdx = (currentY * width + currentX) * 4;

        if (matchColor(currentIdx)) {
          setColor(currentIdx);

          const neighbors: [number, number][] = [
            [currentX + 1, currentY],
            [currentX - 1, currentY],
            [currentX, currentY + 1],
            [currentX, currentY - 1],
          ];

          for (const [nx, ny] of neighbors) {
            const key = `${nx},${ny}`;
            if (
              nx >= 0 &&
              nx < width &&
              ny >= 0 &&
              ny < height &&
              !visited.has(key)
            ) {
              visited.add(key);
              queue.push([nx, ny]);
            }
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
    },
    [foregroundColor],
  );

  const drawPoint = useCallback(
    (
      x: number,
      y: number,
      ctx: CanvasRenderingContext2D,
      mode: "draw" | "magic" | "erase" = "draw",
      lineLenRef?: { current: number },
    ) => {
      const lastPos = lastPosRef.current;

      if (lastPos) {
        const [x0, y0] = lastPos;
        const d = dist(x0, y0, x, y);

        if (lineLenRef && typeof lineLenRef.current === "number") {
          lineLenRef.current += d;
        }

        if (d > brushSpacing) {
          const spacingRatio = brushSpacing / d;
          let spacingRatioTotal = spacingRatio;

          while (spacingRatioTotal <= 1) {
            const xn = x0 + spacingRatioTotal * (x - x0);
            const yn = y0 + spacingRatioTotal * (y - y0);

            drawCircle(xn, yn, brushSize, ctx, mode);

            spacingRatioTotal += spacingRatio;
          }
        } else {
          drawCircle(x, y, brushSize, ctx, mode);
        }
      } else {
        drawCircle(x, y, brushSize, ctx, mode);
      }
    },
    [brushSize, brushSpacing, dist, drawCircle],
  );

  const renderMaskPreview = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!maskCanvas || !previewCanvas) return;

    const width = maskCanvas.width;
    const height = maskCanvas.height;

    if (previewCanvas.width !== width) previewCanvas.width = width;
    if (previewCanvas.height !== height) previewCanvas.height = height;

    const ctx = previewCanvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(maskCanvas, 0, 0);

    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = maskPreviewColorRef.current;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "source-over";
  }, [maskCanvasRef, previewCanvasRef]);

  const scheduleMaskPreviewUpdate = useCallback(() => {
    if (previewQueuedRef.current) return;
    previewQueuedRef.current = true;
    previewRafRef.current = window.requestAnimationFrame(() => {
      previewQueuedRef.current = false;
      renderMaskPreview();
    });
  }, [renderMaskPreview]);

  useEffect(() => {
    scheduleMaskPreviewUpdate();
  }, [maskPreviewColorCss, scheduleMaskPreviewUpdate]);

  const removeGray = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    const maskCtx = maskCanvas?.getContext("2d");
    if (!maskCanvas || !maskCtx) return;

    const imageData = maskCtx.getImageData(
      0,
      0,
      maskCanvas.width,
      maskCanvas.height,
    );
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];

      // choose a threshold; often alpha is the right one
      const on = a > 127;

      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = on ? 255 : 0;
    }
    maskCtx.putImageData(imageData, 0, 0);
    storeState();
    scheduleMaskPreviewUpdate();
  }, [maskCanvasRef, storeState, scheduleMaskPreviewUpdate]);

  const lineLenRef = useRef<number>(0);

  // Double check this one
  const applyPredictionToMask = useCallback(
    (result: any) => {
      if (result.predictions) {
        result.predictions.forEach((prediction: any) => {
          const maskCanvas = maskCanvasRef.current;
          if (!maskCanvas) return;
          const maskCtx = maskCanvas.getContext("2d");
          if (!maskCtx) return;

          const img = new Image();
          img.onload = () => {
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext("2d");
            if (!tempCtx) return;

            tempCtx.drawImage(img, 0, 0);
            const predictionData = tempCtx.getImageData(
              0,
              0,
              img.width,
              img.height,
            );
            const predictionPixels = predictionData.data;

            const newMaskData = maskCtx.createImageData(img.width, img.height);
            const newMaskPixels = newMaskData.data;

            for (let i = 0; i < predictionPixels.length; i += 4) {
              const r = predictionPixels[i];
              const g = predictionPixels[i + 1];
              const b = predictionPixels[i + 2];

              if (r > 200 && g > 200 && b > 200) {
                newMaskPixels[i] = 255;
                newMaskPixels[i + 1] = 255;
                newMaskPixels[i + 2] = 255;
                newMaskPixels[i + 3] = 255;
              }
            }

            const finalTempCanvas = document.createElement("canvas");
            finalTempCanvas.width = img.width;
            finalTempCanvas.height = img.height;
            const finalTempCtx = finalTempCanvas.getContext("2d");
            if (!finalTempCtx) return;
            finalTempCtx.putImageData(newMaskData, 0, 0);

            maskCtx.globalCompositeOperation = "source-over";
            maskCtx.drawImage(
              finalTempCanvas,
              prediction.centerX - prediction.width / 2,
              prediction.centerY - prediction.height / 2,
            );

            removeGray();
            storeState();
          };
          img.src = prediction.mask_base64;
        });
      } else if (result.merged_mask_base64) {
        const maskCanvas = maskCanvasRef.current;
        if (!maskCanvas) return;
        const maskCtx = maskCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!maskCtx) return;

        const img = new Image();
        img.onload = () => {
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = maskCanvas.width;
          tempCanvas.height = maskCanvas.height;
          const tempCtx = tempCanvas.getContext("2d");
          if (!tempCtx) return;

          tempCtx.drawImage(img, 0, 0, maskCanvas.width, maskCanvas.height);

          const newMaskData = tempCtx.getImageData(
            0,
            0,
            tempCanvas.width,
            tempCanvas.height,
          );
          const newMaskPixels = newMaskData.data;

          const currentMaskData = maskCtx.getImageData(
            0,
            0,
            maskCanvas.width,
            maskCanvas.height,
          );
          const currentMaskPixels = currentMaskData.data;

          for (let i = 0; i < newMaskPixels.length; i += 4) {
            if (
              newMaskPixels[i] === 255 &&
              newMaskPixels[i + 1] === 255 &&
              newMaskPixels[i + 2] === 255
            ) {
              currentMaskPixels[i] = 255;
              currentMaskPixels[i + 1] = 255;
              currentMaskPixels[i + 2] = 255;
              currentMaskPixels[i + 3] = 255;
            }
          }

          maskCtx.putImageData(currentMaskData, 0, 0);

          removeGray();
          storeState();
        };
        img.src = result.merged_mask_base64;
      }
    },
    [maskCanvasRef, removeGray, storeState],
  );

  // Create and register a crop at a given position (center coordinates)
  function createCropAtPosition(centerX: number, centerY: number) {
    try {
      const cropSize = cropSizeRef.current;
      const cropData = cropImageBase64(centerX, centerY, cropSize, cropSize);

      const crop = {
        id: cropsRef.current.length,
        image_base64: cropData.img,
        centerX,
        centerY,
        width: cropSize,
        height: cropSize,
        canvas_width: imageCanvasRef.current ? imageCanvasRef.current.width : 0,
        canvas_height: imageCanvasRef.current
          ? imageCanvasRef.current.height
          : 0,
        timestamp: Date.now(),
        line_distance: lineLenRef.current,
      };

      return crop;
    } catch (error) {
      console.error("Error creating crop at position:", error);
      return null;
    }
  }

  const processCrops = useCallback(async () => {
    const crops = cropsRef.current;
    if (crops.length === 0) return;

    try {
      const result = await predictCrops(crops, {
        /* prediction options */
      });
      if (result && result.status === "success") {
        applyPredictionToMask(result);
      }
    } catch (error) {
      console.error("Error processing crops:", error);
    } finally {
      // Clear crops and magic pen canvas after processing
      cropsRef.current = [];
      const magicCanvas = magicPenCanvasRef.current;
      const magicCtx = magicCanvas?.getContext("2d");
      if (magicCanvas && magicCtx) {
        magicCtx.clearRect(0, 0, magicCanvas.width, magicCanvas.height);
      }
      lineLenRef.current = 0;
    }
  }, [applyPredictionToMask]);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0) return; // left only

      // store current mask state for undo (for draw & eventual mask changes)
      storeState();

      setIsDrawing(true);
      const [x, y] = getMouseXY(e);
      const maskCanvas = maskCanvasRef.current;
      const magicCanvas = magicPenCanvasRef.current;

      if (!maskCanvas) return;
      const maskCtx = maskCanvas.getContext("2d");

      if (brushMode === "draw") {
        if (!maskCtx) return;
        drawPoint(x, y, maskCtx, "draw");
        scheduleMaskPreviewUpdate();
      } else if (brushMode === "erase") {
        if (!maskCtx) return;
        drawPoint(x, y, maskCtx, "erase");
        scheduleMaskPreviewUpdate();
      } else if (brushMode === "magic") {
        // initialize magic overlay drawing state
        if (!magicCanvas) return;
        const magicCtx = magicCanvas.getContext("2d");
        if (!magicCtx) return;

        // reset crop collection
        cropsRef.current = [];
        lineLenRef.current = 0;

        // draw initial point on magic overlay
        drawPoint(x, y, magicCtx, "magic", lineLenRef);
      }

      lastPosRef.current = [x, y];

      // Update the preview canvas
    },
    [
      drawPoint,
      getMouseXY,
      maskCanvasRef,
      storeState,
      brushMode,
      scheduleMaskPreviewUpdate,
    ],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDrawing) return;

      e.preventDefault();
      e.stopPropagation();

      const [x, y] = getMouseXY(e);
      const maskCanvas = maskCanvasRef.current;
      const magicCanvas = magicPenCanvasRef.current;
      const maskCtx = maskCanvas?.getContext("2d");
      const magicCtx = magicCanvas?.getContext("2d");

      if (brushMode === "draw" && maskCtx) {
        drawPoint(x, y, maskCtx, "draw");
        scheduleMaskPreviewUpdate();
      } else if (brushMode === "erase" && maskCtx) {
        drawPoint(x, y, maskCtx, "erase");
        scheduleMaskPreviewUpdate();
      } else if (brushMode === "magic" && magicCtx) {
        drawPoint(x, y, magicCtx, "magic", lineLenRef);

        // Use cropEveryLenRef to decide interval. This mirrors legacy behavior.
        const cropEvery = cropEveryLenRef.current;
        const lastCropCount = cropsRef.current.length;
        const expectedCount = Math.floor(lineLenRef.current / cropEvery);

        if (expectedCount > lastCropCount) {
          // Create one or more crops to catch up
          for (let i = lastCropCount; i < expectedCount; i++) {
            const centerX = Math.floor(x);
            const centerY = Math.floor(y);
            const crop = createCropAtPosition(centerX, centerY);
            if (crop) {
              cropsRef.current.push(crop);
            }
          }
        }
      }

      lastPosRef.current = [x, y];
    },
    // include createCropAtPosition so linter doesn't flag missing dependency
    [
      isDrawing,
      getMouseXY,
      drawPoint,
      maskCanvasRef,
      brushMode,
      createCropAtPosition,
      scheduleMaskPreviewUpdate,
    ],
  );

  useEffect(() => {
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const magicCanvas = magicPenCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (imageCanvas && maskCanvas && magicCanvas && previewCanvas) {
      const displayWidth = imageCanvas.width * zoomLevel;
      const displayHeight = imageCanvas.height * zoomLevel;
      imageCanvas.style.width = `${displayWidth}px`;
      imageCanvas.style.height = `${displayHeight}px`;
      maskCanvas.style.width = `${displayWidth}px`;
      maskCanvas.style.height = `${displayHeight}px`;
      magicCanvas.style.width = `${displayWidth}px`;
      magicCanvas.style.height = `${displayHeight}px`;
      previewCanvas.style.width = `${displayWidth}px`;
      previewCanvas.style.height = `${displayHeight}px`;
    }
  }, [
    zoomLevel,
    imageCanvasRef,
    maskCanvasRef,
    magicPenCanvasRef,
    previewCanvasRef,
  ]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPosRef.current = null;

    if (brushMode === "draw") {
      removeGray();
    } else if (brushMode === "magic") {
      processCrops();
    } else if (brushMode === "erase") {
      scheduleMaskPreviewUpdate();
    }
  }, [
    isDrawing,
    brushMode,
    removeGray,
    processCrops,
    scheduleMaskPreviewUpdate,
  ]);

  const switchMode = useCallback(() => {
    setBrushMode((prev) => (prev === "magic" ? "draw" : "magic"));
    setActiveTool((prev) => (prev === "magic" ? "brush" : "magic"));
  }, [setActiveTool]);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const [x, y] = getMouseXY(e);
      const maskCanvas = maskCanvasRef.current;
      const maskCtx = maskCanvas?.getContext("2d");
      if (!maskCtx) return;
      floodFill(x, y, maskCtx, 30);
      removeGray();
    },
    [floodFill, getMouseXY, maskCanvasRef, removeGray],
  );

  const applyMaskFromDataUrl = useCallback(
    (maskDataUrl: string) => {
      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) return;
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) return;

      const img = new Image();
      img.onload = () => {
        storeState();
        maskCtx.globalCompositeOperation = "source-over";
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskCtx.drawImage(img, 0, 0, maskCanvas.width, maskCanvas.height);
        removeGray();
      };
      img.src = maskDataUrl;
    },
    [maskCanvasRef, removeGray, storeState],
  );

  const handleSaveMask = useCallback(async () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !currentImageUrl) return;

    const maskDataUrl = maskCanvas.toDataURL("image/png");
    const result = await saveMaskForImage(currentImageUrl, maskDataUrl);

    if (!result.ok) {
      console.error("Failed to save mask:", result.error);
      return;
    }

    setShowMaskSavedToast(true);
    if (saveToastTimeoutRef.current) {
      window.clearTimeout(saveToastTimeoutRef.current);
    }
    saveToastTimeoutRef.current = window.setTimeout(() => {
      setShowMaskSavedToast(false);
      saveToastTimeoutRef.current = null;
    }, 1500);
  }, [currentImageUrl, maskCanvasRef]);

  const handleMaskFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const datasetName = getDatasetNameFromImageUrl(currentImageUrl);

      Array.from(files).forEach((file, index) => {
        if (!file.type.startsWith("image/")) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
          const maskDataUrl = String(e.target?.result ?? "");
          if (!maskDataUrl) return;

          if (datasetName) {
            const result = await uploadMask({
              datasetName,
              labelName: file.name,
              maskDataUrl,
            });

            if (!result.ok) {
              console.error("Failed to upload mask:", result.error);
            }
          } else {
            console.warn("Could not determine dataset name for upload.");
          }

          if (index === 0) {
            applyMaskFromDataUrl(maskDataUrl);
          }
        };
        reader.readAsDataURL(file);
      });

      event.target.value = "";
    },
    [applyMaskFromDataUrl, currentImageUrl],
  );

  const handleLoadMask = useCallback(() => {
    maskFileInputRef.current?.click();
  }, []);

  const handleClearMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return;

    storeState();
    maskCtx.globalCompositeOperation = "source-over";
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    scheduleMaskPreviewUpdate();
  }, [maskCanvasRef, scheduleMaskPreviewUpdate, storeState]);

  // Crop extraction: returns a crop object like legacy app
  const cropImageBase64 = useCallback(
    (
      centerX: number,
      centerY: number,
      cropWidth: number,
      cropHeight: number,
    ) => {
      const imgCanvas = imageCanvasRef.current;
      if (!imgCanvas) {
        return {
          img: "",
          centerX,
          centerY,
          width: cropWidth,
          height: cropHeight,
        };
      }

      // Convert from displayed coordinates (mouse position) to canvas pixels.
      const startX = Math.floor(centerX - cropWidth / 2);
      const startY = Math.floor(centerY - cropHeight / 2);

      const clampedStartX = Math.max(0, startX);
      const clampedStartY = Math.max(0, startY);
      const clampedEndX = Math.min(imgCanvas.width, startX + cropWidth);
      const clampedEndY = Math.min(imgCanvas.height, startY + cropHeight);

      const actualCropWidth = clampedEndX - clampedStartX;
      const actualCropHeight = clampedEndY - clampedStartY;

      // Prepare crop canvas of requested dimensions and center the extracted region
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      const cropCtx = cropCanvas.getContext("2d")!;
      cropCtx.fillStyle = "rgb(0,0,0)";
      cropCtx.fillRect(0, 0, cropWidth, cropHeight);

      if (actualCropWidth > 0 && actualCropHeight > 0) {
        const tmp = document.createElement("canvas");
        tmp.width = actualCropWidth;
        tmp.height = actualCropHeight;
        const tmpCtx = tmp.getContext("2d")!;
        const imgCtx = imageCanvasRef.current!.getContext("2d")!;
        const imgData = imgCtx.getImageData(
          clampedStartX,
          clampedStartY,
          actualCropWidth,
          actualCropHeight,
        );
        tmpCtx.putImageData(imgData, 0, 0);

        const offsetX = Math.floor((cropWidth - actualCropWidth) / 2);
        const offsetY = Math.floor((cropHeight - actualCropHeight) / 2);

        cropCtx.drawImage(
          tmp,
          0,
          0,
          actualCropWidth,
          actualCropHeight,
          offsetX,
          offsetY,
          actualCropWidth,
          actualCropHeight,
        );
      }

      return {
        img: cropCanvas.toDataURL("image/png"),
        centerX,
        centerY,
        width: cropWidth,
        height: cropHeight,
      };
    },
    [imageCanvasRef],
  );

  // Load image and match sizes for all canvases
  const loadImage = useCallback(
    (src: string) => {
      const img = new Image();
      img.onload = () => {
        const imageCanvas = imageCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        const magicCanvas = magicPenCanvasRef.current;
        const imageCtx = imageCanvas?.getContext("2d");
        const maskCtx = maskCanvas?.getContext("2d");
        const magicCtx = magicCanvas?.getContext("2d");

        if (
          !imageCanvas ||
          !maskCanvas ||
          !imageCtx ||
          !maskCtx ||
          !magicCanvas ||
          !magicCtx
        )
          return;

        // Resize canvases to match image dimensions
        imageCanvas.width = img.width;
        imageCanvas.height = img.height;
        maskCanvas.width = img.width;
        maskCanvas.height = img.height;
        magicCanvas.width = img.width;
        magicCanvas.height = img.height;

        // Draw image on the image canvas
        imageCtx.clearRect(0, 0, img.width, img.height);
        imageCtx.imageSmoothingEnabled = false;
        imageCtx.drawImage(img, 0, 0, img.width, img.height);

        // Initialize mask canvas to be transparent and magic overlay cleared
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        magicCtx.clearRect(0, 0, magicCanvas.width, magicCanvas.height);
        // Deleted: mask preview data-URL reset because preview rendering no longer uses `maskPreviewUrl`.
        const previewCanvas = previewCanvasRef.current;
        const previewCtx = previewCanvas?.getContext("2d");
        if (previewCanvas && previewCtx) {
          previewCanvas.width = img.width;
          previewCanvas.height = img.height;
          previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        }

        // Ensure initial 100% zoom immediately on load
        const displayWidth = img.width;
        const displayHeight = img.height;
        imageCanvas.style.width = `${displayWidth}px`;
        imageCanvas.style.height = `${displayHeight}px`;
        maskCanvas.style.width = `${displayWidth}px`;
        maskCanvas.style.height = `${displayHeight}px`;
        magicCanvas.style.width = `${displayWidth}px`;
        magicCanvas.style.height = `${displayHeight}px`;
        if (previewCanvas) {
          previewCanvas.style.width = `${displayWidth}px`;
          previewCanvas.style.height = `${displayHeight}px`;
        }
      };

      img.onerror = () => {
        console.error("Failed to load image");
      };

      img.src = src;
    },
    [maskCanvasRef, imageCanvasRef, magicPenCanvasRef, previewCanvasRef],
  );

  const loadImageFromBackend = useCallback(async () => {
    const imageSrc = await fetchImageFromBackend(currentImageUrl);
    if (imageSrc) {
      loadImage(imageSrc);

      const maskResult = await fetchMaskForImage(currentImageUrl);
      if (maskResult.ok && typeof maskResult.data === "string") {
        applyMaskFromDataUrl(maskResult.data);
      }
    }
  }, [applyMaskFromDataUrl, currentImageUrl, loadImage]);

  // Initialize canvas
  useEffect(() => {
    loadImageFromBackend();
  }, [loadImageFromBackend]);

  // Handle event listeners on the mask canvas (which is top-level input receiver)
  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseUp);
    canvas.addEventListener("contextmenu", handleContextMenu);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseUp);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleContextMenu,
    maskCanvasRef,
  ]);

  return (
    <main className="h-full w-full relative bg-neutral-100 touch-none">
      <Toolbar
        toggleFiles={toggleFiles}
        switchMode={switchMode}
        zoomIn={() => zoomTo(Math.min(zoomLevel + zoomStep, maxZoom))}
        zoomOut={() => zoomTo(Math.max(zoomLevel - zoomStep, minZoom))}
        zoomLevel={zoomLevel}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        onColorPickerClick={(anchor) => setColorPickerAnchor(anchor)}
        colorPickerColor={maskPreviewColorCss}
        onSaveMask={handleSaveMask}
        onLoadMask={handleLoadMask}
        onClearMask={handleClearMask}
      />
      {showMaskSavedToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded bg-green-600 px-3 py-2 text-sm text-white shadow">
          Mask saved to the server
        </div>
      )}
      <input
        ref={maskFileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleMaskFileChange}
      />

      <ColorPickerPopover
        visible={activeTool === "colorPicker"}
        anchor={colorPickerAnchor}
        color={maskPreviewRgb}
        colorCss={maskPreviewColorCss}
        onChange={setMaskPreviewRgb}
        onClose={() => {
          setActiveTool("brush");
          setColorPickerAnchor(null);
        }}
      />
      {/* Slider */}
      {(activeTool === "brush" || activeTool === "erase") && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-gray-100 rounded-md shadow-xl px-6 py-4 min-w-[330px]">
          <SliderDemo
            label="Brush Size"
            min={1}
            max={10}
            step={1}
            value={brushSize}
            showValue={true}
            onChange={setBrushSize}
          />
        </div>
      )}

      <div className="relative w-fit h-fit border border-gray-300 shadow-md">
        <canvas ref={imageCanvasRef} className="block" />
        {/* Deleted: CSS mask-image overlay because it required `toDataURL()` each update and caused lag. */}
        <canvas
          ref={previewCanvasRef}
          className="absolute top-0 left-0 block pointer-events-none opacity-80"
        />
        <canvas
          key={canvasVersion}
          ref={maskCanvasRef}
          className="absolute top-0 left-0 block cursor-crosshair opacity-0"
        />
        {/* magic overlay: draws magenta strokes and renders each crop as a square image */}
        <canvas
          ref={magicPenCanvasRef}
          className="absolute top-0 left-0 block cursor-crosshair opacity-50 pointer-events-none"
        />
      </div>
    </main>
  );
}
