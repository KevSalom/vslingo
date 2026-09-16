import { useEffect, useState } from 'react';

import {
  loadMarketingConfig,
  saveAccountMarketingConsent,
  saveVisitorConsent,
  sendPageView,
  type MarketingConfig,
} from './marketingClient';

const DECISION_KEY = 'ingles-al-grano:marketing-consent';
const VISITOR_KEY = 'ingles-al-grano:visitor-id';
export const ROUTE_CHANGE_EVENT = 'ingles-al-grano:route-change';

type StoredDecision = {
  allowed: boolean;
  policyVersion: string;
};

export function MarketingConsent({ authenticated = false }: { authenticated?: boolean }) {
  const [config, setConfig] = useState<MarketingConfig | null>(null);
  const [decision, setDecision] = useState<StoredDecision | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadMarketingConfig().then((loaded) => {
      setConfig(loaded);
      setDecision(readDecision(loaded.policy_version));
    }).catch(() => setConfig({ enabled: false, policy_version: '' }));
  }, []);

  useEffect(() => {
    if (!config?.enabled || !decision) return;
    const visitorId = getVisitorId();
    void saveVisitorConsent(visitorId, decision.allowed);
    if (authenticated) void saveAccountMarketingConsent(decision.allowed);
    if (!decision.allowed) return;

    const track = () => {
      const route = allowedRoute(window.location.pathname);
      if (route) void sendPageView(visitorId, route);
    };
    track();
    window.addEventListener('popstate', track);
    window.addEventListener(ROUTE_CHANGE_EVENT, track);
    return () => {
      window.removeEventListener('popstate', track);
      window.removeEventListener(ROUTE_CHANGE_EVENT, track);
    };
  }, [authenticated, config, decision]);

  if (!config?.enabled || decision) return null;

  const choose = async (allowed: boolean) => {
    setSaving(true);
    setError('');
    const next = { allowed, policyVersion: config.policy_version };
    try {
      await saveVisitorConsent(getVisitorId(), allowed);
      if (authenticated) await saveAccountMarketingConsent(allowed);
      storeDecision(next);
      setDecision(next);
    } catch {
      setError('No pudimos guardar tu elección. No se enviará medición.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside aria-label="Preferencia de medición" className="marketing-consent">
      <div>
        <strong>¿Nos ayudas a medir qué funciona?</strong>
        <p>La medición es opcional. Nunca enviamos audio, textos, notas ni feedback.</p>
        {error ? <p className="marketing-consent-error" role="alert">{error}</p> : null}
      </div>
      <div className="marketing-consent-actions">
        <button disabled={saving} onClick={() => void choose(false)} type="button">No, gracias</button>
        <button className="marketing-consent-accept" disabled={saving} onClick={() => void choose(true)} type="button">
          {saving ? 'Guardando…' : 'Permitir medición'}
        </button>
      </div>
    </aside>
  );
}

function readDecision(policyVersion: string): StoredDecision | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(DECISION_KEY) ?? 'null') as unknown;
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'allowed' in parsed
      && typeof parsed.allowed === 'boolean'
      && 'policyVersion' in parsed
      && parsed.policyVersion === policyVersion
    ) return { allowed: parsed.allowed, policyVersion };
  } catch {
    // Invalid or unavailable storage means consent is still pending.
  }
  return null;
}

function storeDecision(decision: StoredDecision): void {
  try { localStorage.setItem(DECISION_KEY, JSON.stringify(decision)); } catch { /* no-op */ }
}

function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function allowedRoute(pathname: string): string | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return ['/', '/demo', '/app', '/app/hablar', '/app/escribir', '/app/videos', '/app/cuenta']
    .includes(normalized) ? normalized : null;
}
