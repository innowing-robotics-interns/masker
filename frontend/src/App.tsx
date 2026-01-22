"use client";

import Canvas from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import CanvasProvider from "./contexts/CanvasContext";
import FileManager from "./components/FileManager";
import MagicBrushSettings from "./components/Settings";

import { useState } from "react";
import { Tool } from "./types";

function App() {
  const [showFileManager, setShowFileManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("brush");

  const handleToggleFiles = () => {
    setShowFileManager(!showFileManager);
    setActiveTool("files");
  };

  return (
    <div className="h-screen w-screen overflow-hidden">
      <CanvasProvider>
        <div className="h-full overflow-auto">
          <Canvas
            toggleFiles={handleToggleFiles}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
          />
        </div>
        <div className="fixed ">
          {showFileManager && <FileManager />}
          {/*<MagicBrushSettings
            visible={showSettings}
            onClose={() => setShowSettings(!showSettings)}
          />*/}
        </div>
      </CanvasProvider>
    </div>
  );
}

export default App;
