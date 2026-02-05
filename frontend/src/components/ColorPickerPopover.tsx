import type { ReactNode } from "react";
import { RgbColorPicker } from "react-colorful";

export type ColorPickerPopoverProps = {
  visible: boolean;
  anchor: { x: number; y: number } | null;
  color: { r: number; g: number; b: number };
  colorCss: string;
  onChange: (color: { r: number; g: number; b: number }) => void;
  onClose: () => void;
  title?: ReactNode;
};

export default function ColorPickerPopover({
  visible,
  anchor,
  color,
  colorCss,
  onChange,
  onClose,
  title = "Mask Color",
}: ColorPickerPopoverProps) {
  if (!visible || !anchor) return null;

  return (
    <div
      className="fixed z-50"
      style={{
        left: anchor.x + 12,
        top: Math.max(8, anchor.y - 8),
      }}
    >
      <div className="bg-white text-neutral-900 rounded-md shadow-2xl border border-neutral-200 overflow-hidden w-64">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <div className="text-sm font-semibold">{title}</div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-100"
            aria-label="Close color picker"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-neutral-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-3">
          <RgbColorPicker color={color} onChange={onChange} />
          <div className="flex items-center justify-between text-xs text-neutral-600">
            <span>RGB</span>
            <span className="font-mono">
              {color.r}, {color.g}, {color.b}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <span>Preview</span>
            <span
              className="h-4 w-4 rounded border border-neutral-300"
              style={{ backgroundColor: colorCss }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
