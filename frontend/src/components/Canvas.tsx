import { useRef, useEffect, useState, useCallback, useContext } from "react";
import { fetchImageFromBackend } from "../utils/fetchImages";
import { CanvasContext } from "../contexts/Contexts";

export default function Canvas() {
  const [brushMode, setBrushMode] = useState<"draw" | "magic" | "erase">(
    "draw",
  );
  const [brushSize, setBrushSize] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPosRef = useRef<[number, number] | null>(null);
  const { maskCanvasRef, imageCanvasRef, storeState, currentImageUrl } =
    useContext(CanvasContext);

  // Magic pen overlay canvas
  const magicPenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const cropSizeRef = useRef<number>(200); // size of each crop square
  const cropEveryLenRef = useRef<number>(100); // distance between crops
  const magicPenColor = "rgba(255, 0, 255, 0.9)";

  // Collected crops
  const cropsRef = useRef<
    Array<{
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
    }>
  >([]);

  // History / sampling controls
  const foregroundColor = "rgb(255, 255, 255)"; // White
  const backgroundColor = "rgb(0, 0, 0)"; // Black, used for erase mode logic
  const brushSpacing = 1;

  const getMouseXY = useCallback(
    (e: MouseEvent): [number, number] => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return [0, 0];

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      return [x, y];
    },
    [maskCanvasRef],
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
    [magicPenColor, backgroundColor, foregroundColor],
  );

  // Flood fill (used on right click)
  const floodFill = useCallback(
    (
      x: number,
      y: number,
      ctx: CanvasRenderingContext2D,
      tolerance: number = 254,
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

  const lineLenRef = useRef<number>(0);

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

  // Process crops locally (demo): render each crop image onto the magic overlay as a square.
  async function processCropsLocally(
    crops: Array<{
      id: number;
      image_base64: string;
      centerX: number;
      centerY: number;
      width: number;
      height: number;
    }>,
    magicCtx: CanvasRenderingContext2D,
  ) {
    if (crops.length === 0) return null;

    const drawPromises = crops.map(
      (crop) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const x = Math.floor(crop.centerX - crop.width / 2);
            const y = Math.floor(crop.centerY - crop.height / 2);

            magicCtx.save();
            magicCtx.globalCompositeOperation = "source-over";
            magicCtx.imageSmoothingEnabled = false;
            magicCtx.drawImage(img, x, y, crop.width, crop.height);

            magicCtx.strokeStyle = "rgba(255, 0, 255, 0.9)";
            magicCtx.lineWidth = 2;
            magicCtx.strokeRect(
              x + 0.5,
              y + 0.5,
              crop.width - 1,
              crop.height - 1,
            );

            magicCtx.restore();
            resolve();
          };
          img.onerror = () => {
            resolve();
          };
          img.src = crop.image_base64;
        }),
    );

    await Promise.all(drawPromises);
    return { status: "success", num_crops_rendered: crops.length };
  }

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
      } else if (brushMode === "erase") {
        if (!maskCtx) return;
        drawPoint(x, y, maskCtx, "erase");
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
    },
    [drawPoint, getMouseXY, maskCanvasRef, storeState, brushMode],
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
      } else if (brushMode === "erase" && maskCtx) {
        drawPoint(x, y, maskCtx, "erase");
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
    ],
  );

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
      // if closer to white, set to white; else black
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (avg > 127) {
        data[i] = data[i + 1] = data[i + 2] = 255;
      } else {
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    maskCtx.putImageData(imageData, 0, 0);
  }, [maskCanvasRef]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPosRef.current = null;

    if (brushMode === "draw") {
      removeGray();
    } else if (brushMode === "magic") {
      // For demo only: process collected crops locally and render them on the magic overlay
      const magicCanvas = magicPenCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;

      if (!magicCanvas) return;
      const magicCtx = magicCanvas.getContext("2d");
      const maskCtx = maskCanvas?.getContext("2d");

      if (!magicCtx) return;

      // Clear any transient magic strokes before rendering final crop overlays
      magicCtx.clearRect(0, 0, magicCanvas.width, magicCanvas.height);

      if (cropsRef.current.length === 0) {
        // Nothing to render
        return;
      }

      // Render each crop onto the magic overlay (visual demo)
      processCropsLocally(cropsRef.current, magicCtx)
        .then(() => {
          // Clear collected crops after applying them
          cropsRef.current = [];
          // Reset line length tracker
          lineLenRef.current = 0;
        })
        .catch((err) => {
          console.error("Error rendering crops locally:", err);
        });
    }
  }, [isDrawing, brushMode, removeGray, processCropsLocally, storeState]);

  const switchMode = useCallback(() => {
    setBrushMode((prev) => (prev === "draw" ? "magic" : "draw"));
  }, []);

  const handleBrushSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setBrushSize(Number(e.target.value));
    },
    [],
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const [x, y] = getMouseXY(e);
      const maskCanvas = maskCanvasRef.current;
      const maskCtx = maskCanvas?.getContext("2d");
      if (!maskCtx) return;
      floodFill(x, y, maskCtx);
      removeGray();
    },
    [floodFill, getMouseXY, maskCanvasRef, removeGray],
  );

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
      };

      img.onerror = () => {
        console.error("Failed to load image");
      };

      img.src = src;
    },
    [maskCanvasRef, imageCanvasRef, magicPenCanvasRef],
  );

  const loadImageFromBackend = useCallback(async () => {
    const imageSrc = await fetchImageFromBackend(currentImageUrl);
    if (imageSrc) {
      loadImage(imageSrc);
    }
  }, [currentImageUrl, loadImage]);

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
      <div className="flex items-center gap-4 p-2">
        <button
          onClick={() => setBrushMode((p) => (p === "draw" ? "erase" : "draw"))}
          className={`px-4 py-2 text-white border-none rounded cursor-pointer ${
            brushMode === "erase" ? "bg-red-500" : "bg-green-500"
          }`}
        >
          {brushMode === "draw"
            ? "Draw (White)"
            : brushMode === "erase"
              ? "Erase"
              : "Draw"}
        </button>

        <button
          onClick={switchMode}
          className={`px-4 py-2 text-white border-none rounded cursor-pointer ${
            brushMode === "magic" ? "bg-purple-600" : "bg-neutral-700"
          }`}
        >
          {brushMode === "magic" ? "Magic Brush (On)" : "Magic Brush (Off)"}
        </button>

        <div className="flex items-center gap-2.5">
          <label htmlFor="brush-size">Brush Size:</label>
          <input
            id="brush-size"
            type="range"
            min="1"
            max="50"
            value={brushSize}
            onChange={handleBrushSizeChange}
          />
          <span className="min-w-[30px] text-center">{brushSize}</span>
        </div>
      </div>

      <div className="relative w-fit h-fit border border-gray-300 shadow-md">
        <canvas ref={imageCanvasRef} className="block" />
        <canvas
          ref={maskCanvasRef}
          className="absolute top-0 left-0 block cursor-crosshair opacity-80"
        />
        {/* magic overlay: draws magenta strokes and renders each crop as a square image */}
        <canvas
          ref={magicPenCanvasRef}
          className="absolute top-0 left-0 block pointer-events-none"
        />
      </div>
    </main>
  );
}
