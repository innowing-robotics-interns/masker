export type Tool =
  | "brush"
  | "erase"
  | "magic"
  | "files"
  | "colorPicker"
  | "measure"
  | "sam";

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
