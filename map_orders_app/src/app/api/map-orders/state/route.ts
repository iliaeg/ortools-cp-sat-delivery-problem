import { NextResponse } from "next/server";
import { readPersistedState, writePersistedState } from "@/processes/map-orders/lib/stateStorage";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readPersistedState();
  return NextResponse.json(state);
}

export async function PUT(request: Request) {
  const payload = await request.json();
  const state = await writePersistedState(payload);
  return NextResponse.json(state);
}
