"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  CircularProgress,
  Snackbar,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SettingsInputComponentIcon from "@mui/icons-material/SettingsInputComponent";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DownloadIcon from "@mui/icons-material/Download";
import ContentPasteGoIcon from "@mui/icons-material/ContentPasteGo";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import {
  selectControlTexts,
  selectPoints,
  selectSolverInput,
  selectWarnings,
  selectSolverResult,
  selectSolverSignatures,
  selectIsFromCpSatLog,
} from "@/features/map-orders/model/selectors";
import {
  applyComputedFields,
  resetSolverResult,
  setManualTauText,
  setSolverInput,
  setSolverResult,
  setUiState,
} from "@/features/map-orders/model/mapOrdersSlice";
import { pushLog } from "@/features/map-orders/model/logsHistorySlice";
import {
  useBuildSolverInputMutation,
  useSolveMutation,
} from "@/shared/api/mapOrdersApi";
import { saveBlobToFile } from "@/shared/files/utils";
import { stringifyWithInlineArrays } from "@/shared/lib/json";
import { useStore } from "react-redux";
import type { RootState } from "@/shared/store";
import type { SolverInputPayload, SolverInvocationRequest } from "@/shared/types/solver";

const extractSolverErrorMessage = (error: unknown): string => {
  if (!error) {
    return "Неизвестная ошибка";
  }
  if (error instanceof Error) {
    return error.message || "Неизвестная ошибка";
  }
  if (typeof error === "object") {
    const anyError = error as { message?: unknown; error?: unknown; data?: unknown };
    const data = anyError.data as { error?: unknown } | undefined;
    if (data && typeof data.error === "string" && data.error.trim().length > 0) {
      return data.error;
    }
    if (typeof anyError.error === "string" && anyError.error.trim().length > 0) {
      return anyError.error;
    }
    if (typeof anyError.message === "string" && anyError.message.trim().length > 0) {
      return anyError.message;
    }
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Неизвестная ошибка";
  }
};

const normalizeUtcIso = (value?: string): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  // Если есть явный часовой пояс — используем как есть
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // Без таймзоны интерпретируем как UTC
  return `${trimmed}Z`;
};

const diffMinutes = (fromIso?: string, baseIso?: string): number | null => {
  const normFrom = normalizeUtcIso(fromIso);
  const normBase = normalizeUtcIso(baseIso);
  if (!normFrom || !normBase) {
    return null;
  }
  const from = new Date(normFrom);
  const base = new Date(normBase);
  if (Number.isNaN(from.getTime()) || Number.isNaN(base.getTime())) {
    return null;
  }
  return Math.round((from.getTime() - base.getTime()) / 60000);
};
import { buildHistorySnapshot } from "@/features/map-orders/lib/historySnapshot";

