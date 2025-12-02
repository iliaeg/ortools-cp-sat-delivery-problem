"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SettingsInputComponentIcon from "@mui/icons-material/SettingsInputComponent";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DownloadIcon from "@mui/icons-material/Download";
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
  const warnings = useAppSelector(selectWarnings);
  const { lastSolverInputSignature, lastSolverResultSignature } =
    useAppSelector(selectSolverSignatures);
  const store = useStore<RootState>();
  const [buildSolverInput, { isLoading: isBuilding }]
    = useBuildSolverInputMutation();
  const [solve, { isLoading: isSolving }]
    = useSolveMutation();
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError((err as Error).message);
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
          disabled={isBuilding || points.length === 0}
        >
          Собрать вход CP-SAT
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
    </Paper>
  );
};

export default SolverControlsWidget;
