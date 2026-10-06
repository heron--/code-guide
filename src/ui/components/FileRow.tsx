import { Braces, FileCode2, FileText, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChangeCount } from "./FileCard";

export function splitPath(path: string) {
  const i = path.lastIndexOf("/");
  return { name: path.slice(i + 1), dir: i < 0 ? "" : path.slice(0, i) };
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const Icon = ["md", "txt", "rst"].includes(ext)
    ? FileText
    : ["json", "yaml", "yml", "toml"].includes(ext)
      ? Braces
      : ["bazel", "bzl", "lock", "cfg", "ini", "env"].includes(ext) || !path.includes(".")
        ? Settings2
        : FileCode2;
  return <Icon className={cn("size-4 shrink-0 text-muted-foreground", className)} />;
}

export function FileRow({
  path,
  additions,
  deletions,
  status,
  reviewed,
  onClick,
}: {
  path: string;
  additions: number;
  deletions: number;
  status?: string;
  reviewed?: boolean;
  onClick: () => void;
}) {
  const { name, dir } = splitPath(path);
  return (
    <button
      onClick={onClick}
      title={path}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border border-transparent bg-card px-3 py-2.5 text-left shadow-xs transition-colors hover:border-border",
        reviewed && "opacity-55",
      )}
    >
      <FileIcon path={path} />
      <span
        className={cn(
          "shrink-0 text-sm font-medium",
          status === "added" && "text-add",
          status === "deleted" && "text-del line-through",
        )}
      >
        {name}
      </span>
      <span className="min-w-0 truncate text-[13px] text-muted-foreground">{dir}</span>
      <span className="ml-auto pl-2">
        <ChangeCount file={{ additions, deletions }} />
      </span>
    </button>
  );
}
