import { createContext } from "react";

interface CanvasContextType {
  undo: () => void;
  redo: () => void;
  storeState: () => void;
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null> | null;
  imageCanvasRef: React.RefObject<HTMLCanvasElement | null> | null;
  currentImageUrl: string;
  setCurrentImageUrl: (url: string) => void;
}

const defaultContext: CanvasContextType = {
  undo: () => {},
  redo: () => {},
  storeState: () => {},
  maskCanvasRef: null,
  imageCanvasRef: null,
  currentImageUrl: "./datasets/test1/images/1.JPG",
  setCurrentImageUrl: () => {},
};

export const CanvasContext = createContext<CanvasContextType>(defaultContext);
