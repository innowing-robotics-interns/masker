import * as React from "react";

export function UploadIcon({
  size = 24,
  color = "currentColor",
  strokeWidth = 2,
  className,
  icon,
  ...props
}: React.SVGProps<SVGSVGElement> & {
  size?: number;
  color?: string;
  icon?: React.ReactNode;
  strokeWidth?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M12 3v12m5-7l-5-5l-5 5m14 7v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    </svg>
  );
}
