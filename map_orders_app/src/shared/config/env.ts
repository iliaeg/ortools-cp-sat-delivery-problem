export const getClientEnv = () => ({
  osrmBaseUrl:
    process.env.NEXT_PUBLIC_OSRM_BASE_URL?.trim() || "http://localhost:5563",
  solverUrl:
    process.env.NEXT_PUBLIC_SOLVER_URL?.trim() || "http://127.0.0.1:8000/solve-internal",
});

export const getServerEnv = () => ({
  osrmBaseUrl: process.env.OSRM_BASE_URL?.trim() || "http://localhost:5563",
  solverUrl: process.env.SOLVER_URL?.trim() || "http://127.0.0.1:8000/solve-internal",
  stateFilePath:
    process.env.MAP_ORDERS_STATE_PATH?.trim() || "./data/map_orders_state.json",
});
