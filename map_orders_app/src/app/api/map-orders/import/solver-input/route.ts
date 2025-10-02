import { NextResponse } from "next/server";
import { writePersistedState } from "@/processes/map-orders/lib/stateStorage";
import type { SolverInputPayload } from "@/shared/types/solver";
import type { DeliveryPoint } from "@/shared/types/points";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const rawPayload = formData.get("payload");
  if (typeof rawPayload !== "string") {
    return NextResponse.json({ error: "payload отсутствует" }, { status: 400 });
  }
  try {
    const solverInput = JSON.parse(rawPayload) as SolverInputPayload;
    const combined = solverInput.meta?.combinedParams;
    if (!combined) {
      throw new Error("meta.combined_params отсутствует в solver_input");
    }
    const depot = combined.depot as DeliveryPoint;
    const orders = (combined.orders as DeliveryPoint[]) ?? [];
    const points: DeliveryPoint[] = [depot, ...orders].map((point, index) => ({
      ...point,
      seq: index + 1,
    }));

    const state = await writePersistedState({
      points,
      couriersText: JSON.stringify(combined.couriers ?? {}, null, 2),
      weightsText: JSON.stringify(combined.weights ?? {}, null, 2),
      additionalParamsText: JSON.stringify(combined.additional ?? {}, null, 2),
      osrmBaseUrl: solverInput.meta?.osrmBaseUrl ?? "http://localhost:5563",
      t0Time: solverInput.meta?.T0_iso?.split("T")[1]?.slice(0, 8) ?? "09:00:00",
      solverInput,
      solverResult: null,
    });

    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
