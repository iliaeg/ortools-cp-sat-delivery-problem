import { createTheme, responsiveFontSizes } from "@mui/material/styles";

const baseTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#90caf9",
    },
    secondary: {
      main: "#ffb74d",
    },
    background: {
      default: "#121212",
      paper: "#1f1f1f",
    },
    text: {
      primary: "#e0e0e0",
      secondary: "#b0b0b0",
    },
  },
  typography: {
    fontFamily: ["Roboto", "Helvetica", "Arial", "sans-serif"].join(","),
    body1: {
      color: "#e0e0e0",
    },
    body2: {
      color: "#b0b0b0",
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#121212",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 8,
        },
      },
    },
  },
});

export const appTheme = responsiveFontSizes(baseTheme);
