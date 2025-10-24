"use client";

import { ChangeEvent, useCallback, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  Paper,
  Snackbar,
  Typography,
  CircularProgress,
} from "@mui/material";
import {
  DataGrid,
  GridActionsCellItem,
  GridColDef,
  GridRowModel,
} from "@mui/x-data-grid";
import type { Feature, FeatureCollection, Point } from "geojson";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import UploadIcon from "@mui/icons-material/Upload";
import { v4 as uuidv4 } from "uuid";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import {
  addPoint,
  replacePoints,
  removePoint,
  updatePoint,
} from "@/features/map-orders/model/mapOrdersSlice";
import { selectPoints } from "@/features/map-orders/model/selectors";
import type { DeliveryPoint } from "@/shared/types/points";

const resolveOrderNumber = (
  point: DeliveryPoint,
): { numeric?: number; label: string } => {
  const raw = point.orderNumber;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { numeric: raw, label: raw.toString() };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      const numeric = Number(trimmed);
      return {
        numeric: Number.isFinite(numeric) ? numeric : undefined,
        label: trimmed,
      };
    }
  }

  const fallback = Number.isFinite(point.seq) ? point.seq : 0;
  return { numeric: fallback, label: fallback.toString() };
};

const comparePointsByOrderNumber = (a: DeliveryPoint, b: DeliveryPoint): number => {
  if (a.kind === "depot" && b.kind !== "depot") {
    return -1;
  }
  if (b.kind === "depot" && a.kind !== "depot") {
    return 1;
  }

  const left = resolveOrderNumber(a);
  const right = resolveOrderNumber(b);

  if (left.numeric !== undefined && right.numeric !== undefined && left.numeric !== right.numeric) {
    return left.numeric - right.numeric;
  }
  if (left.numeric !== undefined && right.numeric === undefined) {
    return -1;
  }
  if (left.numeric === undefined && right.numeric !== undefined) {
    return 1;
  }

  const labelCompare = left.label.localeCompare(right.label, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (labelCompare !== 0) {
    return labelCompare;
  }

  return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" });
};

const columnsBase: GridColDef<DeliveryPoint>[] = [
  {
    field: "orderNumberLeft",
    headerName: "#",
    width: 60,
    editable: false,
    description: "Номер заказа из CP-SAT либо порядковый номер",
    sortable: false,
    valueGetter: (params) => {
      const point = params?.row as DeliveryPoint | undefined;
      if (!point) {
        return "";
      }
      return resolveOrderNumber(point).label;
    },
    renderCell: (params) => {
      const point = params.row as DeliveryPoint;
      return resolveOrderNumber(point).label;
    },
  },
  {
    field: "id",
    headerName: "ID",
    width: 140,
    editable: true,
    description: "Внутренний идентификатор заказа или депо",
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
    description: "Категория точки: депо или заказ",
  },
  {
    field: "lat",
    headerName: "Широта",
    width: 130,
    type: "number",
    editable: true,
    description: "Широта координаты точки",
  },
  {
    field: "lon",
    headerName: "Долгота",
    width: 130,
    type: "number",
    editable: true,
    description: "Долгота координаты точки",
  },
  {
    field: "boxes",
    headerName: "Коробки",
    width: 120,
    type: "number",
    editable: true,
    description: "Количество коробок в заказе",
  },
  {
    field: "createdAt",
    headerName: "Создан",
    width: 140,
    editable: true,
    description: "Время создания заказа (HH:MM:SS)",
  },
  {
    field: "readyAt",
    headerName: "Будет готов",
    width: 140,
    editable: true,
    description: "Время готовности заказа (HH:MM:SS)",
  },
  {
    field: "orderNumber",
    headerName: "#",
    width: 60,
    editable: false,
    description: "Номер заказа из CP-SAT либо порядковый номер",
    sortable: false,
    valueGetter: (params) => {
      const point = params?.row as DeliveryPoint | undefined;
      if (!point) {
        return "";
      }
      return resolveOrderNumber(point).label;
    },
    renderCell: (params) => {
      const point = params.row as DeliveryPoint;
      return resolveOrderNumber(point).label;
    },
  },
  {
    field: "depotDirectMin",
    headerName: "Из депо, мин",
    width: 110,
    type: "number",
    editable: false,
    description: "Время пути от депо до точки по матрице",
  },
  {
    field: "groupId",
    headerName: "Группа",
    width: 110,
    type: "number",
    editable: false,
    description: "Номер маршрута, присвоенный солвером",
  },
  {
    field: "routePos",
    headerName: "Поз. в группе",
    width: 110,
    type: "number",
    editable: false,
    description: "Позиция заказа внутри маршрута",
  },
  {
    field: "etaRelMin",
    headerName: "ETA, мин",
    width: 130,
    type: "number",
    editable: false,
    description: "Ожидаемое прибытие курьера (минуты от старта)",
  },
  {
    field: "plannedC2eMin",
    headerName: "C2E, мин",
    width: 130,
    type: "number",
    editable: false,
    description: "Плановый click-to-eat время",
  },
  {
    field: "skip",
    headerName: "Пропуск",
    width: 110,
    type: "number",
    editable: false,
    description: "Признак, что заказ пропущен (1 — пропуск)",
  },
  {
    field: "cert",
    headerName: "Сертификат",
    width: 130,
    type: "number",
    editable: false,
    description: "Признак необходимости сертификата (1 — требуется)",
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
  const [isImporting, setIsImporting] = useState(false);

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

  const handleImportOrders = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      setIsImporting(true);
      try {
        const text = await file.text();
        const payload = JSON.parse(text) as FeatureCollection;
        if (payload?.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
          throw new Error("Ожидается GeoJSON FeatureCollection");
        }
        const imported: DeliveryPoint[] = payload.features.map((feature: Feature<Point>, index: number) => {
          if (!feature || feature.geometry?.type !== "Point") {
            throw new Error(`Объект ${index + 1} не является точкой`);
          }
          const coordinates = feature.geometry.coordinates ?? [];
          const props = (feature.properties ?? {}) as Record<string, unknown>;
          const kind = props.kind === "depot" ? "depot" : "order";
          const lat = Number(coordinates[1]);
          const lon = Number(coordinates[0]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            throw new Error(`Некорректные координаты у объекта ${index + 1}`);
          }
          const boxes = Number(props.boxes);
          const createdAt = typeof props.created_at === "string" ? props.created_at : "00:00:00";
          const readyAt = typeof props.ready_at === "string" ? props.ready_at : "00:00:00";

          return {
            internalId: uuidv4(),
            id: typeof props.id === "string" ? props.id : `import_${index + 1}`,
            kind,
            seq: 0,
            lat,
            lon,
            boxes: Number.isFinite(boxes) ? boxes : 0,
            createdAt,
            readyAt,
          };
        });

        if (!imported.length) {
          throw new Error("GeoJSON не содержит объектов");
        }

        const nextPoints = [...points, ...imported];
        dispatch(replacePoints(nextPoints));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsImporting(false);
        event.target.value = "";
      }
    },
    [dispatch, points],
  );

  const handleAddOrder = useCallback(() => {
    dispatch(addPoint(createEmptyPoint("order")));
  }, [dispatch]);

  const handleAddDepot = useCallback(() => {
    dispatch(addPoint(createEmptyPoint("depot")));
  }, [dispatch]);

  const sortedPoints = useMemo(
    () =>
      [...points].sort((a, b) => comparePointsByOrderNumber(a, b)),
    [points],
  );

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
          <Button
            variant="text"
            startIcon={isImporting ? <CircularProgress size={16} /> : <UploadIcon />}
            component="label"
            disabled={isImporting}
          >
            Импорт заказов
            <input
              type="file"
              hidden
              accept="application/json,application/geo+json"
              onChange={handleImportOrders}
            />
          </Button>
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
          rows={sortedPoints}
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
