export const ROUTE_COLORS = [
  "#1976d2",
  "#ed6c02",
  "#9c27b0",
  "#2e7d32",
  "#f44336",
  "#00838f",
  "#5d4037",
  "#0288d1",
];

export const getRouteColor = (groupId: number) =>
  ROUTE_COLORS[groupId % ROUTE_COLORS.length];
