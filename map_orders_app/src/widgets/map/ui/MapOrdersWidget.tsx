"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { v4 as uuidv4 } from "uuid";
import MapOrdersMap from "./MapOrdersMap";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import {
  replacePoints,
  clearPoints,
  setUiState,
  setPersistedState,
} from "@/features/map-orders/model/mapOrdersSlice";
import { pushLog, goBack, goForward } from "@/features/map-orders/model/logsHistorySlice";
import {
  selectPoints,
  selectCpSatStatus,
  selectCpSatMetrics,
  selectCurrentTime,
  selectMapOrdersState,
} from "@/features/map-orders/model/selectors";
import {
  useExportCaseMutation,
  useExportGeoJsonMutation,
  useImportCaseMutation,
  useImportSolverInputMutation,
} from "@/shared/api/mapOrdersApi";
import { saveBlobToFile, readFileAsText } from "@/shared/files/utils";
import {
  buildStateFromCpSatLog,
  CpSatLogParseError,
  parseCpSatLogPayload,
} from "@/features/map-orders/parsers/parseCpSatLog";
import type { MapOrdersPersistedState } from "@/shared/types/points";
import type { DeliveryPoint } from "@/shared/types/points";

const detectImportKind = (content: unknown): "case" | "solver_input" => {
  if (
    typeof content === "object" &&
    content !== null &&
    "tau" in content &&
    "meta" in content
  ) {
    return "solver_input";
  }
  return "case";
};

const preparePointsFromImport = (points: DeliveryPoint[]): DeliveryPoint[] =>
  points.map((point, index) => ({
    ...point,
    internalId: point.internalId || uuidv4(),
    seq: index + 1,
  }));

