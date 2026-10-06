import {
  API_PREFIX,
  CSRF_HEADER,
  ROUTE_PATH,
  type AdminAccountsResponse,
  type AdminEventsResponse,
  type AdminOverview,
  type PowChallenge,
  type PowSolution,
  type RouteResponse,
  type ApiError,
  type CreateEventBody,
  type MapStatusResponse,
  type AdminLoadStatus,
  type DegradationLevel,
  type MeResponse,
  type PublicEvent,
  type VoteResponse,
  type ZoneEventsResponse,
} from '@safeway/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 8000;

async function request<T>(method: string, path: string, body?: unknown, anonymous = false): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_PREFIX + path, {
      method,
      // Requêtes anonymes (itinéraire) : le cookie de session n'est jamais envoyé.
      credentials: anonymous ? 'omit' : 'same-origin',
      signal: controller.signal,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { [CSRF_HEADER]: '1' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Réseau indisponible.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (!res.ok) {
    throw new ApiRequestError(res.status, data.error ?? 'error', data.message ?? messageFor(res.status));
  }
  return data;
}

function messageFor(status: number): string {
  if (status === 401) return 'Connexion requise.';
  if (status === 429) return 'Trop de requêtes, patientez un instant.';
  if (status >= 500) return 'Service momentanément indisponible.';
  return 'Requête refusée.';
}

export const api = {
  me: () => request<MeResponse>('GET', '/me'),
  updatePseudo: (pseudo: string) => request<MeResponse>('PATCH', '/me/pseudo', { pseudo }),
  deleteAccount: () => request<void>('DELETE', '/me'),
  logout: () => request<void>('POST', '/auth/logout'),

  powChallenge: () => request<PowChallenge>('GET', '/auth/pow'),
  registerOptions: (pseudo: string, pow: PowSolution) =>
    request<unknown>('POST', '/auth/passkey/register/options', { pseudo, pow }),
  registerVerify: (response: unknown) => request<MeResponse>('POST', '/auth/passkey/register/verify', response),
  loginOptions: () => request<unknown>('POST', '/auth/passkey/login/options', {}),
  loginVerify: (response: unknown) => request<MeResponse>('POST', '/auth/passkey/login/verify', response),

  mapStatus: () => request<MapStatusResponse>('GET', '/map/status'),
  zoneEvents: (zone: string) => request<ZoneEventsResponse>('GET', `/map/zones/${encodeURIComponent(zone)}`),

  report: (body: CreateEventBody) => request<{ event: PublicEvent; created: boolean }>('POST', '/events', body),
  confirm: (id: string, presenceCell: string) =>
    request<VoteResponse>('POST', `/events/${encodeURIComponent(id)}/confirm`, { presenceCell }),
  invalidate: (id: string, presenceCell: string) =>
    request<VoteResponse>('POST', `/events/${encodeURIComponent(id)}/invalidate`, { presenceCell }),

  admin: {
    overview: () => request<AdminOverview>('GET', '/admin/overview'),
    events: () => request<AdminEventsResponse>('GET', '/admin/events'),
    removeEvent: (id: string) => request<void>('DELETE', `/admin/events/${encodeURIComponent(id)}`),
    accounts: () => request<AdminAccountsResponse>('GET', '/admin/accounts'),
    suspend: (pseudo: string) => request<void>('POST', '/admin/accounts/suspend', { pseudo }),
    unsuspend: (pseudo: string) => request<void>('POST', '/admin/accounts/unsuspend', { pseudo }),
    setLoad: (level: DegradationLevel | null, minutes = 60) =>
      request<AdminLoadStatus>('POST', '/admin/load', { level, minutes }),
  },

  /** Itinéraire : coordonnées précises indispensables, mais requête anonyme et jamais conservée. */
  route: (from: [number, number], to: [number, number]) =>
    request<RouteResponse>('POST', ROUTE_PATH.slice(API_PREFIX.length), { from, to }, true),
};
