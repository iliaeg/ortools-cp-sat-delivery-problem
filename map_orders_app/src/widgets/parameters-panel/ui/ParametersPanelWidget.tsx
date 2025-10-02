"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import { format } from "date-fns";
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
  setOsrmBaseUrl,
  setT0Time,
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
  const { couriersText, weightsText, additionalParamsText, t0Time, osrmBaseUrl } =
    useAppSelector(selectControlTexts);
  const lastSavedAt = useAppSelector(selectLastSavedAt);
  const { isSaving } = useAppSelector(selectUiFlags);
  const [error, setError] = useState<string | null>(null);

  const todayIso = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const handleBeautifyCouriers = useCallback(() => {
    try {
      dispatch(setCouriersText(formatJson(couriersText)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [couriersText, dispatch]);

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
      <TextField
        label="T0 (HH:MM:SS)"
        value={t0Time}
        onChange={(event) => dispatch(setT0Time(event.target.value))}
        helperText={`Текущая дата: ${todayIso}`}
      />
      <TextField
        label="OSRM Base URL"
        value={osrmBaseUrl}
        onChange={(event) => dispatch(setOsrmBaseUrl(event.target.value))}
      />
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
    </Paper>
  );
};

export default ParametersPanelWidget;
