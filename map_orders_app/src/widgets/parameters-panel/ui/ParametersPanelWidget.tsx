"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import CircularProgress from "@mui/material/CircularProgress";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import {
  selectControlTexts,
  selectLastSavedAt,
  selectUiFlags,
} from "@/features/map-orders/model/selectors";
import {
  setAdditionalParamsText,
  setCouriersText,
  setManualTauText,
  setOsrmBaseUrl,
  setT0Time,
  setUseManualTau,
  setWeightsText,
} from "@/features/map-orders/model/mapOrdersSlice";
import { stringifyWithInlineArrays } from "@/shared/lib/json";

const formatJson = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    return stringifyWithInlineArrays(parsed);
  } catch (error) {
    throw new Error(`Ошибка форматирования: ${(error as Error).message}`);
  }
};

const ParametersPanelWidget = () => {
  const dispatch = useAppDispatch();
  const {
    couriersText,
    weightsText,
    additionalParamsText,
    manualTauText,
    useManualTau,
    t0Time,
    osrmBaseUrl,
  } =
    useAppSelector(selectControlTexts);
  const lastSavedAt = useAppSelector(selectLastSavedAt);
  const { isSaving } = useAppSelector(selectUiFlags);
  const [error, setError] = useState<string | null>(null);

  const todayIsoUtc = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const handleBeautifyCouriers = useCallback(() => {
    try {
      dispatch(setCouriersText(formatJson(couriersText)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [couriersText, dispatch]);

  const handleBeautifyTau = useCallback(() => {
    if (!useManualTau) {
      return;
    }
    try {
      dispatch(setManualTauText(formatJson(manualTauText)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [dispatch, manualTauText, useManualTau]);

  const handleBeautifyWeights = useCallback(() => {
    try {
      dispatch(setWeightsText(formatJson(weightsText)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [weightsText, dispatch]);

  const handleBeautifyAdditional = useCallback(() => {
    try {
      dispatch(setAdditionalParamsText(formatJson(additionalParamsText)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [additionalParamsText, dispatch]);

  return (
    <Paper elevation={3} sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" fontWeight={700}>
          Параметры решателя
        </Typography>
        <Stack direction="row" gap={1} alignItems="center" color="text.secondary">
          {isSaving ? <CircularProgress size={16} /> : <ContentCopyIcon fontSize="small" />}
          <Typography variant="body2">
            {isSaving ? "Сохраняем изменения" : lastSavedAt ? `Сохранено ${lastSavedAt}` : "Ещё не сохранялось"}
          </Typography>
        </Stack>
      </Stack>
      <TextField
        label="OSRM Base URL"
        value={osrmBaseUrl}
        onChange={(event) => dispatch(setOsrmBaseUrl(event.target.value))}
      />
      <TextField
        label="Текущее время"
        value={t0Time}
        onChange={(event) => dispatch(setT0Time(event.target.value))}
        helperText={`Формат HH:MM:SS · Текущая дата (UTC): ${todayIsoUtc}`}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={useManualTau}
            onChange={(_event, checked) => dispatch(setUseManualTau(checked))}
          />
        }
        label="Задать матрицу времени вручную"
      />
      <TextField
        label="Матрица времени между точками"
        value={manualTauText}
        onChange={(event) => dispatch(setManualTauText(event.target.value))}
        multiline
        minRows={6}
        disabled={!useManualTau}
        InputProps={{ readOnly: !useManualTau }}
        helperText="Матрица пути (депо → заказы). Для Enriched CP-SAT log индексы совпадают с точками на карте."
      />
      <Stack direction="row" spacing={1}>
        <Button
          onClick={handleBeautifyTau}
          startIcon={<CleaningServicesIcon />}
          disabled={!useManualTau}
        >
          Форматировать
        </Button>
        <Button
          onClick={() => dispatch(setManualTauText(""))}
          startIcon={<DeleteSweepIcon />}
          disabled={!useManualTau}
        >
          Очистить
        </Button>
      </Stack>
      <TextField
        label="Курьеры"
        value={couriersText}
        onChange={(event) => dispatch(setCouriersText(event.target.value))}
        multiline
        minRows={4}
      />
      <Stack direction="row" spacing={1}>
        <Button onClick={handleBeautifyCouriers} startIcon={<CleaningServicesIcon />}>
          Форматировать
        </Button>
        <Button onClick={() => dispatch(setCouriersText(""))} startIcon={<DeleteSweepIcon />}>
          Очистить
        </Button>
      </Stack>
      <TextField
        label="Весовые коэффициенты"
        value={weightsText}
        onChange={(event) => dispatch(setWeightsText(event.target.value))}
        multiline
        minRows={4}
      />
      <Button onClick={handleBeautifyWeights} startIcon={<CleaningServicesIcon />}>
        Форматировать
      </Button>
      <TextField
        label="Дополнительные параметры"
        value={additionalParamsText}
        onChange={(event) => dispatch(setAdditionalParamsText(event.target.value))}
        multiline
        minRows={4}
      />
      <Button onClick={handleBeautifyAdditional} startIcon={<CleaningServicesIcon />}>
        Форматировать
      </Button>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
    </Paper>
  );
};

export default ParametersPanelWidget;
