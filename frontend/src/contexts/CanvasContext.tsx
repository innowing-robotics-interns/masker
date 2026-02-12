import { useRef, useCallback, useState } from "react";
import { CanvasContext } from "./Contexts";

export default function CanvasProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [past, setPast] = useState<Array<ImageData>>([]);
  const [future, setFuture] = useState<Array<ImageData>>([]);
  const [currentImageUrl, setCurrentImageUrl] = useState<string>("");
  const [canvasVersion, setCanvasVersion] = useState(0);
  const [maskVersion, setMaskVersion] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const maxHistorySize = 20;
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  // History Management

  const storeState = useCallback(() => {
    if (maskCanvasRef.current) {
      const ctx = maskCanvasRef.current.getContext("2d");
      if (ctx) {
        setPast((prevPast) => {
          const newPast = [
            ...prevPast,
            ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height),
          ];
          return newPast.length > maxHistorySize ? newPast.slice(1) : newPast;
        });
        setFuture([]);
      }
    }
  }, [maskCanvasRef, maxHistorySize]);

  const undo = useCallback(() => {
    if (past.length > 0 && maskCanvasRef.current) {
      const ctx = maskCanvasRef.current.getContext("2d");
      if (ctx) {
        const currentState = ctx.getImageData(
          0,
          0,
          maskCanvasRef.current.width,
          maskCanvasRef.current.height,
        );
        setFuture((prevFuture) => [...prevFuture, currentState]);

        const previousState = past[past.length - 1];
        setPast((prevPast) => prevPast.slice(0, -1));

        ctx.putImageData(previousState, 0, 0);
        setMaskVersion((v) => v + 1);
      }
    }
  }, [past, maskCanvasRef, setMaskVersion]);

  const redo = useCallback(() => {
    if (future.length > 0 && maskCanvasRef.current) {
      const ctx = maskCanvasRef.current.getContext("2d");
      if (ctx) {
        const currentState = ctx.getImageData(
          0,
          0,
          maskCanvasRef.current.width,
          maskCanvasRef.current.height,
        );
        setPast((prevPast) => [...prevPast, currentState]);

        const nextState = future[future.length - 1];
        setFuture((prevFuture) => prevFuture.slice(0, -1));

        ctx.putImageData(nextState, 0, 0);
        setMaskVersion((v) => v + 1);
      }
    }
  }, [future, maskCanvasRef, setMaskVersion]);

  return (
    <CanvasContext
      value={{
        undo,
        redo,
        storeState,
        maskCanvasRef,
        imageCanvasRef,
        currentImageUrl,
        setCurrentImageUrl,
        canvasVersion,
        setCanvasVersion,
        zoomLevel,
        setZoomLevel,
        maskVersion,
      }}
    >
      {children}
    </CanvasContext>
  );
}