const SolverControlsWidget = () => {
  const dispatch = useAppDispatch();
  const {
    couriersText,
    weightsText,
    additionalParamsText,
    manualTauText,
    useManualTau,
    t0Time,
    osrmBaseUrl,
  } = useAppSelector(selectControlTexts);
  const solverInput = useAppSelector(selectSolverInput);
  const solverResult = useAppSelector(selectSolverResult);
  const points = useAppSelector(selectPoints);
  const isFromCpSatLog = useAppSelector(selectIsFromCpSatLog);
  const warnings = useAppSelector(selectWarnings);
  const { lastSolverInputSignature, lastSolverResultSignature } =
    useAppSelector(selectSolverSignatures);
  const store = useStore<RootState>();
  const [buildSolverInput, { isLoading: isBuilding }]
    = useBuildSolverInputMutation();
  const [solve, { isLoading: isSolving }]
    = useSolveMutation();
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastSeverity, setToastSeverity] = useState<"success" | "error">("success");

  const currentSignature = useMemo(
    () =>
      stringifyWithInlineArrays({
        pointsSnapshot: points.map(
          ({
            internalId,
            id,
            kind,
            lat,
            lon,
            boxes,
            createdAt,
            readyAt,
          }) => ({
            internalId,
            id,
            kind,
            lat,
            lon,
            boxes,
            createdAt,
            readyAt,
          }),
        ),
        couriersText,
        weightsText,
        additionalParamsText,
        manualTauText,
        useManualTau,
        t0Time,
        osrmBaseUrl,
      }),
    [
      points,
      couriersText,
      weightsText,
      additionalParamsText,
      manualTauText,
      useManualTau,
      t0Time,
      osrmBaseUrl,
    ],
  );

  const handleBuildSolverInput = useCallback(async () => {
    setError(null);
    try {
      dispatch(setUiState({ isBuildingSolverInput: true }));
      const response = await buildSolverInput({
        points,
        couriersText,
        weightsText,
        additionalParamsText,
        manualTauText,
        useManualTau,
        t0Time,
        osrmBaseUrl,
      }).unwrap();
      dispatch(setSolverInput(response.input));
      dispatch(
        setUiState({
          warnings: response.warnings,
          lastSolverInputSignature: currentSignature,
          lastSolverResultSignature: undefined,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      dispatch(setUiState({ isBuildingSolverInput: false }));
    }
  }, [
    additionalParamsText,
    buildSolverInput,
    couriersText,
    dispatch,
    osrmBaseUrl,
    manualTauText,
    useManualTau,
    points,
    t0Time,
    weightsText,
    currentSignature,
  ]);

  const parseSolverPayloadFromClipboard = useCallback(
    (raw: string) => {
      let parsed: unknown;
      let text = raw.trim();

      // Поддержка формата вида {\"inputs\":[...]} без внешних кавычек:
      // в логах/буфере часто встречается именно так.
      if (
        (text.startsWith("{\\\"") || text.startsWith("[\\\""))
        && !text.startsWith('{"')
        && !text.startsWith('["')
      ) {
        text = text.replace(/\\"/g, '"');
      }
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (error) {
        throw new Error(
          `Невалидный JSON в буфере обмена: ${(error as Error).message}`,
        );
      }

      // Разворачиваем вложенные/экранированные JSON-строки:
      // "\"{\\\"inputs\\\": ...}\"" -> "{ \"inputs\": ... }"
      for (let depth = 0; depth < 3; depth += 1) {
        if (typeof parsed !== "string") {
          break;
        }
        const inner = parsed.trim();
        if (
          (inner.startsWith("{") && inner.endsWith("}"))
          || (inner.startsWith("[") && inner.endsWith("]"))
        ) {
          parsed = JSON.parse(inner) as unknown;
        } else {
          break;
        }
      }

      // Если это полный SolverInputPayload
      if (parsed && typeof parsed === "object" && "request" in parsed) {
        return parsed as SolverInputPayload;
      }

      // Если это сырой request (inputs[0].data...)
      if (parsed && typeof parsed === "object" && "inputs" in parsed) {
        const request = parsed as SolverInvocationRequest;
        const firstInput = request.inputs?.[0];
        const data = firstInput?.data as
          | {
              current_timestamp_utc?: string;
              travel_time_matrix_minutes?: number[][];
              orders?: Array<{ order_id?: string; created_at_utc?: string; expected_ready_at_utc?: string }>;
              couriers?: Array<{ courier_id?: string; expected_courier_return_at_utc?: string }>;
              optimization_weights?: Record<string, unknown>;
            }
          | undefined;

        if (!data) {
          throw new Error("request.inputs[0].data отсутствует");
        }

        const t0Iso = data.current_timestamp_utc ?? "";
        const depotPoint = points.find((point) => point.kind === "depot")
          ?? points.find((point) => point.kind === "order");
        if (!depotPoint) {
          throw new Error("На карте нет ни депо, ни заказов — не к чему привязать ответ solver");
        }

        const orderPoints = points.filter((point) => point.kind === "order");
        const pointByExternalId = new Map<string, (typeof orderPoints)[number]>();
        orderPoints.forEach((point) => {
          const key = point.id?.trim();
          if (key) {
            pointByExternalId.set(key, point);
          }
        });

        const pointInternalIds: string[] = [depotPoint.internalId];
        const pointsLatLon: [number, number][] = [[depotPoint.lat, depotPoint.lon]];
        const orderInternalIds: string[] = [];
        const orderExternalIds: string[] = [];
        const ordersAbstime: string[] = [];
        const orderCreatedOffset: number[] = [];
        const orderReadyOffset: number[] = [];

        (data.orders ?? []).forEach((order) => {
          const extId = typeof order.order_id === "string" ? order.order_id.trim() : "";
          if (!extId) {
            return;
          }
          const point = pointByExternalId.get(extId);
          const internalId = point?.internalId ?? extId;
          orderExternalIds.push(extId);
          orderInternalIds.push(internalId);
          pointInternalIds.push(internalId);
          if (point) {
            pointsLatLon.push([point.lat, point.lon]);
          } else {
            pointsLatLon.push([0, 0]);
          }
          const createdIso = order.created_at_utc ?? t0Iso;
          const readyIso = order.expected_ready_at_utc ?? createdIso;
          ordersAbstime.push(readyIso);
          const createdRel = diffMinutes(createdIso, t0Iso);
          const readyRel = diffMinutes(readyIso, t0Iso);
          orderCreatedOffset.push(
            typeof createdRel === "number" && Number.isFinite(createdRel) ? createdRel : 0,
          );
          orderReadyOffset.push(
            typeof readyRel === "number" && Number.isFinite(readyRel) ? readyRel : 0,
          );
        });

        const couriers = data.couriers ?? [];
        const courierExternalIds = couriers.map((courier) => courier.courier_id ?? "").filter(Boolean);
        const couriersAbstime: string[] = [];
        const courierAvailableOffset: number[] = [];
        couriers.forEach((courier) => {
          const availableIso = courier.expected_courier_return_at_utc ?? t0Iso;
          couriersAbstime.push(availableIso);
          const rel = diffMinutes(availableIso, t0Iso);
          courierAvailableOffset.push(
            typeof rel === "number" && Number.isFinite(rel) ? rel : 0,
          );
        });

        return {
          request,
          tau: data.travel_time_matrix_minutes ?? [],
          order_created_offset: orderCreatedOffset,
          order_ready_offset: orderReadyOffset,
          courier_available_offset: courierAvailableOffset,
          meta: {
            pointsLatLon,
            mode: "",
            osrmBaseUrl: "",
            T0_iso: t0Iso,
            pointInternalIds,
            orderInternalIds,
            orderExternalIds,
            courierExternalIds,
            abstime: {
              orders: ordersAbstime,
              couriers: couriersAbstime,
            },
            combinedParams: {
              orders: data.orders ?? [],
              depot: depotPoint,
              weights: data.optimization_weights ?? {},
              couriers,
              additional: {},
            },
          },
        } satisfies SolverInputPayload;
      }

      throw new Error("Ожидается solver_input или request с полем inputs");
    },
    [points],
  );

  const handleImportFromClipboard = useCallback(async () => {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      setToastSeverity("error");
      setToastMessage("Копирование из буфера обмена недоступно в этом браузере");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        throw new Error("Буфер обмена пуст");
      }
      const payload = parseSolverPayloadFromClipboard(text);
      dispatch(setSolverInput(payload));
      dispatch(
        setUiState({
          warnings: [],
          lastSolverInputSignature: undefined,
          lastSolverResultSignature: undefined,
        }),
      );
      setToastSeverity("success");
      setToastMessage("solver_input успешно импортирован из буфера обмена");
    } catch (clipboardError) {
      setToastSeverity("error");
      setToastMessage(
        clipboardError instanceof Error
          ? `Не удалось импортировать solver_input из буфера: ${clipboardError.message}`
          : "Не удалось импортировать solver_input из буфера",
      );
    }
  }, [dispatch, parseSolverPayloadFromClipboard]);

  const handleSolve = useCallback(async () => {
    if (!solverInput) {
      setError("Сначала соберите solver_input");
      return;
    }
    setError(null);
    try {
      dispatch(setUiState({ isSolving: true }));
      const response = await solve({ solverInput }).unwrap();
      dispatch(setSolverResult(response));
      dispatch(applyComputedFields(response.ordersComputed));
      dispatch(setUiState({ lastSolverResultSignature: currentSignature }));
      const latestState = store.getState().mapOrders.data;
      dispatch(pushLog({ state: buildHistorySnapshot(latestState), timestamp: Date.now() }));
      setToastSeverity("success");
      setToastMessage("Ответ от solver успешно получен");
    } catch (err) {
      const rawMessage = extractSolverErrorMessage(err);
      const message =
        rawMessage === "fetch failed"
          ? "Не удалось обратиться к внешнему сервису solver (fetch failed). Проверьте URL и доступность сервиса."
          : rawMessage;
      setError(message);
      setToastSeverity("error");
      setToastMessage(`Ошибка при запросе в solver: ${message}`);
    } finally {
      dispatch(setUiState({ isSolving: false }));
    }
  }, [currentSignature, dispatch, solve, solverInput, store]);

  const handleDownloadSolverInput = useCallback(() => {
    if (!solverInput) {
      return;
    }
    const blob = new Blob([JSON.stringify(solverInput, null, 2)], {
      type: "application/json",
    });
    saveBlobToFile(blob, `solver_input_${new Date().toISOString()}.json`);
  }, [solverInput]);

  const handleResetResult = useCallback(() => {
    dispatch(resetSolverResult());
    dispatch(setUiState({ warnings: [], lastSolverResultSignature: undefined }));
  }, [dispatch]);

  const handleCopyJson = useCallback(
    async (payload: unknown) => {
      if (!payload) {
        return;
      }
      try {
        await navigator.clipboard.writeText(
          typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
        );
      } catch (clipboardError) {
        setError((clipboardError as Error).message);
      }
    },
    [],
  );

  const solverInputPreview = useMemo(
    () => (solverInput ? stringifyWithInlineArrays(solverInput.request) : ""),
    [solverInput],
  );

  const domainResponsePreview = useMemo(
    () => (solverResult?.domainResponse ? stringifyWithInlineArrays(solverResult.domainResponse) : ""),
    [solverResult?.domainResponse],
  );

  const solverResultPreview = useMemo(
    () => (solverResult ? stringifyWithInlineArrays(solverResult) : ""),
    [solverResult],
  );

  const isSolverDataStale = useMemo(() => {
    const staleInput = Boolean(
      lastSolverInputSignature && lastSolverInputSignature !== currentSignature,
    );
    const staleResult = Boolean(
      lastSolverResultSignature &&
        lastSolverResultSignature !== currentSignature,
    );
    return staleInput || staleResult;
  }, [currentSignature, lastSolverInputSignature, lastSolverResultSignature]);

  return (
    <Paper elevation={3} sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" fontWeight={700}>
        Управление solver_input
      </Typography>
      <Stack direction="row" spacing={2}>
        <Button
          variant="contained"
          startIcon={isBuilding ? <CircularProgress size={20} /> : <SettingsInputComponentIcon />}
          onClick={handleBuildSolverInput}
          disabled={isBuilding || points.length === 0 || isFromCpSatLog}
        >
          Собрать вход CP-SAT
        </Button>
        <Button
          variant="outlined"
          startIcon={<ContentPasteGoIcon />}
          onClick={handleImportFromClipboard}
          disabled={false}
        >
          Вставить request из буфера
        </Button>
        <Button
          variant="contained"
          color="success"
          startIcon={isSolving ? <CircularProgress size={20} /> : <PlayArrowIcon />}
          onClick={handleSolve}
          disabled={!solverInput || isSolving}
        >
          Отправить в Solver
        </Button>
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownloadSolverInput}
          disabled={!solverInput}
        >
          Скачать solver_input
        </Button>
        <Button
          variant="outlined"
          color="warning"
          startIcon={<RestartAltIcon />}
          onClick={handleResetResult}
          disabled={!solverResult}
        >
          Сбросить результат
        </Button>
      </Stack>
      {isFromCpSatLog ? (
        <Alert severity="info" variant="outlined">
          Текущие данные импортированы из Enriched CP-SAT Log. Для точного повторного запуска
          решателя загрузите исходный solver_input или сырой request, а не собирайте вход по логу.
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert severity="warning" variant="outlined">
          <Stack spacing={0.75}>
            {warnings.map((warning, index) => (
              <Typography key={index} variant="subtitle1" fontWeight={900}>
                {warning}
              </Typography>
            ))}
          </Stack>
        </Alert>
      ) : null}
      {isSolverDataStale ? (
        <Alert severity="error" variant="filled">
          Текущий solver_input и/или ответ решателя не соответствуют точкам на карте или параметрам —
          пересоберите вход перед отправкой.
        </Alert>
      ) : null}
      {solverInput ? (
        <Accordion disableGutters sx={{ bgcolor: "background.paper" }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              Текущий solver_input.json
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                solver_input.json
              </Typography>
              <Button
                size="small"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={() => handleCopyJson(solverInput.request)}
              >
                Копировать
              </Button>
            </Stack>
            <pre
              style={{
                margin: 0,
                padding: "16px",
                backgroundColor: "#0f0f0f",
                color: "#e0e0e0",
                borderRadius: 8,
                overflowX: "auto",
                fontSize: "0.85rem",
              }}
            >
              {solverInputPreview}
            </pre>
          </AccordionDetails>
        </Accordion>
      ) : null}
      {solverResult?.domainResponse ? (
        <Accordion disableGutters sx={{ bgcolor: "background.paper" }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              Ответ solver&apos;а (сырой)
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                solver_response.json
              </Typography>
              <Button
                size="small"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={() => handleCopyJson(solverResult.domainResponse)}
              >
                Копировать
              </Button>
            </Stack>
            <pre
              style={{
                margin: 0,
                padding: "16px",
                backgroundColor: "#0f0f0f",
                color: "#e0e0e0",
                borderRadius: 8,
                overflowX: "auto",
                fontSize: "0.85rem",
              }}
            >
              {domainResponsePreview}
            </pre>
          </AccordionDetails>
        </Accordion>
      ) : null}
      {solverResult ? (
        <Accordion disableGutters sx={{ bgcolor: "background.paper" }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              Постобработанный ответ (routes, computed)
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                solver_result.json
              </Typography>
              <Button
                size="small"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={() => handleCopyJson(solverResult)}
              >
                Копировать
              </Button>
            </Stack>
            <pre
              style={{
                margin: 0,
                padding: "16px",
                backgroundColor: "#0f0f0f",
                color: "#e0e0e0",
                borderRadius: 8,
                overflowX: "auto",
                fontSize: "0.85rem",
              }}
            >
              {solverResultPreview}
            </pre>
          </AccordionDetails>
        </Accordion>
      ) : null}
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Snackbar
        open={Boolean(toastMessage)}
        autoHideDuration={4000}
        onClose={() => setToastMessage(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={toastSeverity}
          onClose={() => setToastMessage(null)}
          variant="filled"
        >
          {toastMessage}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default SolverControlsWidget;
