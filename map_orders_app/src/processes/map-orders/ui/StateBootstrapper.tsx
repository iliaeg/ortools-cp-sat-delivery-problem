"use client";

import { useEffect, useRef } from "react";
import { LinearProgress, Box } from "@mui/material";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { SerializedError } from "@reduxjs/toolkit";
import { useLoadStateQuery } from "@/shared/api/mapOrdersApi";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import {
  initialPersistedState,
  setPersistedState,
  setUiState,
} from "@/features/map-orders/model/mapOrdersSlice";
import type { MapOrdersPersistedState } from "@/shared/types/points";
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
    if ("error" in error && typeof error.error === "string") {
      return error.error;
    }

    if (
      "data" in error &&
      error.data &&
      typeof error.data === "object" &&
      "error" in (error.data as Record<string, unknown>)
    ) {
      const data = error.data as { error?: unknown };
      if (typeof data.error === "string") {
        return data.error;
      }
    }

    return `HTTP ${error.status}`;
  }

  if (error.message) {
    return error.message;
  }

  return "Неизвестная ошибка";
};

export const StateBootstrapper = ({ children }: Props) => {
  const dispatch = useAppDispatch();
  const { data, isFetching, isError, error } = useLoadStateQuery();
  const lastAppliedSignature = useRef<string | null>(null);

  useEffect(() => {
    dispatch(setUiState({ isLoading: isFetching }));
  }, [dispatch, isFetching]);

  useEffect(() => {
    const applyState = (payload: MapOrdersPersistedState) => {
      const signature = JSON.stringify(payload);
      if (signature === lastAppliedSignature.current) {
        return;
      }
      lastAppliedSignature.current = signature;
      dispatch(setPersistedState(payload));
    };

    if (data) {
      applyState(data);
    } else if (!isFetching) {
      applyState(initialPersistedState);
    }
  }, [data, dispatch, isFetching]);

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
