import { stringifyWithInlineArrays } from "@/shared/lib/json";

export const DEFAULT_COURIERS = {
  courier_available_offset: [0, 15],
  courier_capacity_boxes: [25, 25],
};

export const DEFAULT_WEIGHTS = {
  W_cert: 1000,
  W_c2e: 1,
  W_c2e_ready: 1,
  W_idle: 0,
  W_skip: 10000,
};

export const DEFAULT_ADDITIONAL_PARAMS = {
  time_limit: 3,
};

export const DEFAULT_COURIERS_TEXT = stringifyWithInlineArrays(DEFAULT_COURIERS);
export const DEFAULT_WEIGHTS_TEXT = stringifyWithInlineArrays(DEFAULT_WEIGHTS);
export const DEFAULT_ADDITIONAL_PARAMS_TEXT = stringifyWithInlineArrays(
  DEFAULT_ADDITIONAL_PARAMS,
);

export const ensureDefaultText = (
  value: string | null | undefined,
  fallback: string,
): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim().length ? value : fallback;
};
