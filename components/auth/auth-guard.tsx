"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Ship } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/persistence/supabase-browser";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowser();

    const redirectToLogin = () => {
      if (!active) return;
      setReady(false);
      router.replace("/login");
    };

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session || data.session.user.is_anonymous) {
        if (data.session?.user.is_anonymous) {
          await supabase.auth.signOut({ scope: "local" });
        }
        redirectToLogin();
        return;
      }
      setReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !session.user.is_anonymous) setReady(true);
      else redirectToLogin();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [router]);

  if (!ready) {
    return (
      <main className="flex min-h-svh items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-xl border bg-card/90 px-5 py-4 shadow-sm">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Ship className="size-5" />
          </span>
          <div>
            <p className="font-medium">TradeLynk</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              Checking your session…
            </p>
          </div>
        </div>
      </main>
    );
  }

  return children;
}
