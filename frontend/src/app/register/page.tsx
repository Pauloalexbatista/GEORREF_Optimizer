"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    // Public registration is disabled; all accounts are managed by the Master Admin
    router.replace("/login");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-950 text-zinc-300 text-xs font-mono">
      A redirecionar para o login...
    </div>
  );
}
