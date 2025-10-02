"use client";

import { memo, useCallback, useEffect, useMemo, useRef, type ChangeEvent } from "react";
import { MapContainer, TileLayer, Marker, Polyline, FeatureGroup, Tooltip } from "react-leaflet";
import { EditControl, type EditControlProps } from "react-leaflet-draw";
import L, { LeafletEvent } from "leaflet";
import { v4 as uuidv4 } from "uuid";
import { Box, Checkbox, FormControlLabel, Stack, Typography } from "@mui/material";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import {
  addPoint,
  removePoint,
  setMapView,
  setShowSolverRoutes,
  updatePoint,
} from "@/features/map-orders/model/mapOrdersSlice";
import {
  selectMapView,
  selectPoints,
  selectRouteSegments,
  selectShowSolverRoutes,
} from "@/features/map-orders/model/selectors";
import { ensureDefaultMarkerIcons, createNumberedPinIcon } from "@/shared/lib/leaflet";
import type { DeliveryPoint } from "@/shared/types/points";
import { getRouteColor } from "@/shared/constants/routes";

const TILE_LAYER = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const DRAW_OPTIONS = {
  rectangle: false,
  polygon: false,
  circle: false,
  polyline: false,
  circlemarker: false,
  marker: true,
} as unknown as EditControlProps["draw"];

const EDIT_OPTIONS = {
  edit: true,
  remove: true,
} as unknown as EditControlProps["edit"];

const labelForPoint = (point: DeliveryPoint) =>
  `${point.kind === "depot" ? "Депо" : "Заказ"} ${point.id || point.internalId.slice(0, 6)}`;

type MarkerWithInternalId = L.Marker & { options: L.MarkerOptions & { internalId?: string } };

const MapOrdersMapClient = () => {
  const dispatch = useAppDispatch();
  const points = useAppSelector(selectPoints);
  const { center, zoom } = useAppSelector(selectMapView);
  const showSolverRoutes = useAppSelector(selectShowSolverRoutes);
  const routeSegments = useAppSelector(selectRouteSegments);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    ensureDefaultMarkerIcons();
  }, []);

  const handleMapMove = useCallback(
    (event: LeafletEvent) => {
      const target = event.target as L.Map;
      const mapCenter = target.getCenter();
      dispatch(
        setMapView({
          center: [mapCenter.lat, mapCenter.lng],
          zoom: target.getZoom(),
        }),
      );
    },
    [dispatch],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    map.on("moveend", handleMapMove);
    map.on("zoomend", handleMapMove);
    return () => {
      map.off("moveend", handleMapMove);
      map.off("zoomend", handleMapMove);
    };
  }, [handleMapMove]);

  const handleMarkerDragEnd = useCallback(
    (internalId: string) => (event: LeafletEvent) => {
      const target = event.target as MarkerWithInternalId;
      const { lat, lng } = target.getLatLng();
      dispatch(
        updatePoint({
          internalId,
          patch: {
            lat,
            lon: lng,
          },
        }),
      );
    },
    [dispatch],
  );

  const handleCreated = useCallback(
    (event: L.DrawEvents.Created) => {
      const layer = event.layer as MarkerWithInternalId;
      const { lat, lng } = layer.getLatLng();
      const internalId = uuidv4();
      layer.options.internalId = internalId;
      dispatch(
        addPoint({
          internalId,
          lat,
          lon: lng,
        }),
      );
      layer.remove();
    },
    [dispatch],
  );

  const handleEdited = useCallback(
    (event: L.DrawEvents.Edited) => {
      event.layers.eachLayer((layer: L.Layer) => {
        const marker = layer as MarkerWithInternalId;
        const internalId = marker.options.internalId;
        if (!internalId) {
          return;
        }
        const { lat, lng } = marker.getLatLng();
        dispatch(
          updatePoint({
            internalId,
            patch: { lat, lon: lng },
          }),
        );
      });
    },
    [dispatch],
  );

  const handleDeleted = useCallback(
    (event: L.DrawEvents.Deleted) => {
      event.layers.eachLayer((layer: L.Layer) => {
        const marker = layer as MarkerWithInternalId;
        if (marker.options.internalId) {
          dispatch(removePoint(marker.options.internalId));
        }
      });
    },
    [dispatch],
  );

  const markers = useMemo(
    () =>
      points.map((point) => (
        <Marker
          key={point.internalId}
          position={[point.lat, point.lon]}
          draggable
          eventHandlers={{
            dragend: handleMarkerDragEnd(point.internalId),
          }}
          icon={createNumberedPinIcon(point.seq, point.kind)}
          ref={(instance) => {
            if (instance) {
              (instance as MarkerWithInternalId).options.internalId = point.internalId;
            }
          }}
        >
          <Tooltip direction="top" offset={[0, -32]}>
            <div style={{ minWidth: 160 }}>
              <strong>
                {labelForPoint(point)}
              </strong>
              <br />
              {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
              <br />
              Коробки: {point.boxes}
              <br />
              Создан: {point.createdAt}
              <br />
              Готов: {point.readyAt}
            </div>
          </Tooltip>
        </Marker>
      )),
    [points, handleMarkerDragEnd],
  );

  const polylines = useMemo(
    () =>
      showSolverRoutes
        ? routeSegments.map((segment) => (
            <Polyline
              key={`${segment.groupId}`}
              pathOptions={{ color: segment.color ?? getRouteColor(segment.groupId), weight: 4 }}
              positions={segment.polyline.map(([lat, lon]) => [lat, lon])}
              ref={(instance) => {
                if (instance) {
                  instance.bindTooltip(segment.tooltip, { sticky: true });
                }
              }}
            />
          ))
        : null,
    [routeSegments, showSolverRoutes],
  );

  const toggleRoutes = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      dispatch(setShowSolverRoutes(checked));
    },
    [dispatch],
  );

  return (
    <Stack spacing={1.5} sx={{ height: "100%" }}>
      <Box sx={{ height: 480, width: "100%", borderRadius: 2, overflow: "hidden", boxShadow: 2 }}>
        <MapContainer
          ref={mapRef}
          center={center}
          zoom={zoom}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={TILE_LAYER} attribution="&copy; OpenStreetMap" />
          <FeatureGroup>
            <EditControl
              position="topright"
              onCreated={handleCreated}
              onEdited={handleEdited}
              onDeleted={handleDeleted}
              draw={DRAW_OPTIONS}
              edit={EDIT_OPTIONS}
            />
            {markers}
            {polylines}
          </FeatureGroup>
        </MapContainer>
      </Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle1" fontWeight={600}>
          Слой «Маршруты решателя»
        </Typography>
        <FormControlLabel
          control={<Checkbox checked={showSolverRoutes} onChange={toggleRoutes} />}
          label="Показать"
        />
      </Stack>
    </Stack>
  );
};

export default memo(MapOrdersMapClient);
