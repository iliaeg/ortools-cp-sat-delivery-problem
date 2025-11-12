import { NextResponse } from "next/server";
import { mapSolverResult } from "@/processes/map-orders/lib/solverResultMapper";
import { getServerEnv } from "@/shared/config/env";
import type { SolverInputPayload } from "@/shared/types/solver";
import {
  convertDomainResultToSolverResult,
  deriveMetricsFromDomain,
  extractDomainResponse,
  mergeMetrics,
  normalizeMetrics,
  normalizeStatusLabel,
} from "./solverResponseMapper";

const { solverUrl } = getServerEnv();

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const solverInput = payload.solverInput as SolverInputPayload | undefined;
    if (!solverInput) {
      throw new Error("solverInput не передан");
    }

    const response = await fetch(solverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solverInput.request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Solver вернул ${response.status}: ${text}`);
    }

    const rawResult = await response.json();
    const domainResult = extractDomainResponse(rawResult);
    const solverResultPayload = convertDomainResultToSolverResult(domainResult, solverInput);
    const mapped = mapSolverResult({ solverInput, solverResult: solverResultPayload });
    const providedMetrics = normalizeMetrics(domainResult.metrics);
    const derivedMetrics = deriveMetricsFromDomain(domainResult);
    const metricsSummary = mergeMetrics(providedMetrics, derivedMetrics);

    return NextResponse.json({
      ...mapped,
      cpSatStatus: normalizeStatusLabel(domainResult.status),
      cpSatMetrics: metricsSummary,
      domainResponse: domainResult,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
