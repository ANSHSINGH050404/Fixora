import { Button } from "@/components/ui";
import { ExternalLink } from "lucide-react";

export function ShareButtonShare({
  taskId,
  onShare,
}: {
  taskId: string;
  onShare: (isPublic: boolean) => void;
}) {
  return (
    <Button
      onClick={() => onShare(true)}
      className="rounded-md border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-zinc-950"
    >
      Share publicly
    </Button>
  );
}

export function ShareButtonUnshare({
  taskId,
  shareToken,
}: {
  taskId: string;
  shareToken: string;
}) {
  return (
    <Button
      onClick={() => fetch(`/api/tasks/${taskId}/share`, { method: "DELETE" })}
      className="rounded-md border border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-zinc-950"
    >
      Unshare {shareToken && (
        <ExternalLink size={13} className="ml-1" />
      )}
    </Button>
  );
}