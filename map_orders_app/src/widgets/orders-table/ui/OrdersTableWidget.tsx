"use client";

import { useCallback } from "react";
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { v4 as uuidv4 } from "uuid";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import { addPoint, removePoint } from "@/features/map-orders/model/mapOrdersSlice";
import { selectPoints } from "@/features/map-orders/model/selectors";
import type { DeliveryPoint } from "@/shared/types/points";

const columns: Array<{ field: keyof DeliveryPoint; label: string }> = [
  { field: "seq", label: "#" },
  { field: "routePos", label: "Позиция в маршруте" },
  { field: "id", label: "ID" },
  { field: "kind", label: "Тип" },
  { field: "lat", label: "Широта" },
  { field: "lon", label: "Долгота" },
  { field: "boxes", label: "Коробки" },
  { field: "createdAt", label: "Создан" },
  { field: "readyAt", label: "Готов" },
  { field: "groupId", label: "Группа" },
  { field: "etaRelMin", label: "ETA, мин" },
  { field: "plannedC2eMin", label: "C2E, мин" },
  { field: "skip", label: "Пропуск" },
  { field: "cert", label: "Сертификат" },
];

const formatValue = (value: DeliveryPoint[keyof DeliveryPoint]) => {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
};

const buildLine = (point: DeliveryPoint) =>
  columns
    .map((column) => `${column.label}: ${formatValue(point[column.field])}`)
    .join(" | ");

const createEmptyPoint = (kind: DeliveryPoint["kind"]): DeliveryPoint => ({
  internalId: uuidv4(),
  id: "",
  kind,
  seq: 0,
  lat: 52.9676,
  lon: 36.0693,
  boxes: 0,
  createdAt: "00:00:00",
  readyAt: "00:00:00",
});

const OrdersTableWidget = () => {
  const dispatch = useAppDispatch();
  const points = useAppSelector(selectPoints);

  const handleAddOrder = useCallback(() => {
    dispatch(addPoint(createEmptyPoint("order")));
  }, [dispatch]);

  const handleAddDepot = useCallback(() => {
    dispatch(addPoint(createEmptyPoint("depot")));
  }, [dispatch]);

  return (
    <Paper
      elevation={3}
      sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", gap: 2 }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" fontWeight={700}>
          Таблица заказов
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAddDepot}>
            Добавить депо
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddOrder}>
            Добавить заказ
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Всего точек: {points.length}
      </Typography>
      <Box sx={{ flexGrow: 1, overflow: "auto" }}>
        {points.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Нет точек
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {points.map((point) => (
              <Stack
                key={point.internalId}
                data-testid="orders-row"
                direction="row"
                spacing={1}
                alignItems="center"
                justifyContent="space-between"
              >
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: "pre-wrap", flexGrow: 1 }}
                >
                  {buildLine(point)}
                </Typography>
                <IconButton
                  aria-label="Удалить"
                  color="error"
                  onClick={() => dispatch(removePoint(point.internalId))}
                  size="small"
                >
                  <DeleteIcon fontSize="inherit" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
};

export default OrdersTableWidget;
