import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface LogSnapshot {
  state: string;
  timestamp: number;
  signature?: string;
}

export interface LogsHistoryState {
  entries: LogSnapshot[];
  index: number;
}

const MAX_HISTORY = 100;

const initialState: LogsHistoryState = {
  entries: [],
  index: -1,
};

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    entries.forEach(([key, entryValue]) => {
      if (key === "internalId") {
        return;
      }
      result[key] = sanitizeValue(entryValue);
    });
    return result;
  }
  return value;
};

const computeSignature = (serializedState: string): string => {
  try {
    const parsed = JSON.parse(serializedState);
    return JSON.stringify(sanitizeValue(parsed));
  } catch {
    return serializedState;
  }
};

const withSignature = (snapshot: LogSnapshot): LogSnapshot => {
  if (snapshot.signature) {
    return snapshot;
  }
  return { ...snapshot, signature: computeSignature(snapshot.state) };
};

const logsHistorySlice = createSlice({
  name: "logsHistory",
  initialState,
  reducers: {
    pushLog(state, action: PayloadAction<LogSnapshot>) {
      const snapshots = state.entries.slice(0, state.index + 1).map(withSignature);
      const nextSignature = computeSignature(action.payload.state);
      if (snapshots.length > 0) {
        const last = snapshots[snapshots.length - 1];
        if (last.signature === nextSignature) {
          state.entries = snapshots;
          state.index = snapshots.length - 1;
          return;
        }
      }
      snapshots.push({ ...action.payload, signature: nextSignature });
      if (snapshots.length > MAX_HISTORY) {
        snapshots.splice(0, snapshots.length - MAX_HISTORY);
      }
      state.entries = snapshots;
      state.index = snapshots.length - 1;
    },
    goBack(state) {
      if (state.index > 0) {
        state.index -= 1;
      }
    },
    goForward(state) {
      if (state.index < state.entries.length - 1) {
        state.index += 1;
      }
    },
    resetHistory() {
      return initialState;
    },
  },
});

export const { pushLog, goBack, goForward, resetHistory } = logsHistorySlice.actions;

export default logsHistorySlice.reducer;
