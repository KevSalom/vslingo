import { authenticatedFetch } from '../auth/sessionClient';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

export type MarketingConfig = { enabled: boolean; policy_version: string };

export async function loadMarketingConfig(): Promise<MarketingConfig> {
  const response = await fetch(`${baseUrl()}/api/marketing/config`);
  if (!response.ok) throw new Error('Marketing config unavailable');
  return response.json() as Promise<MarketingConfig>;
}

export async function saveVisitorConsent(
  visitorId: string,
  analyticsAllowed: boolean,
): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/marketing/visitor-consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitor_id: visitorId, analytics_allowed: analyticsAllowed }),
  });
  if (!response.ok) throw new Error('Consent unavailable');
}

export async function saveAccountMarketingConsent(analyticsAllowed: boolean): Promise<void> {
  const response = await authenticatedFetch(fetch, `${baseUrl()}/api/account/marketing-consent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analytics_allowed: analyticsAllowed }),
  });
  if (!response.ok) throw new Error('Account consent unavailable');
}

export async function sendPageView(visitorId: string, route: string): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/marketing/page-view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitor_id: visitorId,
      event_id: crypto.randomUUID(),
      route,
    }),
  });
  if (!response.ok) throw new Error('Page view unavailable');
}

function baseUrl(): string {
  return API_BASE_URL.replace(/\/$/, '');
}
