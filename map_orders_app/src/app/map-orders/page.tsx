import { Box, Container, Stack } from "@mui/material";
import { MapOrdersWidget } from "@/widgets/map";
import { OrdersTableWidget } from "@/widgets/orders-table";
import { ParametersPanelWidget } from "@/widgets/parameters-panel";
import { SolverControlsWidget } from "@/widgets/solver-controls";
import { StateBootstrapper } from "@/processes/map-orders/ui/StateBootstrapper";

export default function MapOrdersPage() {
  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <StateBootstrapper>
        <Stack spacing={3}>
          <Box
            sx={{
              display: "grid",
              gap: 3,
              gridTemplateColumns: {
                xs: "1fr",
                md: "repeat(2, minmax(0, 1fr))",
              },
            }}
          >
            <ParametersPanelWidget />
            <SolverControlsWidget />
          </Box>
          <Box
            sx={{
              display: "grid",
              gap: 3,
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(320px, 480px) minmax(0, 1fr)",
              },
            }}
          >
            <MapOrdersWidget />
            <OrdersTableWidget />
          </Box>
        </Stack>
      </StateBootstrapper>
    </Container>
  );
}
