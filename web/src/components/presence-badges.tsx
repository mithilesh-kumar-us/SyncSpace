import type { PresenceUser } from "@/realtime/use-yjs-document";

export function PresenceBadges({ presence }: { presence: PresenceUser[] }) {
  if (presence.length === 0) return null;

  return (
    <span className="flex gap-1.5">
      {presence.map((p) => (
        <span
          key={p.clientId}
          title={p.name}
          className="rounded px-1.5 py-0.5 text-xs text-white"
          style={{ background: p.color }}
        >
          {p.name}
        </span>
      ))}
    </span>
  );
}
