import { Waypoints } from "lucide-react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="brand-glow flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <Link href="/login" className="flex items-center gap-2.5">
        <span className="brand-mark flex size-9 items-center justify-center rounded-xl text-white shadow-sm">
          <Waypoints className="size-5" strokeWidth={2.25} />
        </span>
        <span className="font-heading text-xl font-semibold tracking-tight">SyncSpace</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