const MapOrdersWidget = () => {
  const dispatch = useAppDispatch();
  const points = useAppSelector(selectPoints);
  const cpSatStatus = useAppSelector(selectCpSatStatus);
  const cpSatMetrics = useAppSelector(selectCpSatMetrics);
  const currentTime = useAppSelector(selectCurrentTime);
  const mapOrdersState = useAppSelector(selectMapOrdersState);
  const historyEntries = useAppSelector((state) => state.logsHistory.entries);
  const historyIndex = useAppSelector((state) => state.logsHistory.index);
  const [exportGeoJson, { isLoading: isExportingGeo }]
    = useExportGeoJsonMutation();
  const [exportCase, { isLoading: isExportingCase }] = useExportCaseMutation();
  const [importCaseMutation, { isLoading: isImportingCase }] =
    useImportCaseMutation();
  const [importSolverInputMutation, { isLoading: isImportingSolverInput }] =
    useImportSolverInputMutation();
  const [importError, setImportError] = useState<string | null>(null);
  const [isImportingCpSat, setIsImportingCpSat] = useState(false);

  const isBusy = useMemo(
    () =>
      isExportingGeo ||
      isExportingCase ||
      isImportingCase ||
      isImportingSolverInput ||
      isImportingCpSat,
    [
      isExportingGeo,
      isExportingCase,
      isImportingCase,
      isImportingSolverInput,
      isImportingCpSat,
    ],
  );

  const cpSatStatusLabel = useMemo(() => {
    if (typeof cpSatStatus !== "string") {
      return "";
    }
    const trimmed = cpSatStatus.trim();
    return trimmed.length ? trimmed : "";
  }, [cpSatStatus]);

  const canHistoryBack = historyIndex > 0;
  const canHistoryForward = historyIndex >= 0 && historyIndex < historyEntries.length - 1;

  const metricsCards = useMemo(() => {
    if (!cpSatMetrics) {
      return [] as Array<{ label: string; value: string }>;
    }
    const items: Array<{ label: string; value: string }> = [];
    const {
      totalOrders,
      assignedOrders,
      totalCouriers,
      assignedCouriers,
      objectiveValue,
      certCount,
      skipCount,
    } = cpSatMetrics;

    const formatRatio = (
      count: number | undefined,
      total: number | undefined,
    ): string => {
      if (total !== undefined) {
        return `${count ?? 0} / ${total}`;
      }
      if (count !== undefined) {
        return String(count);
      }
      return "-";
    };

    if (totalOrders !== undefined || assignedOrders !== undefined) {
      items.push({ label: "Заказы", value: formatRatio(assignedOrders, totalOrders) });
    }
    if (totalCouriers !== undefined || assignedCouriers !== undefined) {
      items.push({ label: "Курьеры", value: formatRatio(assignedCouriers, totalCouriers) });
    }
    if (objectiveValue !== undefined) {
      items.push({ label: "Целевая функция", value: String(objectiveValue) });
    }
    if (certCount !== undefined || totalOrders !== undefined) {
      items.push({ label: "Серты", value: formatRatio(certCount, totalOrders) });
    }
    if (skipCount !== undefined || totalOrders !== undefined) {
      items.push({ label: "Пропуски", value: formatRatio(skipCount, totalOrders) });
    }
    return items;
  }, [cpSatMetrics]);

  const historyInitialized = useRef(false);

  const buildSnapshot = useCallback(
    (patch?: Partial<MapOrdersPersistedState>) => {
      const base = {
        ...mapOrdersState.data,
        ...patch,
      } as MapOrdersPersistedState;
      const { lastSavedAtIso, ...rest } = base;
      return JSON.stringify({ ...rest, lastSavedAtIso: undefined });
    },
    [mapOrdersState.data],
  );

  useEffect(() => {
    if (!historyInitialized.current && historyEntries.length === 0) {
      dispatch(pushLog({ state: buildSnapshot(), timestamp: Date.now() }));
      historyInitialized.current = true;
    }
  }, [dispatch, historyEntries.length, buildSnapshot]);

  const handleReimportFromMap = useCallback(() => {
    const normalized = preparePointsFromImport(points);
    dispatch(replacePoints(normalized));
    dispatch(setUiState({ warnings: [] }));
  }, [dispatch, points]);

  const handleClear = useCallback(() => {
    dispatch(clearPoints());
  }, [dispatch]);

  const handleExportGeoJson = useCallback(async () => {
    const response = await exportGeoJson().unwrap();
    saveBlobToFile(response, `map-orders-${new Date().toISOString()}.geojson`);
  }, [exportGeoJson]);

  const handleExportCase = useCallback(async () => {
    const response = await exportCase().unwrap();
    saveBlobToFile(response, `map-orders-case-${new Date().toISOString()}.json`);
  }, [exportCase]);

  const runImport = useCallback(
    async (content: unknown) => {
      setImportError(null);
      const kind = detectImportKind(content);
      const payload = new FormData();
      payload.append("payload", JSON.stringify(content));

      const nextState =
        kind === "case"
          ? await importCaseMutation(payload).unwrap()
          : await importSolverInputMutation(payload).unwrap();
      const patchedState: Partial<MapOrdersPersistedState> = {
        ...nextState,
        cpSatStatus: nextState.cpSatStatus ?? undefined,
        cpSatMetrics: nextState.cpSatMetrics ?? null,
        ...(typeof nextState.viewportLocked === "boolean"
          ? { viewportLocked: nextState.viewportLocked }
          : {}),
      };
      dispatch(pushLog({ state: buildSnapshot(patchedState), timestamp: Date.now() }));
      dispatch(setPersistedState(patchedState));
      dispatch(setUiState({ warnings: [] }));
    },
    [dispatch, importCaseMutation, importSolverInputMutation, buildSnapshot],
  );

  const handleFileSelect = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      try {
        const text = await readFileAsText(file);
        const content = JSON.parse(text);
        await runImport(content);
      } catch (error) {
        setImportError(`Ошибка импорта: ${(error as Error).message}`);
      } finally {
        event.target.value = "";
      }
    },
    [runImport],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (!file) {
        return;
      }
      try {
        const text = await readFileAsText(file);
        const content = JSON.parse(text);
        await runImport(content);
      } catch (error) {
        setImportError(`Ошибка импорта: ${(error as Error).message}`);
      }
    },
    [runImport],
  );

  const handleImportCpSatLog = useCallback(async () => {
    setImportError(null);
    setIsImportingCpSat(true);
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
        throw new Error("Копирование из буфера обмена недоступно");
      }
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        throw new Error("Буфер обмена пуст");
      }
      const parsedPayload = parseCpSatLogPayload(clipboardText);
      const nextState = buildStateFromCpSatLog(parsedPayload);
      dispatch(setPersistedState(nextState));
      dispatch(setUiState({ warnings: [], error: undefined }));
      dispatch(pushLog({ state: buildSnapshot(nextState), timestamp: Date.now() }));
    } catch (error) {
      let message: string;
      if (error instanceof CpSatLogParseError) {
        message = error.message;
      } else if (error instanceof SyntaxError) {
        message = "Невалидный JSON";
      } else {
        message = (error as Error).message;
      }
      setImportError(`Ошибка импорта CP-SAT: ${message}`);
    } finally {
      setIsImportingCpSat(false);
    }
  }, [dispatch, buildSnapshot]);

  const handleHistoryBack = useCallback(() => {
    if (!canHistoryBack) {
      return;
    }
    const target = historyEntries[historyIndex - 1];
    if (!target) {
      return;
    }
    dispatch(setPersistedState(JSON.parse(target.state) as Partial<MapOrdersPersistedState>));
    dispatch(goBack());
  }, [canHistoryBack, historyEntries, historyIndex, dispatch]);

  const handleHistoryForward = useCallback(() => {
    if (!canHistoryForward) {
      return;
    }
    const target = historyEntries[historyIndex + 1];
    if (!target) {
      return;
    }
    dispatch(setPersistedState(JSON.parse(target.state) as Partial<MapOrdersPersistedState>));
    dispatch(goForward());
  }, [canHistoryForward, historyEntries, historyIndex, dispatch]);

  const preventDefaults = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const tagName = (event.target as HTMLElement | null)?.tagName;
      if (tagName && ["INPUT", "TEXTAREA"].includes(tagName)) {
        return;
      }
      if (event.key === "ArrowLeft") {
        if (canHistoryBack) {
          event.preventDefault();
          handleHistoryBack();
        }
        return;
      }
      if (event.key === "ArrowRight") {
        if (canHistoryForward) {
          event.preventDefault();
          handleHistoryForward();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canHistoryBack, canHistoryForward, handleHistoryBack, handleHistoryForward]);

  return (
    <Paper elevation={3} sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Stack spacing={0.75} sx={{ mb: 0.5 }}>
        <Typography variant="h6" fontWeight={700}>
          Карта заказов
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: "nowrap", overflowX: "auto", rowGap: 0.5 }}
        >
          {cpSatStatusLabel ? (
            <Typography variant="body2" fontWeight={700} color="text.primary" sx={{ flexShrink: 0 }}>
              Статус: {cpSatStatusLabel}
            </Typography>
          ) : null}
          {metricsCards.map(({ label, value }) => (
            <Paper
              key={label}
              variant="outlined"
              sx={{ px: 1.25, py: 0.6, display: "flex", flexDirection: "column", minWidth: 128, flexShrink: 0 }}
            >
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography variant="body2" fontWeight={700}>
                {value}
              </Typography>
            </Paper>
          ))}
        </Stack>
      </Stack>
      <MapOrdersMap
        statusLabel={cpSatStatusLabel}
        metrics={metricsCards}
        currentTime={currentTime}
        onImportLogClick={handleImportCpSatLog}
        importLogDisabled={isBusy}
        importLogLoading={isImportingCpSat}
        onHistoryBack={handleHistoryBack}
        onHistoryForward={handleHistoryForward}
        canHistoryBack={canHistoryBack}
        canHistoryForward={canHistoryForward}
      />
      <Divider />
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <Button variant="contained" onClick={handleReimportFromMap}>
          Импортировать из карты
        </Button>
        <Button variant="outlined" color="error" onClick={handleClear}>
          Очистить точки
        </Button>
        <Button variant="outlined" onClick={handleExportGeoJson} disabled={isExportingGeo}>
          {isExportingGeo ? <CircularProgress size={20} /> : "Экспорт GeoJSON"}
        </Button>
        <Button variant="outlined" onClick={handleExportCase} disabled={isExportingCase}>
          {isExportingCase ? <CircularProgress size={20} /> : "Экспорт кейса"}
        </Button>
        <Button variant="contained" component="label" disabled={isBusy}>
          Загрузить JSON
          <input type="file" hidden accept="application/json" onChange={handleFileSelect} />
        </Button>
        <Button
          variant="contained"
          onClick={handleImportCpSatLog}
          disabled={isBusy}
          startIcon={isImportingCpSat ? <CircularProgress size={16} /> : undefined}
        >
          {isImportingCpSat ? "Импортируем..." : "Загрузить Enriched CP-SAT Log"}
        </Button>
      </Stack>
      <Box
        onDrop={handleDrop}
        onDragOver={preventDefaults}
        onDragEnter={preventDefaults}
        onDragLeave={preventDefaults}
        sx={{
          border: "2px dashed #bbb",
          borderRadius: 2,
          p: 2,
          textAlign: "center",
          color: "text.secondary",
        }}
      >
        Перетащите JSON-файл кейса или solver_input сюда, чтобы импортировать.
      </Box>
      {importError ? <Alert severity="error">{importError}</Alert> : null}
    </Paper>
  );
};

export default MapOrdersWidget;
