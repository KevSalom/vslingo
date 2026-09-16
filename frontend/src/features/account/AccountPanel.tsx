import { useEffect, useState } from 'react';

import {
  loadAccountQuota,
  type AccountQuota,
  type UsageAmounts,
  UsageRequestError,
} from '../../shared/usage/usageClient';

type ResourceKey = keyof UsageAmounts;

const RESOURCES: ReadonlyArray<{
  key: ResourceKey;
  label: string;
  format: (value: number) => string;
}> = [
  { key: 'voice_seconds', label: 'Tiempo de tu voz', format: formatDuration },
  { key: 'voice_turns', label: 'Intervenciones', format: formatNumber },
  { key: 'writings', label: 'Correcciones', format: formatNumber },
  { key: 'videos', label: 'Videos nuevos', format: formatNumber },
];

export function AccountPanel() {
  const [quota, setQuota] = useState<AccountQuota | null>(null);
  const [error, setError] = useState<'expired' | 'unavailable' | null>(null);

  const reload = () => {
    setError(null);
    void loadAccountQuota().then(setQuota).catch((cause: unknown) => {
      setError(cause instanceof UsageRequestError && cause.code === 'access_expired'
        ? 'expired'
        : 'unavailable');
    });
  };

  useEffect(reload, []);

  if (error) {
    return (
      <section className="account-state" role="alert">
        <p>{error === 'expired'
          ? 'Tu periodo de acceso terminó. Tu historial sigue disponible para consultar o borrar.'
          : 'No pudimos cargar tu saldo. Revisa la conexión e inténtalo de nuevo.'}</p>
        {error === 'unavailable' ? (
          <button className="writing-btn writing-btn-primary" onClick={reload} type="button">
            Reintentar
          </button>
        ) : null}
      </section>
    );
  }
  if (!quota) {
    return <p aria-live="polite" className="account-state">Cargando tu saldo…</p>;
  }

  return (
    <section className="account-panel" aria-label="Saldo de la cuenta">
      <header className="account-plan-card">
        <div>
          <span className="account-kicker">{quota.source === 'trial' ? 'Prueba gratuita' : 'Plan mensual'}</span>
          <h2>{quota.source === 'trial' ? 'Tu saldo para probar' : 'Tu periodo actual'}</h2>
        </div>
        <span>{quota.ends_at ? `Hasta ${formatDate(quota.ends_at)}` : 'Sin fecha fija'}</span>
      </header>

      <div className="quota-grid">
        {RESOURCES.map(({ key, label, format }) => {
          const limit = quota.limits[key];
          const remaining = quota.remaining[key];
          const percent = limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
          return (
            <article className="quota-card" key={key}>
              <div>
                <h3>{label}</h3>
                <strong>{format(remaining)}</strong>
                <span>de {format(limit)} disponibles</span>
              </div>
              <div
                aria-label={`${label}: ${Math.round(percent)} por ciento disponible`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(percent)}
                className="quota-progress"
                role="progressbar"
              >
                <span style={{ width: `${percent}%` }} />
              </div>
            </article>
          );
        })}
      </div>
      <p className="account-help">
        La voz se agota al llegar al tiempo o al número de intervenciones. Consultar tu historial no consume saldo.
      </p>
    </section>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function formatNumber(value: number): string {
  return Math.floor(value).toLocaleString('es');
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}
