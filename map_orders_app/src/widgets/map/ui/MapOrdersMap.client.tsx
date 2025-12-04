"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  FeatureGroup,
  Tooltip,
  Polyline,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { EditControl, type EditControlProps } from "react-leaflet-draw";
import L, { LeafletEvent, LeafletMouseEvent } from "leaflet";
import { v4 as uuidv4 } from "uuid";
import "leaflet-simple-map-screenshoter";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Paper,
  Slider,
  Stack,
  Switch,
  Tooltip as MuiTooltip,
  Typography,
} from "@mui/material";
import { saveAs } from "file-saver";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import {
  addPoint,
  removePoint,
  setMapView,
  setShowDepotSegments,
  setShowDepartingNowRoutes,
  setDepartingWindowMinutes,
  setShowReadyNowOrders,
  setShowRoutePositions,
  setShowSolverRoutes,
  updatePoint,
  setViewportLocked,
} from "@/features/map-orders/model/mapOrdersSlice";
import {
  selectMapView,
  selectPoints,
  selectRouteSegments,
  selectShowDepotSegments,
  selectShowDepartingNowRoutes,
  selectDepartingWindowMinutes,
  selectShowReadyNowOrders,
  selectShowRoutePositions,
  selectShowSolverRoutes,
  selectSolverInput,
  selectSolverResult,
  selectAllowedArcsByKey,
  selectViewportLocked,
  selectControlTexts,
} from "@/features/map-orders/model/selectors";
import {
  ensureDefaultMarkerIcons,
  createNumberedPinIcon,
  createRouteArrowIcon,
} from "@/shared/lib/leaflet";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import StraightenIcon from "@mui/icons-material/Straighten";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import type { RoutesSegmentDto } from "@/shared/types/solver";
import type { DeliveryPoint } from "@/shared/types/points";
import { getRouteColor } from "@/shared/constants/routes";

const LIGHT_TILE_LAYER = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DARK_TILE_LAYER = "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png";
const DARK_LABELS_TILE_LAYER = "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png";

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

const labelForPoint = (point: DeliveryPoint) => {
  if (point.kind === "depot") {
    return "Депо";
  }
  const numberLabel =
    point.orderNumber !== undefined && point.orderNumber !== null
      ? String(point.orderNumber)
      : point.id || point.internalId.slice(0, 6);
  return `Заказ ${numberLabel}`;
};

type MarkerWithInternalId = L.Marker & { options: L.MarkerOptions & { internalId?: string } };

type MeasureSelection = {
  from: DeliveryPoint;
  to?: DeliveryPoint | null;
  durationMin?: number | null;
};

type MarkerClusterInfo = {
  center: [number, number];
  internalIds: string[];
};

type ClusterGeometry = {
  markerPositionsById: Map<string, [number, number]>;
  clusters: MarkerClusterInfo[];
};

