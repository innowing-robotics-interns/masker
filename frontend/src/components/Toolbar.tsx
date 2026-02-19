import ToolButton from "./ToolButton";
import { UploadIcon }from "./icons/lucide-upload";
import {
  Brush,
  FolderSearch,
  Redo,
  StarsIcon,
  Undo,
  ZoomIn,
  ZoomOut,
  FileDown,
  Eraser,
  Save,
  Trash2,
} from "lucide-react";
import { useContext } from "react";
import { CanvasContext } from "../contexts/Contexts";
import ToolbarGroup from "./ToolbarGroup";
import type { Tool } from "../types";

export default function Toolbar({
  toggleFiles,
  switchMode,
  zoomIn,
  zoomOut,
  zoomLevel,
  activeTool,
  setActiveTool,
  onColorPickerClick,
  colorPickerColor = "#ffffff",
  onSaveMask,
  onLoadMask,
  onLoadImage,
  onClearMask,
}: {
  toggleFiles: () => void;
  switchMode: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomLevel: number;
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;
  onColorPickerClick?: (anchor: { x: number; y: number }) => void;
  colorPickerColor?: string;
  onSaveMask?: () => void;
  onLoadMask?: () => void;
  onLoadImage?: () => void;
  onClearMask?: () => void;
}) {
  const { undo, redo } = useContext(CanvasContext);

  return (
    <div className="fixed top-1/2 -translate-y-1/2 left-2 z-50 flex flex-col gap-y-4">
      <ToolbarGroup>
        <ToolButton
          name="Masking Brush"
          icon={Brush}
          onClick={() => setActiveTool("brush")}
          isActive={activeTool === "brush"}
        />
        <ToolButton
          name="Erase Brush"
          icon={Eraser}
          onClick={() => setActiveTool("erase")}
          isActive={activeTool === "erase"}
        />
        <ToolButton
          name="Magic Brush"
          icon={StarsIcon}
          onClick={() => {
            switchMode();
            setActiveTool("magic");
          }}
          isActive={activeTool === "magic"}
        />
        <ToolButton
          name="Open Files"
          icon={FolderSearch}
          onClick={() => {
            toggleFiles();
            setActiveTool("files");
          }}
          isActive={activeTool === "files"}
        />
        <ToolButton
          name="Color Picker"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onColorPickerClick?.({ x: rect.right, y: rect.top });
            setActiveTool("colorPicker");
          }}
          isActive={activeTool === "colorPicker"}
        >
          <span
            className="h-5 w-5 rounded-sm border border-neutral-300"
            style={{ backgroundColor: colorPickerColor }}
          />
        </ToolButton>
        <ToolButton name="Save Mask" icon={Save} onClick={onSaveMask} />
        <ToolButton name="Load Mask" icon={FileDown} onClick={onLoadMask} />
        <ToolButton name="Upload Image" icon={UploadIcon} onClick={onLoadImage} />
        <ToolButton name="Clear Mask" icon={Trash2} onClick={onClearMask} />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolButton name="Undo" icon={Undo} onClick={undo} />
        <ToolButton name="Redo" icon={Redo} onClick={redo} />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolButton name="Zoom In" icon={ZoomIn} onClick={zoomIn} />
        <span className="text-xs w-full text-center">
          {Math.round(zoomLevel * 100)}%
        </span>
        <ToolButton name="Zoom Out" icon={ZoomOut} onClick={zoomOut} />
      </ToolbarGroup>
    </div>
  );
}
