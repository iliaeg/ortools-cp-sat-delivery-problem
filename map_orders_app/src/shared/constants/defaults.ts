import { stringifyWithInlineArrays } from "@/shared/lib/json";

export const DEFAULT_COURIERS = {
  courier_available_offset: [0, 15],
  courier_capacity_boxes: [25, 25],
};

export const DEFAULT_WEIGHTS = {
  certificate_penalty_weight: 15000,
  click_to_eat_interval_starts_minutes: [0, 30, 50, 60, 90],
  click_to_eat_interval_penalty_weight: [30, 40, 80, 120, 240],
  skip_order_penalty_weight: 100000,
  courier_idle_penalty_weight: 1,
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
