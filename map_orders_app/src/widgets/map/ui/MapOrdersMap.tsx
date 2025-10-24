
'use client';

import dynamic from "next/dynamic";
import type { MapOrdersMapProps } from "./MapOrdersMap.client";

const MapOrdersMap = dynamic<MapOrdersMapProps>(
  () => import("./MapOrdersMap.client"),
  {
    ssr: false,
    loading: () => null,
  },
);

export default MapOrdersMap;
