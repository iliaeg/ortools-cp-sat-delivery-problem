"use client";

import { useEffect, useRef } from "react";
import { useSaveStateMutation } from "@/shared/api/mapOrdersApi";
import { useAppDispatch } from "@/shared/hooks/useAppDispatch";
import { useAppSelector } from "@/shared/hooks/useAppSelector";
import { selectMapOrdersState } from "@/features/map-orders/model/selectors";
import { setLastSavedAt, setUiState } from "@/features/map-orders/model/mapOrdersSlice";

export const StateAutoSaver = () => {
  const dispatch = useAppDispatch();
  const mapOrdersState = useAppSelector(selectMapOrdersState);
  const [saveState] = useSaveStateMutation();
  const lastSavedSnapshot = useRef<string>("");

  const serialised = JSON.stringify({
    ...mapOrdersState.data,
    lastSavedAtIso: undefined,
  });

  useEffect(() => {
    if (serialised === lastSavedSnapshot.current) {
      return;
    }
    dispatch(setUiState({ isSaving: true }));
    const timer = setTimeout(async () => {
      try {
        const response = await saveState(mapOrdersState.data).unwrap();
        lastSavedSnapshot.current = JSON.stringify({
          ...response,
          lastSavedAtIso: undefined,
        });
        dispatch(setLastSavedAt(response.lastSavedAtIso));
        dispatch(setUiState({ isSaving: false }));
      } catch (error) {
        dispatch(setUiState({ isSaving: false }));
        console.error("State autosave failed", error);
      }
    }, 800);

    return () => {
      clearTimeout(timer);
      dispatch(setUiState({ isSaving: false }));
    };
  }, [dispatch, mapOrdersState.data, saveState, serialised]);

  return null;
};
