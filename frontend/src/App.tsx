"use client";

import Canvas from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import CanvasProvider from "./contexts/CanvasContext";
import FileManager from "./components/FileManager";
import MagicBrushSettings from "./components/Settings";

import { useState } from "react";

function App() {
  const [showFileManager, setShowFileManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="h-screen w-screen overflow-hidden">
      <CanvasProvider>
        <div className="h-full overflow-auto">
          <Canvas />
        </div>
        <div className="fixed ">
          {showFileManager && <FileManager />}
          <Toolbar toggleFiles={() => setShowFileManager(!showFileManager)} />
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
