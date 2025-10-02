"use client";

import { useEffect } from "react";
import { LinearProgress, Box } from "@mui/material";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { SerializedError } from "@reduxjs/toolkit";
import { useLoadStateQuery } from "@/shared/api/mapOrdersApi";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { setPersistedState, setUiState } from "@/features/map-orders/model/mapOrdersSlice";
import { StateAutoSaver } from "./StateAutoSaver";

interface Props {
  children: React.ReactNode;
}

const parseErrorMessage = (
  error: FetchBaseQueryError | SerializedError | undefined,
): string => {
  if (!error) {
    return "Неизвестная ошибка";
  }
  if ("status" in error) {
    if (typeof error.error === "string") {
      return error.error;
    }
    if (error.data && typeof error.data === "object" && "error" in error.data) {
      const data = error.data as { error?: unknown };
      if (typeof data.error === "string") {
        return data.error;
      }
    }
  }
  if ("message" in error && error.message) {
    return error.message as string;
  }
  return "Неизвестная ошибка";
};

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
        Не удалось загрузить состояние: {parseErrorMessage(error)}
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
