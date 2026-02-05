import { type LucideIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

export interface ToolButtonProps {
  icon?: LucideIcon;
  name: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  isActive?: boolean;
  children?: ReactNode;
}

export default function ToolButton({
  icon: Icon,
  name,
  onClick,
  isActive,
  children,
}: ToolButtonProps) {
  return (
    <div className="relative group">
      <button
        className={`w-12 h-12 flex items-center justify-center rounded-md hover:bg-blue-500/20 hover:text-blue-800 ${
          isActive ? "bg-blue-500/20 text-blue-800" : ""
        }`}
        onClick={onClick}
        aria-label={name}
      >
        {children ?? (Icon ? <Icon /> : null)}
      </button>
      <span className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {name}
      </span>
    </div>
  );
}
