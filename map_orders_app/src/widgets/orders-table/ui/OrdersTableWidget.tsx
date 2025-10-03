"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import {
  DataGrid,
  GridActionsCellItem,
  GridColDef,
  GridRowModel,
} from "@mui/x-data-grid";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { v4 as uuidv4 } from "uuid";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import {
  addPoint,
  removePoint,
  updatePoint,
} from "@/features/map-orders/model/mapOrdersSlice";
import { selectPoints } from "@/features/map-orders/model/selectors";
import type { DeliveryPoint } from "@/shared/types/points";

const columnsBase: GridColDef<DeliveryPoint>[] = [
  {
    field: "seq",
    headerName: "#",
    width: 60,
    editable: false,
  },
  {
    field: "id",
    headerName: "ID",
    width: 140,
    editable: true,
  },
  {
    field: "kind",
    headerName: "Тип",
    width: 120,
    editable: true,
    type: "singleSelect",
    valueOptions: [
      { value: "depot", label: "депо" },
      { value: "order", label: "заказ" },
    ],
  },
  {
    field: "lat",
    headerName: "Широта",
    width: 130,
    type: "number",
    editable: true,
  },
  {
    field: "lon",
    headerName: "Долгота",
    width: 130,
    type: "number",
    editable: true,
  },
  {
    field: "boxes",
    headerName: "Коробки",
    width: 120,
    type: "number",
    editable: true,
  },
  {
    field: "createdAt",
    headerName: "Создан",
    width: 140,
    editable: true,
  },
  {
    field: "readyAt",
    headerName: "Будет готов",
    width: 140,
    editable: true,
  },
  {
    field: "depotDirectMin",
    headerName: "Из депо, мин",
    width: 110,
    type: "number",
    editable: false,
  },
  {
    field: "groupId",
    headerName: "Группа",
    width: 110,
    type: "number",
    editable: false,
  },
  {
    field: "routePos",
    headerName: "Поз. в группе",
    width: 110,
    type: "number",
    editable: false,
  },
  {
    field: "etaRelMin",
    headerName: "ETA, мин",
    width: 130,
    type: "number",
    editable: false,
  },
  {
    field: "plannedC2eMin",
    headerName: "C2E, мин",
    width: 130,
    type: "number",
    editable: false,
  },
  {
    field: "skip",
    headerName: "Пропуск",
    width: 110,
    type: "number",
    editable: false,
  },
  {
    field: "cert",
    headerName: "Сертификат",
    width: 130,
    type: "number",
    editable: false,
  },
];

const timePattern = /^\d{2}:\d{2}:\d{2}$/;

const validatePoint = (point: DeliveryPoint) => {
  if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) {
    throw new Error("Координаты вне диапазона");
  }
  if (!timePattern.test(point.createdAt) || !timePattern.test(point.readyAt)) {
    throw new Error("Формат времени HH:MM:SS");
  }
};

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
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo(() => {
    const base = [...columnsBase];
    const actions: GridColDef<DeliveryPoint> = {
      field: "actions",
      headerName: "",
      type: "actions",
      width: 80,
      getActions: (params) => [
        <GridActionsCellItem
          key="delete"
          icon={<DeleteIcon />}
          label="Удалить"
          onClick={() => dispatch(removePoint(params.row.internalId))}
          color="inherit"
        />,
      ],
    };
    base.push(actions);
    return base;
  }, [dispatch]);

  const processRowUpdate = useCallback(
    async (newRow: GridRowModel<DeliveryPoint>) => {
      const updated = newRow as DeliveryPoint;
      validatePoint(updated);
      dispatch(
        updatePoint({
          internalId: updated.internalId,
          patch: updated,
        }),
      );
      return updated;
    },
    [dispatch],
  );

  const handleProcessError = useCallback((err: Error) => {
    setError(err.message);
  }, []);

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
      <Box sx={{ flexGrow: 1 }}>
        <DataGrid
          rows={points}
          columns={columns}
          getRowId={(row) => row.internalId}
          getRowClassName={({ row }) => (row.kind === "depot" ? "orders-table__row--depot" : "")}
          disableColumnMenu
          disableColumnSelector
          disableDensitySelector
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={handleProcessError}
        />
      </Box>
      <Snackbar
        open={Boolean(error)}
        autoHideDuration={4000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default OrdersTableWidget;
