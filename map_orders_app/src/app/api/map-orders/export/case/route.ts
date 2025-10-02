import { NextResponse } from "next/server";
import { readPersistedState } from "@/processes/map-orders/lib/stateStorage";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readPersistedState();
  const payload = {
    t0_iso: state.lastSavedAtIso ?? new Date().toISOString(),
    map_center: state.mapCenter,
    map_zoom: state.mapZoom,
    geojson: {
      type: "FeatureCollection",
      features: state.points.map((point) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        properties: {
          id: point.id,
          kind: point.kind,
          seq: point.seq,
          boxes: point.boxes,
          created_at: point.createdAt,
          ready_at: point.readyAt,
          extra_json: point.extraJson,
        },
      })),
    },
    couriers: state.couriersText,
    weights: state.weightsText,
    additional_params: state.additionalParamsText,
    osrm_base_url: state.osrmBaseUrl,
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="map-orders-case-${Date.now()}.json"`,
    },
  });
}