const computeClusterGeometry = (points: DeliveryPoint[]): ClusterGeometry => {
  const markerPositionsById = new Map<string, [number, number]>();
  const clusters: MarkerClusterInfo[] = [];

  const groups = new Map<string, DeliveryPoint[]>();
  points.forEach((point) => {
    const key = `${point.lat.toFixed(6)}:${point.lon.toFixed(6)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(point);
    } else {
      groups.set(key, [point]);
    }
  });

  const radiusMeters = 40;

  groups.forEach((groupPoints) => {
    if (groupPoints.length <= 1) {
      const point = groupPoints[0];
      markerPositionsById.set(point.internalId, [point.lat, point.lon]);
      return;
    }

    const sortedGroup = [...groupPoints].sort((a, b) => {
      const aKey = a.orderNumber ?? a.id ?? a.internalId;
      const bKey = b.orderNumber ?? b.id ?? b.internalId;
      return String(aKey).localeCompare(String(bKey));
    });

    const base = sortedGroup[0];
    const baseLat = base.lat;
    const baseLon = base.lon;
    clusters.push({
      center: [baseLat, baseLon],
      internalIds: sortedGroup.map((point) => point.internalId),
    });

    const groupSize = sortedGroup.length;
    const angles: number[] = [];
    if (groupSize === 2) {
      angles.push(Math.PI, 0);
    } else if (groupSize === 3) {
      angles.push(Math.PI, 0, -Math.PI / 2);
    } else {
      const angleStart = -Math.PI / 2;
      const angleStep = (2 * Math.PI) / groupSize;
      for (let index = 0; index < groupSize; index += 1) {
        angles.push(angleStart + index * angleStep);
      }
    }

    const baseLatRad = (baseLat * Math.PI) / 180;
    const metersPerDegLat = 111_111;
    const metersPerDegLon = Math.max(Math.cos(baseLatRad) * metersPerDegLat, 1e-6);

    sortedGroup.forEach((point, index) => {
      const angle = angles[index] ?? angles[angles.length - 1];
      const deltaLat = (radiusMeters * Math.sin(angle)) / metersPerDegLat;
      const deltaLon = (radiusMeters * Math.cos(angle)) / metersPerDegLon;
      const markerLat = baseLat + deltaLat;
      const markerLon = baseLon + deltaLon;
      markerPositionsById.set(point.internalId, [markerLat, markerLon]);
    });
  });

  return { markerPositionsById, clusters };
};

const getArcKeyForPoint = (point?: DeliveryPoint | null): string | null => {
  if (!point) {
    return null;
  }
  if (point.kind === "depot") {
    return "depot";
  }
  const trimmed = point.id?.trim();
  if (trimmed && trimmed.length) {
    return trimmed;
  }
  return point.internalId;
};

export interface MapOrdersMapProps {
  statusLabel?: string;
  metrics?: Array<{ label: string; value: string }>;
  currentTime?: string;
  onImportLogClick?: () => void;
  importLogDisabled?: boolean;
  importLogLoading?: boolean;
  onHistoryBack?: () => void;
  onHistoryForward?: () => void;
  canHistoryBack?: boolean;
  canHistoryForward?: boolean;
}

const MapOrdersMapClient = ({
  statusLabel,
  metrics,
  currentTime,
  onImportLogClick,
  importLogDisabled,
  importLogLoading,
  onHistoryBack,
  onHistoryForward,
  canHistoryBack,
  canHistoryForward,
}: MapOrdersMapProps) => {
  const dispatch = useAppDispatch();
  const points = useAppSelector(selectPoints);
  const { center, zoom } = useAppSelector(selectMapView);
  const showSolverRoutes = useAppSelector(selectShowSolverRoutes);
  const showDepotSegments = useAppSelector(selectShowDepotSegments);
  const showRoutePositions = useAppSelector(selectShowRoutePositions);
  const showDepartingNowRoutes = useAppSelector(selectShowDepartingNowRoutes);
  const departingWindowMinutes = useAppSelector(selectDepartingWindowMinutes);
  const showReadyNowOrders = useAppSelector(selectShowReadyNowOrders);
  const solverInput = useAppSelector(selectSolverInput);
  const solverResult = useAppSelector(selectSolverResult);
  const viewportLocked = useAppSelector(selectViewportLocked);
  const routeSegments = useAppSelector(selectRouteSegments);
  const allowedArcsByKey = useAppSelector(selectAllowedArcsByKey);
  const { manualTauText, useManualTau } = useAppSelector(selectControlTexts);
  const clusterGeometry = useMemo(() => computeClusterGeometry(points), [points]);
  const { markerPositionsById, clusters: markerClusters } = clusterGeometry;
  const solverBaseIso =
    solverInput?.request?.inputs?.[0]?.data?.current_timestamp_utc
    ?? solverInput?.meta?.T0_iso
    ?? solverResult?.domainResponse?.current_timestamp_utc
    ?? solverResult?.result?.meta?.current_timestamp_utc
    ?? null;

  const [measureModeEnabled, setMeasureModeEnabled] = useState(false);
  const [measureSelection, setMeasureSelection] = useState<MeasureSelection | null>(null);
  const [isDarkMapEnabled, setDarkMapEnabled] = useState(false);
  const baseTimestamp = useMemo(() => {
    if (!solverBaseIso) {
      return null;
    }
    const parsed = Date.parse(solverBaseIso);
    return Number.isNaN(parsed) ? null : parsed;
  }, [solverBaseIso]);

  const filteredRouteSegments = useMemo(() => {
    if (!showSolverRoutes) {
      return [];
    }
    if (!showDepartingNowRoutes) {
      return routeSegments;
    }
    const windowMinutes = Math.max(0, departingWindowMinutes);
    const relWindowMin = windowMinutes > 0 ? windowMinutes : 0.25;
    const absWindowMs = windowMinutes > 0 ? windowMinutes * 60_000 : 15_000;
    return routeSegments.filter((segment) => {
      const rel = segment.plannedDepartureRelMin;
      if (typeof rel === "number" && Number.isFinite(rel)) {
        return Math.abs(rel) <= relWindowMin;
      }
      if (!segment.plannedDepartureIso || !baseTimestamp) {
        return false;
      }
      const departureTime = Date.parse(segment.plannedDepartureIso);
      if (Number.isNaN(departureTime)) {
        return false;
      }
      return Math.abs(departureTime - baseTimestamp) <= absWindowMs;
    });
  }, [
    routeSegments,
    showDepartingNowRoutes,
    showSolverRoutes,
    baseTimestamp,
    departingWindowMinutes,
  ]);
  const readyNowOrderIds = useMemo(() => {
    if (!showReadyNowOrders || !baseTimestamp) {
      return new Set<string>();
    }
    const windowMs = 15_000;
    const result = new Set<string>();
    points.forEach((point) => {
      if (point.kind !== "order") {
        return;
      }
      if (!point.readyAt || !/^\d{2}:\d{2}:\d{2}$/.test(point.readyAt)) {
        return;
      }
      const [hh, mm, ss] = point.readyAt.split(":").map((value) => Number.parseInt(value, 10) || 0);
      const aligned = new Date(baseTimestamp);
      aligned.setUTCHours(hh, mm, ss, 0);
      const readyTimestamp = aligned.getTime();
      if (Number.isNaN(readyTimestamp)) {
        return;
      }
      if (Math.abs(readyTimestamp - baseTimestamp) <= windowMs) {
        result.add(point.internalId);
      }
    });
    return result;
  }, [showReadyNowOrders, baseTimestamp, points]);

  const parsedManualTau = useMemo(() => {
    const text = manualTauText?.trim();
    if (!text) {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        return null;
      }
      const matrix = parsed as unknown[];
      if (matrix.length !== points.length) {
        return null;
      }
      const numericMatrix: number[][] = [];
      for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
        const row = matrix[rowIndex];
        if (!Array.isArray(row) || row.length !== points.length) {
          return null;
        }
        const numericRow: number[] = [];
        for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
          const value = row[colIndex];
          if (typeof value !== "number" || !Number.isFinite(value)) {
            return null;
          }
          numericRow.push(value);
        }
        numericMatrix.push(numericRow);
      }
      return numericMatrix;
    } catch {
      return null;
    }
  }, [manualTauText, points]);

  const pointIndexByInternalId = useMemo(() => {
    const ids = solverInput?.meta?.pointInternalIds;
    if (!ids || !Array.isArray(ids)) {
      return null;
    }
    const map = new Map<string, number>();
    ids.forEach((id, index) => {
      if (id) {
        map.set(id, index);
      }
    });
    return map;
  }, [solverInput?.meta?.pointInternalIds]);

  const getTravelTimeBetweenPoints = useCallback(
    (fromId: string, toId: string): number | undefined => {
      if (!parsedManualTau) {
        return undefined;
      }
      const fromIndex = points.findIndex((point) => point.internalId === fromId);
      const toIndex = points.findIndex((point) => point.internalId === toId);
      if (
        fromIndex >= 0
        && toIndex >= 0
        && fromIndex < parsedManualTau.length
        && toIndex < parsedManualTau.length
      ) {
        const value = parsedManualTau[fromIndex]?.[toIndex];
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
      }
      return undefined;
    },
    [parsedManualTau, points],
  );

  const [isEditingEnabled, setEditingEnabled] = useState(false);
  const [isFullScreen, setFullScreen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const screenshoterRef = useRef<any>(null);
  const historyBackEnabled = Boolean(canHistoryBack);
  const historyForwardEnabled = Boolean(canHistoryForward);
  const arrivalMetric =
    metrics?.find((item) => item.label === "Прибытие курьеров") ?? null;

  useEffect(() => {
    ensureDefaultMarkerIcons();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 0);
    }

    const previousOverflow = document.body.style.overflow;
    if (isFullScreen) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullScreen]);

  useEffect(() => {
    const mapInstance = mapRef.current;
    if (!mapInstance || !(L as any).simpleMapScreenshoter) {
      return;
    }

    if (!screenshoterRef.current) {
      const screenshoter = (L as any)
        .simpleMapScreenshoter({
          mimeType: "image/png",
          quality: 1,
          position: "topright",
        })
        .addTo(mapInstance);

      const controlContainer = (screenshoter as any)?._container as HTMLElement | undefined;
      if (controlContainer) {
        controlContainer.style.display = "none";
      }

      screenshoterRef.current = screenshoter;
    }

    return () => {
      const current = screenshoterRef.current;
      if (current && typeof mapInstance.removeControl === "function") {
        mapInstance.removeControl(current);
      }
      screenshoterRef.current = null;
    };
  }, [mapReady]);

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

  const isArcAllowed = useCallback(
    (fromPoint?: DeliveryPoint | null, toPoint?: DeliveryPoint | null): boolean | null => {
      if (!allowedArcsByKey) {
        return null;
      }
      if (fromPoint && toPoint) {
        const isDepotToOrder =
          (fromPoint.kind === "depot" && toPoint.kind === "order")
          || (fromPoint.kind === "order" && toPoint.kind === "depot");
        if (isDepotToOrder) {
          return true;
        }
      }
      const fromKey = getArcKeyForPoint(fromPoint);
      const toKey = getArcKeyForPoint(toPoint);
      if (!fromKey || !toKey) {
        return null;
      }
      const fromKeyNorm = fromKey.trim().toLowerCase();
      const toKeyNorm = toKey.trim().toLowerCase();
      const allowed = allowedArcsByKey[fromKeyNorm]?.[toKeyNorm];
      if (typeof allowed === "boolean") {
        return allowed;
      }
      return false;
    },
    [allowedArcsByKey],
  );

  const handleMarkerClick = useCallback(
    (point: DeliveryPoint) => (event: LeafletEvent | LeafletMouseEvent) => {
      const original = (event as LeafletMouseEvent).originalEvent as MouseEvent | undefined;
      original?.preventDefault();
      original?.stopPropagation();
      setMeasureModeEnabled((prev) => prev || true);
      setMeasureSelection((prev) => {
        if (!prev || !prev.from) {
          return { from: point };
        }
        const prevToId = prev.to?.internalId;
        if (prev.from.internalId === point.internalId) {
          return { from: point };
        }
        if (prevToId && prevToId === point.internalId) {
          return { from: point };
        }
        const duration = getTravelTimeBetweenPoints(prev.from.internalId, point.internalId);
        return {
          from: prev.from,
          to: point,
          durationMin: duration ?? null,
        };
      });
    },
    [getTravelTimeBetweenPoints],
  );

  const handleMeasureToggle = useCallback(() => {
    setMeasureModeEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setMeasureSelection(null);
      }
      return next;
    });
  }, []);

  const handleMeasureClear = useCallback(() => {
    setMeasureSelection(null);
  }, []);

  const polylines = useMemo(
    () =>
      showSolverRoutes
        ? filteredRouteSegments.map((segment) => (
            <RouteSegment
              key={`${segment.groupId}`}
              segment={segment}
              showDepotSegments={showDepotSegments}
              showPositions={showRoutePositions}
              points={points}
              markerPositionsById={markerPositionsById}
            />
          ))
        : null,
    [filteredRouteSegments, showDepotSegments, showSolverRoutes, showRoutePositions, points, markerPositionsById],
  );

  const measureLinePositions = useMemo(() => {
    if (!measureModeEnabled || !measureSelection?.from || !measureSelection?.to) {
      return null;
    }
    return [
      [measureSelection.from.lat, measureSelection.from.lon],
      [measureSelection.to.lat, measureSelection.to.lon],
    ] as [number, number][];
  }, [measureModeEnabled, measureSelection]);

  const currentArcAllowed = useMemo(
    () => isArcAllowed(measureSelection?.from, measureSelection?.to),
    [isArcAllowed, measureSelection],
  );

  const measureMidpoint = useMemo(() => {
    if (!measureLinePositions) {
      return null;
    }
    const [[fromLat, fromLon], [toLat, toLon]] = measureLinePositions;
    return [(fromLat + toLat) / 2, (fromLon + toLon) / 2] as [number, number];
  }, [measureLinePositions]);

  const measureLabelIcon = useMemo(() => {
    if (!measureLinePositions) {
      return null;
    }
    const labelText =
      typeof measureSelection?.durationMin === "number"
        ? `${measureSelection.durationMin} мин`
        : "нет данных";
    const labelColor =
      currentArcAllowed === false
        ? "#880e4f"
        : currentArcAllowed === true
          ? "#00695c"
          : "#212121";
    const background = isDarkMapEnabled
      ? "rgba(0,0,0,0.75)"
      : "rgba(255,255,255,0.85)";
    const borderColor = isDarkMapEnabled
      ? "rgba(255,255,255,0.35)"
      : "rgba(0,0,0,0.25)";
    return L.divIcon({
      className: "measure-label",
      html: `<div style="display:inline-flex;align-items:center;white-space:nowrap;padding:4px 10px;background:${background};color:${labelColor};border-radius:999px;border:1px solid ${borderColor};font-size:12px;font-weight:600;line-height:1;box-shadow:0 2px 6px rgba(0,0,0,0.18);">${labelText}</div>`,
    });
  }, [currentArcAllowed, isDarkMapEnabled, measureLinePositions, measureSelection?.durationMin]);

  const measureLayer = measureLinePositions ? (
    <>
      <Polyline
        positions={measureLinePositions}
        pathOptions={{
          color:
            currentArcAllowed === false
              ? "#880e4f"
              : currentArcAllowed === true
                ? "#00c853"
                : "#616161",
          weight: 3,
          dashArray: "3 6",
        }}
        interactive={false}
      />
      {measureMidpoint && measureLabelIcon ? (
        <Marker
          position={measureMidpoint}
          icon={measureLabelIcon}
          interactive={false}
          zIndexOffset={1000}
        />
      ) : null}
    </>
  ) : null;

  const measureStatus = useMemo(() => {
    if (!measureModeEnabled) {
      return { message: "" };
    }
    if (!measureSelection?.from) {
      return { message: "Выберите две точки на карте" };
    }
    if (!measureSelection.to) {
      return { message: "Выберите вторую точку на карте" };
    }
    return { message: "" };
  }, [measureModeEnabled, measureSelection]);

  const currentStatusArcAllowed = useMemo(() => {
    if (!measureSelection?.from || !measureSelection.to) {
      return null;
    }
    return isArcAllowed(measureSelection.from, measureSelection.to);
  }, [isArcAllowed, measureSelection]);

  const toggleRoutes = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      dispatch(setShowSolverRoutes(checked));
    },
    [dispatch],
  );

  const toggleDepotSegments = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      dispatch(setShowDepotSegments(checked));
    },
    [dispatch],
  );

  const togglePositions = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      dispatch(setShowRoutePositions(checked));
    },
    [dispatch],
  );

  const toggleDepartingNow = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      dispatch(setShowDepartingNowRoutes(checked));
    },
    [dispatch],
  );

  const handleDepartingWindowChange = useCallback(
    (_event: Event, value: number | number[]) => {
      const nextValue = Array.isArray(value) ? value[0] ?? 0 : value;
      dispatch(setDepartingWindowMinutes(nextValue));
    },
    [dispatch],
  );

  const toggleReadyNow = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      dispatch(setShowReadyNowOrders(checked));
    },
    [dispatch],
  );

  const handleToggleFullScreen = useCallback(() => {
    setFullScreen((prev) => !prev);
  }, []);

  const toggleViewportLock = useCallback(() => {
    dispatch(setViewportLocked(!viewportLocked));
  }, [dispatch, viewportLocked]);

  const handleFitToView = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const pointsLatLng = points.map((point) => L.latLng(point.lat, point.lon));
    if (pointsLatLng.length === 0) {
      return;
    }

    if (pointsLatLng.length === 1) {
      const target = pointsLatLng[0];
      const targetZoom = Math.min(Math.max(map.getZoom(), 14), map.getMaxZoom() || 18);
      map.setView(target, targetZoom, { animate: true });
      return;
    }

    const bounds = L.latLngBounds(pointsLatLng);
    map.fitBounds(bounds.pad(0.1), { animate: true });
  }, [points]);

  const mapWrapperSx = isFullScreen
    ? {
        position: "fixed" as const,
        top: { xs: 8, sm: 16 },
        right: { xs: 8, sm: 16 },
        bottom: { xs: 8, sm: 16 },
        left: { xs: 8, sm: 16 },
        zIndex: 1400,
        backgroundColor: "background.default",
        borderRadius: 2,
        boxShadow: 24,
        display: "flex",
        flexDirection: "column" as const,
        gap: 1.5,
        p: 2,
        height: { xs: "calc(100vh - 16px)", sm: "calc(100vh - 32px)" },
        width: { xs: "calc(100vw - 16px)", sm: "calc(100vw - 32px)" },
      }
    : { height: "100%" };

  const mapBoxSx = isFullScreen
    ? { flexGrow: 1, position: "relative", borderRadius: 2, overflow: "hidden", boxShadow: 2 }
    : { height: 480, width: "100%", borderRadius: 2, overflow: "hidden", boxShadow: 2, position: "relative" };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const anyMap = map as unknown as {
      dragging: L.Handler;
      scrollWheelZoom: L.Handler;
      doubleClickZoom: L.Handler;
      boxZoom: L.Handler;
      keyboard: L.Handler;
      touchZoom?: L.Handler & { disable?: () => void; enable?: () => void };
      tap?: { disable?: () => void; enable?: () => void };
    };

    const toggleInteraction = (enabled: boolean) => {
      if (enabled) {
        anyMap.dragging.enable();
        anyMap.scrollWheelZoom.enable();
        anyMap.doubleClickZoom.enable();
        anyMap.boxZoom.enable();
        anyMap.keyboard.enable();
        anyMap.touchZoom?.enable?.();
        anyMap.tap?.enable?.();
      } else {
        anyMap.dragging.disable();
        anyMap.scrollWheelZoom.disable();
        anyMap.doubleClickZoom.disable();
        anyMap.boxZoom.disable();
        anyMap.keyboard.disable();
        anyMap.touchZoom?.disable?.();
        anyMap.tap?.disable?.();
      }
    };

    toggleInteraction(!viewportLocked);

    return () => {
      toggleInteraction(true);
    };
  }, [viewportLocked]);

  return (
    <>
      {isFullScreen ? (
        <Box
          sx={{ position: "fixed", inset: 0, bgcolor: "rgba(16, 16, 16, 0.55)", zIndex: 1399 }}
          onClick={() => setFullScreen(false)}
        />
      ) : null}
      <Stack spacing={1.5} sx={mapWrapperSx}>
        <Box sx={mapBoxSx}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="flex-end"
            sx={{
              position: "absolute",
              bottom: 12,
              right: 12,
              zIndex: 1200,
            }}
          >
            <Stack
              direction="column"
              spacing={1}
              alignItems="flex-end"
            >
              <MuiTooltip
                title={isDarkMapEnabled ? "Светлая карта" : "Тёмная карта"}
                placement="left"
              >
                <span>
                  <IconButton
                    size="small"
                    onClick={() => setDarkMapEnabled((prev) => !prev)}
                    sx={{
                      bgcolor: isDarkMapEnabled ? "primary.main" : "background.paper",
                      color: isDarkMapEnabled ? "primary.contrastText" : "text.primary",
                      boxShadow: 2,
                      '&:hover': {
                        bgcolor: isDarkMapEnabled ? "primary.dark" : "background.paper",
                        boxShadow: 4,
                      },
                    }}
                  >
                    <DarkModeIcon fontSize="small" />
                  </IconButton>
                </span>
              </MuiTooltip>
              <MuiTooltip
                title={measureModeEnabled ? "Выключить режим измерения дуги" : "Включить режим измерения дуги"}
                placement="left"
              >
                <span>
                  <IconButton
                    size="small"
                    onClick={handleMeasureToggle}
                    sx={{
                      bgcolor: measureModeEnabled ? "primary.main" : "background.paper",
                      color: measureModeEnabled ? "primary.contrastText" : "text.primary",
                      boxShadow: 2,
                      '&:hover': {
                        bgcolor: measureModeEnabled ? "primary.dark" : "background.paper",
                        boxShadow: 4,
                      },
                    }}
                  >
                    <StraightenIcon fontSize="small" />
                  </IconButton>
                </span>
              </MuiTooltip>
              {measureModeEnabled ? (
                <Box
                  sx={{
                    maxWidth: 260,
                    bgcolor: isDarkMapEnabled ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.75)",
                    color:
                      currentStatusArcAllowed === true
                        ? "#00c853"
                        : currentStatusArcAllowed === false
                          ? "#880e4f"
                          : isDarkMapEnabled
                            ? "#fff"
                            : "#000",
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    boxShadow: 2,
                    border: isDarkMapEnabled
                      ? "1px solid rgba(255,255,255,0.3)"
                      : "1px solid rgba(0,0,0,0.18)",
                    fontSize: 12,
                    textAlign: "right",
                  }}
                >
                  <Typography variant="caption" component="div">
                    {!measureSelection?.from && measureStatus.message}
                    {measureSelection?.from && !measureSelection?.to && (
                      <>
                        Начало:{" "}
                        <strong>{labelForPoint(measureSelection.from)}</strong>
                      </>
                    )}
                    {measureSelection?.from && measureSelection?.to && (
                      <>
                        <strong>{labelForPoint(measureSelection.from)}</strong>
                        {" \u2192 "}
                        <strong>{labelForPoint(measureSelection.to)}</strong>
                        {" — "}
                        {typeof measureSelection.durationMin === "number"
                          ? `${measureSelection.durationMin} мин`
                          : "нет данных"}
                      </>
                    )}
                  </Typography>
                </Box>
              ) : null}
            </Stack>
            <Stack direction="column" spacing={1}>
              <MuiTooltip title="Скопировать карту" placement="left">
                <span>
                  <IconButton
                    size="small"
                    onClick={async () => {
                    if (isCopying) {
                      return;
                    }
                    try {
                      setIsCopying(true);
                      let screenshoter = screenshoterRef.current;
                      if (!screenshoter || typeof screenshoter.takeScreen !== "function") {
                        const mapInstance = mapRef.current;
                        if (mapInstance && (L as any).simpleMapScreenshoter) {
                          screenshoter = (L as any)
                            .simpleMapScreenshoter({
                              mimeType: "image/png",
                              quality: 1,
                              position: "topright",
                            })
                            .addTo(mapInstance);
                          const controlContainer = (screenshoter as any)?._container as HTMLElement | undefined;
                          if (controlContainer) {
                            controlContainer.style.display = "none";
                          }
                          screenshoterRef.current = screenshoter;
                        }
                      }
                      if (!screenshoter || typeof screenshoter.takeScreen !== "function") {
                        throw new Error("Screenshoter недоступен");
                      }
                      const result = await screenshoter.takeScreen("canvas", {
                        mimeType: "image/png",
                        quality: 1,
                      });
                      const canvas =
                        result instanceof HTMLCanvasElement
                          ? result
                          : (result && result.canvas) || null;
                      if (!canvas) {
                        throw new Error("Не удалось сформировать изображение");
                      }

                      drawOverlay(canvas, {
                        statusLabel,
                        metrics,
                        currentTime,
                        isFullScreen,
                      });

                      const blob = await new Promise<Blob | null>((resolve) =>
                        canvas.toBlob((value) => resolve(value), "image/png"),
                      );
                      if (!blob) {
                        throw new Error("Не удалось сформировать изображение");
                      }
                      let copied = false;
                      const hasNavigatorClipboard = typeof navigator !== "undefined" && navigator.clipboard;

                      if (
                        hasNavigatorClipboard
                        && typeof (navigator.clipboard as any).write === "function"
                        && typeof (window as any).ClipboardItem === "function"
                      ) {
                        try {
                          const ClipboardItemCtor = (window as any).ClipboardItem;
                          await (navigator.clipboard as any).write([
                            new ClipboardItemCtor({ "image/png": blob }),
                          ]);
                          copied = true;
                        } catch (clipboardError) {
                          console.warn("Clipboard image write failed", clipboardError);
                        }
                      }

                      if (!copied && hasNavigatorClipboard && typeof navigator.clipboard.writeText === "function") {
                        try {
                          const dataUrl = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              if (typeof reader.result === "string") {
                                resolve(reader.result);
                              } else {
                                reject(new Error("Unexpected FileReader.result type"));
                              }
                            };
                            reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
                            reader.readAsDataURL(blob);
                          });
                          await navigator.clipboard.writeText(dataUrl);
                          copied = true;
                        } catch (clipboardTextError) {
                          console.warn("Clipboard text write failed, fallback to download", clipboardTextError);
                        }
                      }

                      if (!copied) {
                        saveAs(blob, `map-${new Date().toISOString()}.png`);
                      }
                    } catch (error) {
                      console.error("Clipboard copy failed", error);
                    } finally {
                      setIsCopying(false);
                    }
                  }}
                    disabled={isCopying}
                    sx={{
                      bgcolor: "background.paper",
                      color: "text.primary",
                      boxShadow: 2,
                      '&:hover': {
                        bgcolor: "background.paper",
                        boxShadow: 4,
                      },
                    }}
                  >
                    {isCopying ? <CircularProgress size={14} /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </span>
              </MuiTooltip>
              <MuiTooltip title={viewportLocked ? "Разблокировать карту" : "Заблокировать карту"} placement="left">
                <span>
                  <IconButton
                    size="small"
                    onClick={toggleViewportLock}
                    sx={{
                      bgcolor: "background.paper",
                      color: viewportLocked ? "primary.main" : "text.primary",
                      boxShadow: 2,
                      '&:hover': {
                        bgcolor: "background.paper",
                        boxShadow: 4,
                      },
                    }}
                  >
                    {viewportLocked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
                  </IconButton>
                </span>
              </MuiTooltip>
              <IconButton
                size="small"
                onClick={handleFitToView}
                disabled={points.length === 0 || viewportLocked}
                sx={{
                  bgcolor: "background.paper",
                  color: viewportLocked ? "text.disabled" : "text.primary",
                  boxShadow: 2,
                  cursor: viewportLocked ? "default" : "pointer",
                  '&:hover': {
                    bgcolor: "background.paper",
                    boxShadow: viewportLocked ? 2 : 4,
                  },
                }}
              >
                <CenterFocusStrongIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={handleToggleFullScreen}
                sx={{
                  bgcolor: "background.paper",
                  color: "text.primary",
                  boxShadow: 2,
                  '&:hover': {
                    bgcolor: "background.paper",
                    boxShadow: 4,
                  },
                }}
              >
                {isFullScreen ? (
                  <FullscreenExitIcon fontSize="small" />
                ) : (
                  <FullscreenIcon fontSize="small" />
                )}
              </IconButton>
            </Stack>
          </Stack>
          {arrivalMetric ? (
            <Paper
              elevation={1}
              sx={{
                position: "absolute",
                top: 12,
                left: 64,
                zIndex: 1200,
                px: 1.5,
                py: 0.75,
                bgcolor: "rgba(245, 245, 245, 0.85)",
                color: "rgb(33, 33, 33)",
                borderRadius: 1,
              }}
            >
              <Typography variant="caption" color="rgba(33, 33, 33, 0.7)" fontWeight={600}>
                {arrivalMetric.label}
              </Typography>
              <Typography variant="body2" fontWeight={700} color="inherit">
                {arrivalMetric.value}
              </Typography>
            </Paper>
          ) : null}
          {isFullScreen && (statusLabel || (metrics && metrics.length > 0)) ? (
            <>
              {statusLabel ? (
                <Paper
                  elevation={1}
                  sx={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    px: 1.5,
                    py: 0.75,
                    display: "flex",
                    flexDirection: "column",
                    bgcolor: "rgba(245, 245, 245, 0.85)",
                    color: "rgb(33, 33, 33)",
                    zIndex: 1200,
                    borderRadius: 1,
                    minWidth: 150,
                  }}
                >
                  <Typography variant="caption" color="rgba(33, 33, 33, 0.7)" fontWeight={600}>
                    Статус
                  </Typography>
                  <Typography variant="body2" fontWeight={700} color="inherit">
                    {statusLabel}
                  </Typography>
                </Paper>
              ) : null}
              {metrics && metrics.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    position: "absolute",
                    top: 12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 1200,
                    flexWrap: "wrap",
                    rowGap: 0.5,
                    justifyContent: "center",
                  }}
                >
                  {metrics
                    .filter((item) => item.label !== "Прибытие курьеров")
                    .map(({ label, value }) => (
                    <Paper
                      key={`fs-${label}`}
                      elevation={1}
                  sx={{
                    px: 1.5,
                    py: 0.75,
                    display: "flex",
                    flexDirection: "column",
                    bgcolor: "rgba(245, 245, 245, 0.85)",
                    color: "rgb(33, 33, 33)",
                  }}
                >
                      <Typography variant="caption" color="rgba(33, 33, 33, 0.7)" fontWeight={600}>
                        {label}
                      </Typography>
                      <Typography variant="body2" fontWeight={700} color="inherit">
                        {value}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              ) : null}
            </>
          ) : null}
          {currentTime ? (
            <Paper
              elevation={1}
              sx={{
                position: "absolute",
                bottom: 12,
                left: 12,
                zIndex: 1200,
                px: 1.5,
                py: 0.75,
                bgcolor: "rgba(245, 245, 245, 0.85)",
                color: "rgb(33, 33, 33)",
                borderRadius: 1,
              }}
            >
              <Typography variant="caption" color="rgba(33, 33, 33, 0.7)" fontWeight={600}>
                Текущее время
              </Typography>
              <Typography variant="body2" fontWeight={700} color="inherit">
                {currentTime} UTC
              </Typography>
            </Paper>
          ) : null}
          <MapContainer
            ref={mapRef}
            whenCreated={(instance) => {
              mapRef.current = instance;
              setMapReady(true);
            }}
            center={center}
            zoom={zoom}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              url={isDarkMapEnabled ? DARK_TILE_LAYER : LIGHT_TILE_LAYER}
              attribution='&copy; OpenStreetMap, &copy; Carto'
              crossOrigin="anonymous"
            />
            {isDarkMapEnabled ? (
              <TileLayer
                url={DARK_LABELS_TILE_LAYER}
                attribution='&copy; OpenStreetMap, &copy; Carto'
                crossOrigin="anonymous"
              />
            ) : null}
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
              <MarkersLayer
                points={points}
                isEditingEnabled={isEditingEnabled}
                showReadyNowOrders={showReadyNowOrders}
                readyNowOrderIds={readyNowOrderIds}
                handleMarkerDragEnd={handleMarkerDragEnd}
                handleMarkerClick={handleMarkerClick}
                markerPositionsById={markerPositionsById}
                markerClusters={markerClusters}
              />
              {polylines}
              {measureLayer}
            </FeatureGroup>
          </MapContainer>
        </Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <FormControlLabel
              control={
                <Switch
                  checked={isEditingEnabled}
                  onChange={(_event, checked) => setEditingEnabled(checked)}
                  color="primary"
                />
              }
              label="Редактирование"
            />
            <FormControlLabel
              control={<Checkbox checked={showSolverRoutes} onChange={toggleRoutes} />}
              label="Маршруты"
            />
            <FormControlLabel
              control={<Checkbox checked={showDepotSegments} onChange={toggleDepotSegments} />}
              label="Стрелки из депо"
            />
            <FormControlLabel
              control={<Checkbox checked={showRoutePositions} onChange={togglePositions} />}
              label="Нумерация в маршруте"
            />
            <FormControlLabel
              control={<Checkbox checked={showDepartingNowRoutes} onChange={toggleDepartingNow} />}
              label="Выезжают в ближайшие"
            />
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 180 }}>
              <Slider
                value={departingWindowMinutes}
                onChange={handleDepartingWindowChange}
                min={0}
                max={15}
                step={1}
                size="small"
                disabled={!showDepartingNowRoutes}
                sx={{ width: 130 }}
                aria-label="Окно выезда"
              />
              <Typography
                variant="body2"
                color={showDepartingNowRoutes ? "text.primary" : "text.disabled"}
                sx={{ minWidth: 48 }}
              >
                {departingWindowMinutes} мин
              </Typography>
            </Stack>
            <FormControlLabel
              control={<Checkbox checked={showReadyNowOrders} onChange={toggleReadyNow} />}
              label="Готовы сейчас"
            />
          </Stack>
          {isFullScreen && (onImportLogClick || onHistoryBack || onHistoryForward) ? (
            <Stack direction="row" spacing={1} alignItems="center">
              {onImportLogClick ? (
                <Button
                  variant="contained"
                  onClick={onImportLogClick}
                  disabled={importLogDisabled}
                  startIcon={importLogLoading ? <CircularProgress size={16} /> : undefined}
                >
                  {importLogLoading ? "Импортируем..." : "Загрузить Enriched CP-SAT Log"}
                </Button>
              ) : null}
              {onHistoryBack ? (
                <IconButton
                  size="small"
                  onClick={onHistoryBack}
                  disabled={!historyBackEnabled}
                  sx={{
                    bgcolor: "background.paper",
                    color: historyBackEnabled ? "text.primary" : "text.disabled",
                    boxShadow: 2,
                    '&:hover': {
                      bgcolor: "background.paper",
                      boxShadow: historyBackEnabled ? 4 : 2,
                    },
                  }}
                >
                  <ArrowBackIosNewIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onHistoryForward ? (
                <IconButton
                  size="small"
                  onClick={onHistoryForward}
                  disabled={!historyForwardEnabled}
                  sx={{
                    bgcolor: "background.paper",
                    color: historyForwardEnabled ? "text.primary" : "text.disabled",
                    boxShadow: 2,
                    '&:hover': {
                      bgcolor: "background.paper",
                      boxShadow: historyForwardEnabled ? 4 : 2,
                    },
                  }}
                >
                  <ArrowForwardIosIcon fontSize="small" />
                </IconButton>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </Stack>
    </>
  );
};

export default memo(MapOrdersMapClient);

interface OverlayProps {
  statusLabel?: string;
  metrics?: Array<{ label: string; value: string }>;
  currentTime?: string;
  isFullScreen: boolean;
}

interface MarkersLayerProps {
  points: DeliveryPoint[];
  isEditingEnabled: boolean;
  showReadyNowOrders: boolean;
  readyNowOrderIds: Set<string>;
  handleMarkerDragEnd: (internalId: string) => (event: LeafletEvent) => void;
  handleMarkerClick: (point: DeliveryPoint) => (event: LeafletEvent | LeafletMouseEvent) => void;
  markerPositionsById: Map<string, [number, number]>;
  markerClusters: MarkerClusterInfo[];
}

const MarkersLayerComponent = ({
  points,
  isEditingEnabled,
  showReadyNowOrders,
  readyNowOrderIds,
  handleMarkerDragEnd,
  handleMarkerClick,
  markerPositionsById,
  markerClusters,
}: MarkersLayerProps) => {
  const markers = useMemo(() => {
    const result: JSX.Element[] = [];
    markerClusters.forEach((cluster, index) => {
      if (!cluster.internalIds.length) {
        return;
      }
      const [centerLat, centerLon] = cluster.center;
      const centerLatLng = L.latLng(centerLat, centerLon);
      const firstPointId = cluster.internalIds[0];
      const markerPosition = markerPositionsById.get(firstPointId);
      if (!markerPosition) {
        return;
      }
      const markerLatLng = L.latLng(markerPosition[0], markerPosition[1]);
      const radiusMeters = centerLatLng.distanceTo(markerLatLng);
      if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
        return;
      }

      result.push(
        <Circle
          // eslint-disable-next-line react/no-array-index-key
          key={`cluster-${index}-${centerLat}-${centerLon}`}
          center={cluster.center}
          radius={radiusMeters}
          pathOptions={{
            color: "#1976d2",
            weight: 2,
            fillColor: "#1976d2",
            fillOpacity: 0.12,
          }}
          interactive={false}
        />,
      );
    });

    points.forEach((point) => {
      const position = markerPositionsById.get(point.internalId) ?? [point.lat, point.lon];
      const [markerLat, markerLon] = position;
      const isReadyNow = showReadyNowOrders && readyNowOrderIds.has(point.internalId);

      result.push(
        <Marker
          key={point.internalId}
          position={[markerLat, markerLon]}
          draggable={isEditingEnabled && point.kind !== "depot"}
          eventHandlers={{
            dragend: handleMarkerDragEnd(point.internalId),
            click: handleMarkerClick(point),
          }}
          icon={createNumberedPinIcon(
            point.orderNumber ?? point.seq,
            point.kind,
            isReadyNow ? { variant: "ready" } : undefined,
          )}
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
              {point.kind === "order" ? (
                <>
                  <br />
                  Коробки: {point.boxes}
                  <br />
                  Создан: {point.createdAt}
                  <br />
                  Готов: {point.readyAt}
                  {typeof point.courierWaitMin === "number" ? (
                    <>
                      <br />
                      Время ожидания отправления:{" "}
                      <span style={{ fontWeight: 600 }}>{Math.round(point.courierWaitMin)} мин</span>
                    </>
                  ) : null}
                </>
              ) : null}
              {typeof point.skip === "number" && point.skip > 0 ? (
                <>
                  <br />
                  <span style={{ color: "#3a1b67", fontWeight: 600 }}>Пропуск</span>
                </>
              ) : null}
              {typeof point.cert === "number" && point.cert > 0 ? (
                <>
                  <br />
                  <span style={{ color: "#b71c1c", fontWeight: 600 }}>Сертификат</span>
                </>
              ) : null}
              {typeof point.currentC2eMin === "number" ? (
                <>
                  <br />
                  Текущий C2E:{" "}
                  <span style={{ fontWeight: 600 }}>{Math.round(point.currentC2eMin)} мин</span>
                </>
              ) : null}
              {typeof point.plannedC2eMin === "number" ? (
                <>
                  <br />
                  Плановый C2E:{" "}
                  <span style={{ fontWeight: 600 }}>{Math.round(point.plannedC2eMin)} мин</span>
                </>
              ) : null}
            </div>
          </Tooltip>
        </Marker>,
      );
    });

    return result;
  }, [points, isEditingEnabled, showReadyNowOrders, readyNowOrderIds, handleMarkerDragEnd, handleMarkerClick, markerPositionsById, markerClusters]);

  return <>{markers}</>;
};

const MarkersLayer = memo(MarkersLayerComponent);

const drawOverlay = (
  canvas: HTMLCanvasElement,
  { statusLabel, metrics, currentTime, isFullScreen }: OverlayProps,
) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const background = "rgba(245, 245, 245, 0.85)";
  const textColor = "rgb(33, 33, 33)";
  const labelColor = "rgba(33, 33, 33, 0.7)";
  const paddingX = 14;
  const paddingY = 8;
  const gap = 8;
  const margin = 12;
  const labelFont = "600 12px 'Roboto', sans-serif";
  const valueFont = "700 14px 'Roboto', sans-serif";

  let arrivalMetric: { label: string; value: string } | null = null;
  let otherMetrics = metrics;
  if (metrics && metrics.length > 0) {
    const index = metrics.findIndex((item) => item.label === "Прибытие курьеров");
    if (index >= 0) {
      arrivalMetric = metrics[index] ?? null;
      otherMetrics = [...metrics.slice(0, index), ...metrics.slice(index + 1)];
    }
  }

  const measureCard = (label: string, value: string) => {
    ctx.font = labelFont;
    const labelWidth = ctx.measureText(label).width;
    ctx.font = valueFont;
    const valueWidth = ctx.measureText(value).width;
    const width = Math.max(labelWidth, valueWidth) + paddingX * 2;
    const labelHeight = 12;
    const valueHeight = 14;
    const height = paddingY * 2 + labelHeight + valueHeight + 6;
    return { width, height, labelHeight, valueHeight };
  };

  const drawCard = (x: number, y: number, label: string, value: string) => {
    const { width, height } = measureCard(label, value);
    ctx.save();
    ctx.fillStyle = background;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    ctx.lineWidth = 1;
    const radius = 8;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = labelColor;
    ctx.font = labelFont;
    ctx.fillText(label, x + paddingX, y + paddingY + 12);
    ctx.fillStyle = textColor;
    ctx.font = valueFont;
    ctx.fillText(value, x + paddingX, y + paddingY + 12 + 6 + 14);
    ctx.restore();
    return { width, height };
  };

  if (arrivalMetric) {
    const x = margin + 52;
    const y = margin;
    drawCard(x, y, arrivalMetric.label, arrivalMetric.value);
  }

  if (currentTime) {
    drawCard(margin, canvas.height - margin - measureCard("Текущее время", `${currentTime} UTC`).height, "Текущее время", `${currentTime} UTC`);
  }

  if (statusLabel) {
    const { width, height } = measureCard("Статус", statusLabel);
    const x = canvas.width - width - margin;
    const y = margin;
    drawCard(x, y, "Статус", statusLabel);
  }

  if (otherMetrics && otherMetrics.length > 0) {
    const cards = otherMetrics.map(({ label, value }) => ({
      label,
      value,
      ...measureCard(label, value),
    }));
    const totalWidth = cards.reduce((sum, item) => sum + item.width, 0) + gap * (cards.length - 1);
    const rowX = isFullScreen ? (canvas.width - totalWidth) / 2 : canvas.width - totalWidth - margin;
    const rowY = margin;
    let offsetX = rowX;
    cards.forEach(({ label, value, width }) => {
      drawCard(offsetX, rowY, label, value);
      offsetX += width + gap;
    });
  }
};

interface RouteSegmentProps {
  segment: RoutesSegmentDto;
  showDepotSegments: boolean;
  showPositions: boolean;
  points: DeliveryPoint[];
  markerPositionsById: Map<string, [number, number]>;
}

const RouteSegmentComponent = ({
  segment,
  showDepotSegments,
  showPositions,
  points,
  markerPositionsById,
}: RouteSegmentProps) => {
  const map = useMap();
  const [, forceUpdate] = useState(0);

  useMapEvents({
    zoom: () => forceUpdate((value) => value + 1),
    move: () => forceUpdate((value) => value + 1),
  });

  const color = segment.color ?? getRouteColor(segment.groupId);

  const pointByRouteKey = useMemo(() => {
    const mapByKey = new Map<string, DeliveryPoint>();
    points.forEach((point) => {
      if (point.groupId === undefined || point.routePos === undefined) {
        return;
      }
      const key = `${point.groupId}:${point.routePos}`;
      if (!mapByKey.has(key)) {
        mapByKey.set(key, point);
      }
    });
    return mapByKey;
  }, [points]);

  const segmentsToRender = showDepotSegments && segment.depotSegment
    ? [segment.depotSegment, ...segment.segments]
    : segment.segments;

  const arrowMarkers = segmentsToRender.map((item, index) => {
    let fromLat = item.from[0];
    let fromLon = item.from[1];
    let toLat = item.to[0];
    let toLon = item.to[1];

    if (segment.groupId !== undefined) {
      if (item.fromPos > 0) {
        const fromPoint = pointByRouteKey.get(`${segment.groupId}:${item.fromPos}`);
        if (fromPoint) {
          const customFrom = markerPositionsById.get(fromPoint.internalId);
          if (customFrom) {
            [fromLat, fromLon] = customFrom;
          }
        }
      }
      if (item.toPos > 0) {
        const toPoint = pointByRouteKey.get(`${segment.groupId}:${item.toPos}`);
        if (toPoint) {
          const customTo = markerPositionsById.get(toPoint.internalId);
          if (customTo) {
            [toLat, toLon] = customTo;
          }
        }
      }
    }

    const fromLatLng = L.latLng(fromLat, fromLon);
    const toLatLng = L.latLng(toLat, toLon);

    const fromPoint = map.latLngToLayerPoint(fromLatLng);
    const toPoint = map.latLngToLayerPoint(toLatLng);
    const angle = Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x) * (180 / Math.PI);
    const label = showPositions && item.toPos ? String(item.toPos) : undefined;
    const lengthPx = fromPoint.distanceTo(toPoint);

    return (
      <Marker
        key={`${segment.groupId}-arrow-${index}`}
        position={[(fromLat + toLat) / 2, (fromLon + toLon) / 2]}
        icon={createRouteArrowIcon(angle, color, label, lengthPx)}
        interactive={false}
      />
    );
  });

  return <>{arrowMarkers}</>;
};

const RouteSegment = memo(RouteSegmentComponent);
