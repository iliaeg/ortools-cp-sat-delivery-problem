import { NextResponse } from "next/server";
import { mapSolverResult } from "@/processes/map-orders/lib/solverResultMapper";
import { getServerEnv } from "@/shared/config/env";
import type { SolverInputPayload, SolverResult } from "@/shared/types/solver";

const { solverUrl } = getServerEnv();

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const solverInput = payload.solverInput as SolverInputPayload | undefined;
    if (!solverInput) {
      throw new Error("solverInput не передан");
    }

    const response = await fetch(solverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solverInput),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Solver вернул ${response.status}: ${text}`);
    }

    const result = (await response.json()) as SolverResult;
    const mapped = mapSolverResult({ solverInput, solverResult: result });
    return NextResponse.json(mapped);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
