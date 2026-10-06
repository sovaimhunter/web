import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class PersistenceConfigurationError extends Error {
  constructor() {
    super(
      "Supabase persistence is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "PersistenceConfigurationError";
  }
}

export function isPersistenceConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export class PersistenceAuthenticationError extends Error {
  constructor() {
    super("A Supabase user session is required.");
    this.name = "PersistenceAuthenticationError";
  }
}

export function getSupabaseForRequest(request: Request): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new PersistenceConfigurationError();
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new PersistenceAuthenticationError();
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}

export async function requirePersistenceUser(
  request: Request,
): Promise<{ db: SupabaseClient; userId: string }> {
  const db = getSupabaseForRequest(request);
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new PersistenceAuthenticationError();
  return { db, userId: data.user.id };
}
