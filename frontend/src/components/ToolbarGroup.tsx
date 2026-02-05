import React from "react";

export default function ToolbarGroup({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-md p-1.5 flex flex-col items-center shadow-md">
      {children}
    </div>
  );
}
