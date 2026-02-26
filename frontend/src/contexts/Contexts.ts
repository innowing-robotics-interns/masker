import { createContext } from "react";

interface CanvasContextType {
  undo: () => void;
  redo: () => void;
  storeState: () => void;
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null> | null;
  imageCanvasRef: React.RefObject<HTMLCanvasElement | null> | null;
  currentImageUrl: string;
  setCurrentImageUrl: (url: string) => void;
  canvasVersion: number;
  setCanvasVersion: (version: number) => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  maskVersion: number;
  onMaskChange: (() => void) | null;
  setOnMaskChange: (callback: () => void) => void;
}

const defaultContext: CanvasContextType = {
  undo: () => {},
  redo: () => {},
  storeState: () => {},
  maskCanvasRef: null,
  imageCanvasRef: null,
  currentImageUrl: "./datasets/test1/images/1.JPG",
  setCurrentImageUrl: () => {},
  canvasVersion: 0,
  setCanvasVersion: () => {},
  zoomLevel: 1,
  setZoomLevel: () => {},
  maskVersion: 0,
  onMaskChange: null,
  setOnMaskChange: () => {},
};

export const CanvasContext = createContext<CanvasContextType>(defaultContext);
