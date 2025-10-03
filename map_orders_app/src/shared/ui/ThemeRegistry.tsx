"use client";

import { PropsWithChildren } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { appTheme } from "@/shared/config/theme";

export const ThemeRegistry = ({ children }: PropsWithChildren) => (
  <ThemeProvider theme={appTheme}>
    <CssBaseline />
    {children}
  </ThemeProvider>
);
