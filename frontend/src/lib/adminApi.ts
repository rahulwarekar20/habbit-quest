/** Operator session kept only in memory. Never reads, clears or writes family credentials. */
export interface AdminSession { access_token: string; expires_in: number; username: string; token_type: string }
export interface TokenomicsPolicy {
  revision: number; daily_credits: number; enforce_budgets: boolean; show_costs: boolean;
  reference_usd_per_credit: number | string; operator_cap_usd: number | string;
  weights: Record<string, number>; updated_at?: string;
}
export interface AdminPrice {
  id?: string; provider: string; model: string; api_mode?: string; service_tier?: string;
  region?: string; context_band?: string; status?: string; source_url?: string; verified_at?: string;
  kind?: "chat" | "embedding" | "search"; input_rate?: number | string | null; cached_input_rate?: number | string | null;
  cache_write_rate?: number | string | null; output_rate?: number | string | null; read_unit_rate?: number | string | null;
  egress_rate?: number | string | null; [key: string]: unknown;
}
export type AdminRecord = Record<string, unknown>;
export class AdminError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export async function adminRequest<T>(path: string, token?: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "")}/v1/admin${path}`, {
      method, credentials: "omit", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new AdminError(0, "Could not reach the admin service. Please try again."); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new AdminError(response.status, typeof data?.detail === "string" ? data.detail : response.status === 401 ? "Your admin session ended. Please sign in again." : "The admin request could not be completed.");
  return data as T;
}

export const adminLogin = (username: string, password: string) => adminRequest<AdminSession>("/auth/login", undefined, "POST", { username, password });
