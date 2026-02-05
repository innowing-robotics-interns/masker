"use client";

import Canvas from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import CanvasProvider from "./contexts/CanvasContext";
import FileManager from "./components/FileManager";

import { useState, useRef } from "react";
import type { Tool } from "./types";

function App() {
  const [showFileManager, setShowFileManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("brush");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleToggleFiles = () => {
    setShowFileManager(!showFileManager);
    setActiveTool("files");
  };

  return (
    <div className="h-screen w-screen overflow-hidden">
      <CanvasProvider>
        <div ref={scrollContainerRef} className="h-full overflow-auto">
          <Canvas
            toggleFiles={handleToggleFiles}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            scrollContainerRef={scrollContainerRef}
          />
        </div>
        <div className="fixed ">{showFileManager && <FileManager />}</div>
      </CanvasProvider>
    </div>
  );
}

export default App;
