"use client";

import { useEffect } from "react";
import { LinearProgress, Box } from "@mui/material";
import { useLoadStateQuery } from "@/shared/api/mapOrdersApi";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { setPersistedState, setUiState } from "@/features/map-orders/model/mapOrdersSlice";
import { StateAutoSaver } from "./StateAutoSaver";

interface Props {
  children: React.ReactNode;
}

export const StateBootstrapper = ({ children }: Props) => {
  const dispatch = useAppDispatch();
  const { data, isFetching, isError, error } = useLoadStateQuery();

  useEffect(() => {
    dispatch(setUiState({ isLoading: isFetching }));
  }, [dispatch, isFetching]);

  useEffect(() => {
    if (data) {
      dispatch(setPersistedState(data));
    }
  }, [data, dispatch]);

  if (isFetching && !data) {
    return (
      <Box sx={{ width: "100%", py: 2 }}>
        <LinearProgress />
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={{ color: "error.main", py: 2 }}>
        Не удалось загрузить состояние: {(error as any)?.data?.error || String(error)}
      </Box>
    );
  }

  return (
    <>
      <StateAutoSaver />
      {children}
    </>
  );
};
