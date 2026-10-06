import { NextResponse } from "next/server";
import {
  PersistenceAuthenticationError,
  PersistenceConfigurationError,
} from "./supabase-server";

export function persistenceErrorResponse(error: unknown): NextResponse {
  console.error("TradeLynk persistence error:", error);
  if (error instanceof PersistenceConfigurationError) {
    return NextResponse.json(
      { error: error.message, code: "PERSISTENCE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  if (error instanceof PersistenceAuthenticationError) {
    return NextResponse.json(
      { error: error.message, code: "AUTHENTICATION_REQUIRED" },
      { status: 401 },
    );
  }
  const message = error instanceof Error ? error.message : "Persistence failed";
  return NextResponse.json({ error: message }, { status: 500 });
}

export function notFound(entity: string): NextResponse {
  return NextResponse.json({ error: `${entity} not found` }, { status: 404 });
}
