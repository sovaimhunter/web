"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function allowsAnonymousE2EAuth(): boolean {
  return process.env.NEXT_PUBLIC_E2E_AUTH === "anonymous";
}

export function getSupabaseBrowser(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export async function getAccessToken(): Promise<string> {
  const supabase = getSupabaseBrowser();
  const { data: sessionData } = await supabase.auth.getSession();
  if (
    sessionData.session?.access_token &&
    (!sessionData.session.user.is_anonymous || allowsAnonymousE2EAuth())
  ) {
    return sessionData.session.access_token;
  }
  throw new Error("Your session has ended. Please sign in again.");
}
