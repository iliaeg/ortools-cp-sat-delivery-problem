"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  FeatureGroup,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { EditControl, type EditControlProps } from "react-leaflet-draw";
import L, { LeafletEvent } from "leaflet";
import { v4 as uuidv4 } from "uuid";
import { Box, Checkbox, FormControlLabel, Stack, Switch } from "@mui/material";
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
import { ensureDefaultMarkerIcons, createNumberedPinIcon, createRouteArrowIcon } from "@/shared/lib/leaflet";
import type { RoutesSegmentDto } from "@/shared/types/solver";
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
  const [isEditingEnabled, setEditingEnabled] = useState(false);
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
            draggable={isEditingEnabled}
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
    [points, handleMarkerDragEnd, isEditingEnabled],
  );

  const polylines = useMemo(
    () =>
      showSolverRoutes
        ? routeSegments.map((segment) => (
            <RouteSegment
              key={`${segment.groupId}`}
              segment={segment}
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
            {isEditingEnabled ? (
              <EditControl
                position="topright"
                onCreated={handleCreated}
                onEdited={handleEdited}
                onDeleted={handleDeleted}
                draw={DRAW_OPTIONS}
                edit={EDIT_OPTIONS}
              />
            ) : null}
            {markers}
            {polylines}
          </FeatureGroup>
        </MapContainer>
      </Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap">
        <FormControlLabel
          control={<Checkbox checked={showSolverRoutes} onChange={toggleRoutes} />}
          label="Показать маршруты решателя"
        />
        <FormControlLabel
          control={
            <Switch
              checked={isEditingEnabled}
              onChange={(_event, checked) => setEditingEnabled(checked)}
              color="primary"
            />
          }
          label="Режим редактирования точек"
        />
      </Stack>
    </Stack>
  );
};

export default memo(MapOrdersMapClient);

interface RouteSegmentProps {
  segment: RoutesSegmentDto;
}

const RouteSegmentComponent = ({ segment }: RouteSegmentProps) => {
  const map = useMap();
  const [, forceUpdate] = useState(0);

  useMapEvents({
    zoom: () => forceUpdate((value) => value + 1),
    move: () => forceUpdate((value) => value + 1),
  });

  const color = segment.color ?? getRouteColor(segment.groupId);

  const arrowMarkers = segment.segments.map((item, index) => {
    const fromLatLng = L.latLng(item.from[0], item.from[1]);
    const toLatLng = L.latLng(item.to[0], item.to[1]);

    const fromPoint = map.latLngToLayerPoint(fromLatLng);
    const toPoint = map.latLngToLayerPoint(toLatLng);
    const angle = Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x) * (180 / Math.PI);
    const midLat = (item.from[0] + item.to[0]) / 2;
    const midLon = (item.from[1] + item.to[1]) / 2;

    return (
      <Marker
        key={`${segment.groupId}-arrow-${index}`}
        position={[midLat, midLon]}
        icon={createRouteArrowIcon(angle, color)}
        interactive={false}
      />
    );
  });

  return (
    <>
      <Polyline
        pathOptions={{ color, weight: 4 }}
        positions={segment.polyline.map(([lat, lon]) => [lat, lon])}
        ref={(instance) => {
          if (instance) {
            instance.bindTooltip(segment.tooltip, { sticky: true });
          }
        }}
      />
      {arrowMarkers}
    </>
  );
};

const RouteSegment = memo(RouteSegmentComponent);
