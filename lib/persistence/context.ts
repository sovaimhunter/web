import type { SupabaseClient } from "@supabase/supabase-js";
import type { TradeRepository } from "./repository";
import { getTradeRepository } from "./supabase-repository";
import { requirePersistenceUser } from "./supabase-server";

export type PersistenceContext = {
  db: SupabaseClient;
  userId: string;
  repository: TradeRepository;
};

export async function persistenceContext(
  request: Request,
): Promise<PersistenceContext> {
  const { db, userId } = await requirePersistenceUser(request);
  return { db, userId, repository: getTradeRepository(db) };
}
