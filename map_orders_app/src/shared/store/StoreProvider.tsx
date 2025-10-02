"use client";

import { PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { store } from "@/shared/store";

export const StoreProvider = ({ children }: PropsWithChildren) => (
  <Provider store={store}>{children}</Provider>
);
