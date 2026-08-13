import { NextResponse } from "next/server";
import { compareDocuments } from "@/lib/compare";
import { extractAll } from "@/lib/extract";
import {
  DOC_KEYS,
  DOC_NAMES,
  MAX_UPLOAD_TOTAL_BYTES,
  type DocKey,
} from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Could not read the uploaded files." },
      { status: 400 },
    );
  }

  const files: Partial<Record<DocKey, File>> = {};
  const missing: string[] = [];

  for (const key of DOC_KEYS) {
    const value = formData.get(key);
    if (!(value instanceof File)) {
      missing.push(DOC_NAMES[key]);
      continue;
    }
    const isPdf =
      value.type === "application/pdf" ||
      value.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json(
        { error: `${DOC_NAMES[key]} must be a PDF file.` },
        { status: 400 },
      );
    }
    if (value.size === 0) {
      return NextResponse.json(
        { error: `${DOC_NAMES[key]} is empty.` },
        { status: 400 },
      );
    }
    files[key] = value;
  }

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing PDFs: ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  // Backstop for local dev — on Vercel a body this large is rejected with a
  // 413 before this handler is ever invoked.
  const totalBytes = DOC_KEYS.reduce((sum, key) => sum + files[key]!.size, 0);
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "The three PDFs together exceed the 4 MB upload limit." },
      { status: 413 },
    );
  }

  try {
    const documents = await extractAll(files as Record<DocKey, File>);
    const fileNames = Object.fromEntries(
      DOC_KEYS.map((key) => [key, files[key]!.name]),
    ) as Record<DocKey, string>;
    return NextResponse.json({
      ...compareDocuments(documents),
      files: fileNames,
    });
  } catch (error) {
    console.error("TradeLynk check failed:", error);
    const message =
      error instanceof Error ? error.message : "The consistency check failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
