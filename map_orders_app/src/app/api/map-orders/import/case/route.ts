import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { writePersistedState } from "@/processes/map-orders/lib/stateStorage";
import type { DeliveryPoint } from "@/shared/types/points";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const rawPayload = formData.get("payload");
  if (typeof rawPayload !== "string") {
    return NextResponse.json({ error: "payload отсутствует" }, { status: 400 });
  }
  try {
    const payload = JSON.parse(rawPayload);
    const features = payload?.geojson?.features ?? [];
    const points: DeliveryPoint[] = features.map((feature: any, index: number) => ({
      internalId: uuidv4(),
      id: feature.properties?.id ?? `point_${index + 1}`,
      kind: feature.properties?.kind === "depot" ? "depot" : "order",
      seq: index + 1,
      lat: feature.geometry?.coordinates?.[1] ?? 0,
      lon: feature.geometry?.coordinates?.[0] ?? 0,
      boxes: feature.properties?.boxes ?? 0,
      createdAt: feature.properties?.created_at ?? "00:00:00",
      readyAt: feature.properties?.ready_at ?? "00:00:00",
      extraJson: feature.properties?.extra_json ?? "{}",
    }));

    const state = await writePersistedState({
      points,
      mapCenter: payload.map_center ?? [52.9676, 36.0693],
      mapZoom: payload.map_zoom ?? 13,
      couriersText: payload.couriers ?? "",
      weightsText: payload.weights ?? "",
      additionalParamsText: payload.additional_params ?? "",
      osrmBaseUrl: payload.osrm_base_url ?? "http://localhost:5563",
      t0Time: payload.t0_iso ? payload.t0_iso.split("T")[1]?.slice(0, 8) ?? "09:00:00" : "09:00:00",
      solverInput: null,
      solverResult: null,
    });

    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
