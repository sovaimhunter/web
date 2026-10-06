"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileCheck2, LockKeyhole, Ship, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowser } from "@/lib/persistence/supabase-browser";

type AuthMode = "sign-in" | "sign-up";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session && !data.session.user.is_anonymous) {
        router.replace("/");
        return;
      }
      if (data.session?.user.is_anonymous) {
        await supabase.auth.signOut({ scope: "local" });
      }
      if (active) setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [router]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setMessage(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    const supabase = getSupabaseBrowser();

    try {
      if (mode === "sign-in") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        router.replace("/");
        router.refresh();
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) throw signUpError;
      if (data.session) {
        router.replace("/");
        router.refresh();
        return;
      }
      setMessage(
        "Account created. Check your email to confirm it, then sign in here.",
      );
      setMode("sign-in");
      setPassword("");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-svh overflow-hidden">
      <section className="hidden w-[46%] flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-300 ring-1 ring-cyan-200/20">
            <Ship className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">TradeLynk</p>
            <p className="text-xs text-sidebar-foreground/55">
              Export document check
            </p>
          </div>
        </div>

        <div className="max-w-lg space-y-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
            One workspace per account
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Keep every shipment, document, and check history with the right team.
          </h1>
          <div className="grid gap-3 text-sm text-sidebar-foreground/70">
            <p className="flex items-center gap-3">
              <UserRound className="size-4 text-cyan-300" />
              Separate shipment records by signed-in user
            </p>
            <p className="flex items-center gap-3">
              <FileCheck2 className="size-4 text-cyan-300" />
              Return to previous checks from any session
            </p>
            <p className="flex items-center gap-3">
              <LockKeyhole className="size-4 text-cyan-300" />
              Supabase RLS keeps each workspace isolated
            </p>
          </div>
        </div>

        <p className="text-xs text-sidebar-foreground/45">
          TradeLynk identifies document inconsistencies for review.
        </p>
      </section>

      <section className="app-shell flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Ship className="size-6" />
            </span>
            <div>
              <p className="font-semibold">TradeLynk</p>
              <p className="text-xs text-muted-foreground">
                Export document check
              </p>
            </div>
          </div>

          <Card className="relative">
            <CardHeader className="gap-2">
              <CardTitle className="text-xl">
                {mode === "sign-in" ? "Welcome back" : "Create your workspace"}
              </CardTitle>
              <CardDescription>
                {mode === "sign-in"
                  ? "Sign in to manage your shipments and check history."
                  : "Create an account so your shipment records stay with you."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-5 grid grid-cols-2 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  onClick={() => switchMode("sign-in")}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    mode === "sign-in"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("sign-up")}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    mode === "sign-up"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Create account
                </button>
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    disabled={checking || submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 6 characters"
                    disabled={checking || submitting}
                  />
                </div>

                {error && (
                  <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
                {message && (
                  <p role="status" className="rounded-lg bg-green-100 px-3 py-2 text-sm text-green-800">
                    {message}
                  </p>
                )}

                <Button type="submit" size="lg" className="w-full" disabled={checking || submitting}>
                  {checking
                    ? "Checking session…"
                    : submitting
                      ? mode === "sign-in"
                        ? "Signing in…"
                        : "Creating account…"
                      : mode === "sign-in"
                        ? "Sign in"
                        : "Create account"}
                  {!checking && !submitting && <ArrowRight />}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
            Your account ID owns every shipment you create. Other users cannot
            access those records through the application or API.
          </p>
        </div>
      </section>
    </main>
  );
}
