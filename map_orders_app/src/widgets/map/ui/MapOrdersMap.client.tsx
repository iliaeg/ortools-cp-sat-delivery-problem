"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  FeatureGroup,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { EditControl, type EditControlProps } from "react-leaflet-draw";
import L, { LeafletEvent } from "leaflet";
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
  selectShowRoutePositions,
  selectShowSolverRoutes,
  selectViewportLocked,
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

export interface MapOrdersMapProps {
  statusLabel?: string;
  metrics?: Array<{ label: string; value: string }>;
  currentTime?: string;
  onImportLogClick?: () => void;
  importLogDisabled?: boolean;
  importLogLoading?: boolean;
}

const MapOrdersMapClient = ({
  statusLabel,
  metrics,
  currentTime,
  onImportLogClick,
  importLogDisabled,
  importLogLoading,
}: MapOrdersMapProps) => {
  const dispatch = useAppDispatch();
  const points = useAppSelector(selectPoints);
  const { center, zoom } = useAppSelector(selectMapView);
  const showSolverRoutes = useAppSelector(selectShowSolverRoutes);
  const showDepotSegments = useAppSelector(selectShowDepotSegments);
  const showRoutePositions = useAppSelector(selectShowRoutePositions);
  const viewportLocked = useAppSelector(selectViewportLocked);
  const routeSegments = useAppSelector(selectRouteSegments);
  const [isEditingEnabled, setEditingEnabled] = useState(false);
  const [isFullScreen, setFullScreen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const screenshoterRef = useRef<any>(null);

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
          icon={createNumberedPinIcon(point.orderNumber ?? point.seq, point.kind)}
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
                </>
              ) : null}
              {typeof point.skip === "number" ? (
                <>
                  <br />
                  <span style={{ color: "#5b2c93" }}>Пропуск: {point.skip}</span>
                </>
              ) : null}
              {typeof point.cert === "number" ? (
                <>
                  <br />
                  <span style={{ color: "#b71c1c" }}>Сертификат: {point.cert}</span>
                </>
              ) : null}
              {typeof point.plannedC2eMin === "number" ? (
                <>
                  <br />
                  C2E: <span style={{ fontWeight: 600 }}>{Math.round(point.plannedC2eMin)} мин</span>
                </>
              ) : null}
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
              showDepotSegments={showDepotSegments}
              showPositions={showRoutePositions}
            />
          ))
        : null,
    [routeSegments, showDepotSegments, showSolverRoutes, showRoutePositions],
  );

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
            direction="column"
            spacing={1}
            sx={{
              position: "absolute",
              bottom: 12,
              right: 12,
              zIndex: 1200,
            }}
          >
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
                      if (navigator.clipboard && typeof (navigator.clipboard as any).write === "function") {
                        try {
                          await (navigator.clipboard as any).write([
                            new ClipboardItem({ "image/png": blob }),
                          ]);
                          copied = true;
                        } catch (clipboardError) {
                          console.warn("Clipboard write failed, fallback to download", clipboardError);
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
                  {metrics.map(({ label, value }) => (
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
            <TileLayer url={TILE_LAYER} attribution="&copy; OpenStreetMap" crossOrigin={true} />
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
              label="Режим редактирования точек"
            />
            <FormControlLabel
              control={<Checkbox checked={showSolverRoutes} onChange={toggleRoutes} />}
              label="Показывать маршруты решателя"
            />
            <FormControlLabel
              control={<Checkbox checked={showDepotSegments} onChange={toggleDepotSegments} />}
              label="Показывать стрелки из депо"
            />
            <FormControlLabel
              control={<Checkbox checked={showRoutePositions} onChange={togglePositions} />}
              label="Показывать позиции в маршруте"
            />
          </Stack>
          {isFullScreen && onImportLogClick ? (
            <Button
              variant="contained"
              onClick={onImportLogClick}
              disabled={importLogDisabled}
              startIcon={importLogLoading ? <CircularProgress size={16} /> : undefined}
              sx={{ order: -1 }}
            >
              {importLogLoading ? "Импортируем..." : "Загрузить Enriched CP-SAT Log"}
            </Button>
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

  if (currentTime) {
    drawCard(margin, canvas.height - margin - measureCard("Текущее время", `${currentTime} UTC`).height, "Текущее время", `${currentTime} UTC`);
  }

  if (statusLabel) {
    const { width, height } = measureCard("Статус", statusLabel);
    const x = canvas.width - width - margin;
    const y = margin;
    drawCard(x, y, "Статус", statusLabel);
  }

  if (metrics && metrics.length > 0) {
    const cards = metrics.map(({ label, value }) => ({ label, value, ...measureCard(label, value) }));
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
}

const RouteSegmentComponent = ({
  segment,
  showDepotSegments,
  showPositions,
}: RouteSegmentProps) => {
  const map = useMap();
  const [, forceUpdate] = useState(0);

  useMapEvents({
    zoom: () => forceUpdate((value) => value + 1),
    move: () => forceUpdate((value) => value + 1),
  });

  const color = segment.color ?? getRouteColor(segment.groupId);

  const segmentsToRender = showDepotSegments && segment.depotSegment
    ? [segment.depotSegment, ...segment.segments]
    : segment.segments;

  const arrowMarkers = segmentsToRender.map((item, index) => {
    const fromLatLng = L.latLng(item.from[0], item.from[1]);
    const toLatLng = L.latLng(item.to[0], item.to[1]);

    const fromPoint = map.latLngToLayerPoint(fromLatLng);
    const toPoint = map.latLngToLayerPoint(toLatLng);
    const angle = Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x) * (180 / Math.PI);
    const label = showPositions && item.toPos ? String(item.toPos) : undefined;
    const lengthPx = fromPoint.distanceTo(toPoint);

    return (
      <Marker
        key={`${segment.groupId}-arrow-${index}`}
        position={[item.mid[0], item.mid[1]]}
        icon={createRouteArrowIcon(angle, color, label, lengthPx)}
        interactive={false}
      />
    );
  });

  return <>{arrowMarkers}</>;
};

const RouteSegment = memo(RouteSegmentComponent);
