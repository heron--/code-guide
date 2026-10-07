/** A 16×16 stroked icon from the design's path data. */
export function Icon({ paths, size = 16, className }: { paths: string[]; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="square"
      aria-hidden="true"
      className={className}
      style={{ flex: "none", display: "block" }}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export const icons = {
  plus: ["M8 3v10M3 8h10"],
  maximize: ["M3 3h10v10H3z", "M3 5.5h10"],
  close: ["M4 4l8 8M12 4l-8 8"],
  branch: ["M5 3v10", "M11 3v3a3 3 0 0 1-3 3H5"],
  retry: ["M3 8a5 5 0 1 0 1.5-3.5", "M3 3v2.5h2.5"],
};
