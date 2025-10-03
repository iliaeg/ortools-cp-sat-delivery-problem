import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  SolverInputResponse,
  SolverSolveResponse,
} from "@/shared/types/solver";
import type { MapOrdersPersistedState } from "@/shared/types/points";

export interface BuildSolverInputRequest {
  points: MapOrdersPersistedState["points"];
  couriersText: string;
  weightsText: string;
  additionalParamsText: string;
  t0Time: string;
  osrmBaseUrl: string;
}

export interface SolveRequest {
  solverInput: unknown;
}

export const mapOrdersApi = createApi({
  reducerPath: "mapOrdersApi",
  baseQuery: fetchBaseQuery({
    baseUrl: "/api/map-orders",
    prepareHeaders: (headers) => headers,
  }),
  tagTypes: ["State", "SolverInput", "SolverResult"],
  endpoints: (builder) => ({
    loadState: builder.query<MapOrdersPersistedState, void>({
      query: () => ({ url: "/state", method: "GET" }),
      providesTags: ["State"],
    }),
    saveState: builder.mutation<MapOrdersPersistedState, Partial<MapOrdersPersistedState>>({
      query: (body) => ({
        url: "/state",
        method: "PUT",
        body,
      }),
      invalidatesTags: ["State"],
    }),
    buildSolverInput: builder.mutation<SolverInputResponse, BuildSolverInputRequest>({
      query: (body) => ({
        url: "/solver-input",
        method: "POST",
        body,
      }),
      invalidatesTags: ["SolverInput"],
    }),
    solve: builder.mutation<SolverSolveResponse, SolveRequest>({
      query: (body) => ({
        url: "/solve",
        method: "POST",
        body,
      }),
      invalidatesTags: ["SolverResult"],
    }),
    exportGeoJson: builder.mutation<Blob, void>({
      queryFn: async (_, _queryApi, _extra, fetchWithBQ) => {
        const response = await fetchWithBQ({
          url: "/export/geojson",
          method: "GET",
          responseHandler: async (res) => res.blob(),
        });
        if (response.error) {
          return { error: response.error };
        }
        return { data: response.data as Blob };
      },
    }),
    exportCase: builder.mutation<Blob, void>({
      queryFn: async (_, _queryApi, _extra, fetchWithBQ) => {
        const response = await fetchWithBQ({
          url: "/export/case",
          method: "GET",
          responseHandler: async (res) => res.blob(),
        });
        if (response.error) {
          return { error: response.error };
        }
        return { data: response.data as Blob };
      },
    }),
    importCase: builder.mutation<MapOrdersPersistedState, FormData>({
      query: (body) => ({
        url: "/import/case",
        method: "POST",
        body,
      }),
    }),
    importSolverInput: builder.mutation<MapOrdersPersistedState, FormData>({
      query: (body) => ({
        url: "/import/solver-input",
        method: "POST",
        body,
      }),
    }),
  }),
});

export const {
  useLoadStateQuery,
  useLazyLoadStateQuery,
  useSaveStateMutation,
  useBuildSolverInputMutation,
  useSolveMutation,
  useExportGeoJsonMutation,
  useExportCaseMutation,
  useImportCaseMutation,
  useImportSolverInputMutation,
} = mapOrdersApi;
