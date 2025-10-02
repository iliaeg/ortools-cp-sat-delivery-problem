"use client";

import { useCallback, useMemo, useState } from "react";
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
import { selectPoints, selectWarnings } from "@/features/map-orders/model/selectors";
import {
  useExportCaseMutation,
  useExportGeoJsonMutation,
  useImportCaseMutation,
  useImportSolverInputMutation,
} from "@/shared/api/mapOrdersApi";
import { saveBlobToFile, readFileAsText } from "@/shared/files/utils";
import type { DeliveryPoint } from "@/shared/types/points";

interface ImportDetectionResult {
  kind: "case" | "solver_input";
  content: unknown;
}

const detectImportKind = (content: any): ImportDetectionResult["kind"] => {
  if (content?.tau && Array.isArray(content.tau) && content?.meta) {
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
  const warnings = useAppSelector(selectWarnings);
  const [exportGeoJson, { isLoading: isExportingGeo }]
    = useExportGeoJsonMutation();
  const [exportCase, { isLoading: isExportingCase }] = useExportCaseMutation();
  const [importCaseMutation, { isLoading: isImportingCase }] =
    useImportCaseMutation();
  const [importSolverInputMutation, { isLoading: isImportingSolverInput }] =
    useImportSolverInputMutation();
  const [importError, setImportError] = useState<string | null>(null);

  const isBusy = useMemo(
    () =>
      isExportingGeo ||
      isExportingCase ||
      isImportingCase ||
      isImportingSolverInput,
    [
      isExportingGeo,
      isExportingCase,
      isImportingCase,
      isImportingSolverInput,
    ],
  );

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
    async (content: any) => {
      setImportError(null);
      const kind = detectImportKind(content);
      const payload = new FormData();
      payload.append("payload", JSON.stringify(content));

      const nextState =
        kind === "case"
          ? await importCaseMutation(payload).unwrap()
          : await importSolverInputMutation(payload).unwrap();
      dispatch(setPersistedState(nextState));
      dispatch(setUiState({ warnings: [] }));
    },
    [dispatch, importCaseMutation, importSolverInputMutation],
  );

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
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
    async (event: React.DragEvent<HTMLDivElement>) => {
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

  const preventDefaults = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <Paper elevation={3} sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" fontWeight={700}>
        Карта заказов
      </Typography>
      <MapOrdersMap />
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
      {warnings.length > 0 ? (
        <Alert severity="warning" variant="outlined">
          {warnings.join("\n")}
        </Alert>
      ) : null}
    </Paper>
  );
};

export default MapOrdersWidget;
