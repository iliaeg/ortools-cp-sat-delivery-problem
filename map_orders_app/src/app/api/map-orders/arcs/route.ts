import { NextResponse } from "next/server";
import { getServerEnv } from "@/shared/config/env";
import type { SolverInputPayload } from "@/shared/types/solver";

const { solverArcsUrl } = getServerEnv();

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const solverInput = payload.solverInput as SolverInputPayload | undefined;
    if (!solverInput) {
      throw new Error("solverInput не передан");
    }

    const response = await fetch(solverArcsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solverInput.request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Arcs API вернул ${response.status}: ${text}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
