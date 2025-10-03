import { NextResponse } from "next/server";
import { readPersistedState } from "@/processes/map-orders/lib/stateStorage";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readPersistedState();
  const features = state.points.map((point) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [point.lon, point.lat],
    },
    properties: {
      id: point.id,
      kind: point.kind,
      seq: point.seq,
      boxes: point.boxes,
      created_at: point.createdAt,
      ready_at: point.readyAt,
    },
  }));
  const featureCollection = {
    type: "FeatureCollection",
    features,
  };
  return new NextResponse(JSON.stringify(featureCollection, null, 2), {
    headers: {
      "Content-Type": "application/geo+json",
      "Content-Disposition": `attachment; filename="map-orders-${Date.now()}.geojson"`,
    },
  });
}
