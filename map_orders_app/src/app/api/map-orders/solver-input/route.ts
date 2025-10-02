import { NextResponse } from "next/server";
import { buildSolverInput } from "@/processes/map-orders/lib/solverInputBuilder";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await buildSolverInput(payload);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
