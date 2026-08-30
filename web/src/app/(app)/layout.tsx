"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/context/auth-context";

// Client-side route protection, same shape as the old Vite app's
// ProtectedRoute.tsx — Next.js edge middleware can't read localStorage, so
// auth (JWT-in-localStorage) has to be checked here, not at the edge.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Avoid flashing protected content before the redirect above commits.
  if (!user) return null;

  return <AppShell>{children}</AppShell>;
}
