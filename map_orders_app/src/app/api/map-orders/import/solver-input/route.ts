import { NextResponse } from "next/server";
import { writePersistedState } from "@/processes/map-orders/lib/stateStorage";
import type { SolverInputPayload } from "@/shared/types/solver";
import type { DeliveryPoint } from "@/shared/types/points";
import {
  DEFAULT_ADDITIONAL_PARAMS_TEXT,
  DEFAULT_COURIERS_TEXT,
  DEFAULT_WEIGHTS_TEXT,
  ensureDefaultText,
} from "@/shared/constants/defaults";
import { stringifyWithInlineArrays } from "@/shared/lib/json";

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
      couriersText: ensureDefaultText(
        stringifyWithInlineArrays(combined.couriers ?? {}),
        DEFAULT_COURIERS_TEXT,
      ),
      weightsText: ensureDefaultText(
        stringifyWithInlineArrays(combined.weights ?? {}),
        DEFAULT_WEIGHTS_TEXT,
      ),
      additionalParamsText: ensureDefaultText(
        stringifyWithInlineArrays(combined.additional ?? {}),
        DEFAULT_ADDITIONAL_PARAMS_TEXT,
      ),
      osrmBaseUrl: solverInput.meta?.osrmBaseUrl ?? "http://localhost:5563",
      t0Time: solverInput.meta?.T0_iso?.split("T")[1]?.slice(0, 8) ?? "09:00:00",
      manualTauText: stringifyWithInlineArrays(solverInput.tau ?? []),
      useManualTau: true,
      solverInput,
      solverResult: null,
      isFromCpSatLog: false,
    });

    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
