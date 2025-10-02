import { Container, Grid, Stack } from "@mui/material";
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
          <Grid container spacing={3}>
            <Grid item xs={12} md={6} lg={5}>
              <ParametersPanelWidget />
            </Grid>
            <Grid item xs={12} md={6} lg={7}>
              <SolverControlsWidget />
            </Grid>
          </Grid>
          <Grid container spacing={3}>
            <Grid item xs={12} md={5}>
              <MapOrdersWidget />
            </Grid>
            <Grid item xs={12} md={7}>
              <OrdersTableWidget />
            </Grid>
          </Grid>
        </Stack>
      </StateBootstrapper>
    </Container>
  );
}
