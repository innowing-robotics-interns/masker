import ToolButton from "./ToolButton";
import {
  Brush,
  FolderSearch,
  Redo,
  StarsIcon,
  Undo,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useContext } from "react";
import { CanvasContext } from "../contexts/Contexts";
import ToolbarGroup from "./ToolbarGroup";
import { Tool } from "../types";
// List of tools:
// - Masking brush
// - Magic brush
// - Undo/redo
// - Open/upload image/mask
// - Hide mask
// - Hide UI
// - Undo/Redo
//

export default function Toolbar({
  toggleFiles,
  switchMode,
  zoomIn,
  zoomOut,
  zoomLevel,
  activeTool,
  setActiveTool,
}: {
  toggleFiles: () => void;
  switchMode: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomLevel: number;
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;
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
