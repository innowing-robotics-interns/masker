export type Tool = "brush" | "erase" | "magic" | "files" | "colorPicker";

export interface Crop {
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
}
