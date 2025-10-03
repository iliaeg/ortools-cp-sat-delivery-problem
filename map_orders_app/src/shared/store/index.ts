import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import mapOrdersReducer from "@/features/map-orders/model/mapOrdersSlice";
import { mapOrdersApi } from "@/shared/api/mapOrdersApi";

export const makeStore = () =>
  configureStore({
    reducer: {
      mapOrders: mapOrdersReducer,
      [mapOrdersApi.reducerPath]: mapOrdersApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }).concat(mapOrdersApi.middleware),
  });

export const store = makeStore();

setupListeners(store.dispatch);

export type AppStore = typeof store;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
