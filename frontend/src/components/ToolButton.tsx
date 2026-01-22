import { type LucideIcon } from "lucide-react";

export interface ToolButtonProps {
  icon: LucideIcon;
  name: string;
  onClick: () => void;
  isActive?: boolean;
}

export default function ToolButton({
  icon: Icon,
  name,
  onClick,
  isActive,
}: ToolButtonProps) {
  return (
    <button
      className={`w-12 h-12 flex items-center justify-center rounded-md hover:bg-blue-500/20 hover:text-blue-800 ${
        isActive ? "bg-blue-500/20 text-blue-800" : ""
      }`}
      onClick={onClick}
      title={name}
    >
      <Icon />
    </button>
  );
}
