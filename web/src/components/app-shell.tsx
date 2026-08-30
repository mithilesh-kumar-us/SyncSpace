"use client";

import { Waypoints } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth-context";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/80 px-6 py-3.5 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2">
          <span className="brand-mark flex size-7 items-center justify-center rounded-lg text-white shadow-sm">
            <Waypoints className="size-4" strokeWidth={2.25} />
          </span>
          <span className="font-heading text-[1.05rem] font-semibold tracking-tight">
            SyncSpace
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {user && (
            <div className="flex items-center gap-2 rounded-full py-1 pr-1 pl-3">
              <span className="text-sm text-muted-foreground">{user.name}</span>
              <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                {initials(user.name)}
              </span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
