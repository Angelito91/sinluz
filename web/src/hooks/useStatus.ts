import useSWR from "swr";
import { getCatalog, getStatus, type CatalogCircuit, type StatusPayload } from "../lib/api";

export function useStatus() {
  const { data, error, isLoading, isValidating } = useSWR<StatusPayload>("status", getStatus, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
    errorRetryCount: 3,
    errorRetryInterval: 15_000,
    shouldRetryOnError: true,
  });
  return { status: data, error: error as Error | undefined, isLoading, isValidating };
}

export function useCatalog() {
  const { data } = useSWR<CatalogCircuit[]>("catalog", getCatalog, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 60 * 60 * 1000,
  });
  return data;
}
