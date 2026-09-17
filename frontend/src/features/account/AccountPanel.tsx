import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelBillingSubscription,
  confirmBillingPayment,
  loadBillingAccount,
  startBillingCheckout,
  type BillingAccount,
  BillingRequestError,
  type BillingSubscription,
} from './billingClient';
import {
  loadAccountQuota,
  type AccountQuota,
  type UsageAmounts,
  UsageRequestError,
} from '../../shared/usage/usageClient';

type ResourceKey = keyof UsageAmounts;
type PaymentReturnState = 'idle' | 'confirming' | 'confirmed' | 'pending' | 'error';

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
  const [quotaError, setQuotaError] = useState<'expired' | 'unavailable' | null>(null);
  const [billing, setBilling] = useState<BillingAccount | null>(null);
  const [billingError, setBillingError] = useState(false);
  const [action, setAction] = useState<'checkout' | 'cancel' | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [paymentReturn, setPaymentReturn] = useState<PaymentReturnState>('idle');
  const confirmationGeneration = useRef(0);

  const reloadQuota = useCallback(() => {
    setQuotaError(null);
    void loadAccountQuota().then(setQuota).catch((cause: unknown) => {
      setQuota(null);
      setQuotaError(cause instanceof UsageRequestError && cause.code === 'access_expired'
        ? 'expired'
        : 'unavailable');
    });
  }, []);

  const reloadBilling = useCallback(() => {
    setBillingError(false);
    void loadBillingAccount().then(setBilling).catch(() => {
      setBilling(null);
      setBillingError(true);
    });
  }, []);

  const verifyReturnedPayment = useCallback(async () => {
    const generation = confirmationGeneration.current + 1;
    confirmationGeneration.current = generation;
    setPaymentReturn('confirming');
    setBillingError(false);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const updated = await confirmBillingPayment();
        if (confirmationGeneration.current !== generation) return;
        setBilling(updated);
        if (updated.subscription?.access_ends_at) {
          reloadQuota();
          setPaymentReturn('confirmed');
          window.history.replaceState({}, '', window.location.pathname);
          return;
        }
      } catch {
        if (confirmationGeneration.current !== generation) return;
        reloadBilling();
        setPaymentReturn('error');
        return;
      }
      await wait(1_500);
    }

    if (confirmationGeneration.current === generation) {
      setPaymentReturn('pending');
    }
  }, [reloadBilling, reloadQuota]);

  useEffect(() => {
    reloadQuota();
    const query = new URLSearchParams(window.location.search);
    if (query.get('billing') === 'return') {
      void verifyReturnedPayment();
    } else {
      reloadBilling();
    }
    if (query.get('billing') === 'cancelled') {
      setActionMessage('No se realizó ningún cobro. Puedes continuar cuando quieras.');
    }
    return () => {
      confirmationGeneration.current += 1;
    };
  }, [reloadBilling, reloadQuota, verifyReturnedPayment]);

  const beginCheckout = async (replacePending = false) => {
    setAction('checkout');
    setActionMessage('');
    try {
      const checkout = await startBillingCheckout({ replacePending });
      if (!checkout.approval_url) throw new Error('Missing approval URL');
      window.location.assign(checkout.approval_url);
    } catch (cause) {
      setAction(null);
      if (cause instanceof BillingRequestError && cause.code === 'subscription_exists') {
        await verifyReturnedPayment();
        return;
      }
      setActionMessage('No pudimos abrir PayPal. Tu saldo no cambió; inténtalo de nuevo.');
    }
  };

  const cancelRenewal = async () => {
    setAction('cancel');
    setActionMessage('');
    try {
      const updated = await cancelBillingSubscription();
      setBilling(updated);
      setConfirmCancel(false);
      setActionMessage('Renovación cancelada. Conservas el acceso hasta terminar el periodo pagado.');
    } catch {
      setActionMessage('No pudimos confirmar la cancelación. Tu renovación sigue activa.');
    } finally {
      setAction(null);
    }
  };

  return (
    <section className="account-panel" aria-label="Plan y saldo de la cuenta">
      {paymentReturn !== 'idle' ? (
        <div className="account-notice" role={paymentReturn === 'error' ? 'alert' : 'status'}>
          <strong>{paymentReturnTitle(paymentReturn)}</strong>
          <span>{paymentReturnDescription(paymentReturn)}</span>
          {paymentReturn === 'pending' || paymentReturn === 'error' ? (
            <button className="writing-btn" onClick={() => void verifyReturnedPayment()} type="button">
              Verificar pago ahora
            </button>
          ) : null}
        </div>
      ) : null}

      {billing ? (
        <BillingCard
          action={action}
          billing={billing}
          confirmCancel={confirmCancel}
          onCancel={() => setConfirmCancel(true)}
          onCancelAbort={() => setConfirmCancel(false)}
          onCancelConfirm={() => void cancelRenewal()}
          onCheckout={(replacePending) => void beginCheckout(replacePending)}
          onVerify={() => void verifyReturnedPayment()}
        />
      ) : (
        <div className="account-state" role={billingError ? 'alert' : 'status'}>
          <p>{billingError ? 'No pudimos cargar los datos del plan.' : 'Cargando tu plan…'}</p>
          {billingError ? (
            <button className="writing-btn" onClick={reloadBilling} type="button">Reintentar</button>
          ) : null}
        </div>
      )}

      {actionMessage ? <p className="account-action-message" role="status">{actionMessage}</p> : null}

      {quota ? <QuotaCards quota={quota} /> : (
        <div className="account-state" role={quotaError ? 'alert' : 'status'}>
          <p>{quotaError === 'expired'
            ? 'Tu periodo terminó. Tu historial sigue disponible y puedes activar un nuevo periodo arriba.'
            : quotaError === 'unavailable'
              ? 'No pudimos cargar tu saldo. Revisa la conexión e inténtalo de nuevo.'
              : 'Cargando tu saldo…'}</p>
          {quotaError === 'unavailable' ? (
            <button className="writing-btn" onClick={reloadQuota} type="button">Reintentar</button>
          ) : null}
        </div>
      )}

      <p className="account-help">
        La voz se agota al llegar al tiempo o al número de intervenciones. Consultar tu historial no consume saldo.
      </p>
    </section>
  );
}

type BillingCardProps = {
  billing: BillingAccount;
  action: 'checkout' | 'cancel' | null;
  confirmCancel: boolean;
  onCheckout: (replacePending?: boolean) => void;
  onCancel: () => void;
  onCancelAbort: () => void;
  onCancelConfirm: () => void;
  onVerify: () => void;
};

function BillingCard(props: BillingCardProps) {
  const { billing, action, confirmCancel } = props;
  const subscription = billing.subscription;
  const approvalUrl = billing.pending_checkout?.approval_url;
  const isPaid = subscription?.access_ends_at !== null
    && (subscription?.status === 'active' || subscription?.status === 'cancelled');
  const awaitingPayment = subscription?.status === 'active' && !subscription.access_ends_at;
  const canPurchase = !subscription
    || subscription.status === 'expired'
    || (subscription.status === 'cancelled'
      && subscription.access_ends_at !== null
      && new Date(subscription.access_ends_at).getTime() <= Date.now());

  return (
    <article className="billing-card">
      <div className="billing-summary">
        <div>
          <span className="account-kicker">Plan mensual</span>
          <h2>Practica sin complicaciones</h2>
          <p>Voz, escritura y videos con un saldo nuevo en cada pago confirmado.</p>
        </div>
        <strong className="billing-price">
          {formatMoney(billing.offer.price_minor, billing.offer.currency)}
          <span>/mes</span>
        </strong>
      </div>

      <div className="billing-status-row">
        <div>
          <span className={`billing-status billing-status-${subscription?.status ?? 'trial'}`}>
            {subscriptionStatus(subscription)}
          </span>
          <p>{subscription?.access_ends_at
            ? `Acceso hasta ${formatDate(subscription.access_ends_at)}`
            : isPaid ? 'Esperando la fecha del periodo.' : 'No se activará nada hasta confirmar el pago.'}</p>
        </div>

        {canPurchase ? (
          <button
            className="writing-btn writing-btn-primary"
            disabled={action !== null}
            onClick={() => props.onCheckout(false)}
            type="button"
          >
            {action === 'checkout' ? 'Abriendo PayPal…' : 'Activar plan'}
          </button>
        ) : null}
        {approvalUrl && subscription?.status === 'approval_pending' ? (
          <button
            className="writing-btn writing-btn-primary"
            disabled={action !== null}
            onClick={() => props.onCheckout(true)}
            type="button"
          >
            {action === 'checkout' ? 'Abriendo PayPal…' : 'Continuar en PayPal'}
          </button>
        ) : null}
        {awaitingPayment ? (
          <button className="writing-btn writing-btn-primary" onClick={props.onVerify} type="button">
            Verificar pago
          </button>
        ) : null}
        {subscription?.can_cancel && !confirmCancel ? (
          <button className="writing-btn" onClick={props.onCancel} type="button">
            Cancelar renovación
          </button>
        ) : null}
      </div>

      {confirmCancel ? (
        <div className="billing-confirm" role="group" aria-label="Confirmar cancelación">
          <p>No habrá otro cobro. Tu periodo pagado seguirá activo hasta su fecha final.</p>
          <div>
            <button className="writing-btn" disabled={action !== null} onClick={props.onCancelAbort} type="button">
              Conservar renovación
            </button>
            <button className="writing-btn writing-btn-danger" disabled={action !== null} onClick={props.onCancelConfirm} type="button">
              {action === 'cancel' ? 'Cancelando…' : 'Confirmar cancelación'}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function QuotaCards({ quota }: { quota: AccountQuota }) {
  return (
    <>
      <header className="account-plan-card">
        <div>
          <span className="account-kicker">{quota.source === 'trial' ? 'Prueba gratuita' : 'Periodo actual'}</span>
          <h2>{quota.source === 'trial' ? 'Tu saldo para probar' : 'Tu saldo disponible'}</h2>
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
    </>
  );
}

function subscriptionStatus(subscription?: BillingSubscription | null): string {
  if (subscription?.status === 'active' && subscription.access_ends_at) return 'Activo';
  if (subscription?.status === 'active') return 'Confirmando pago';
  if (subscription?.status === 'approval_pending' || subscription?.status === 'approved') return 'Pendiente de pago';
  if (subscription?.status === 'suspended') return 'Pago pendiente';
  if (subscription?.status === 'cancelled') return 'Renovación cancelada';
  if (subscription?.status === 'expired') return 'Periodo terminado';
  return 'Prueba gratuita';
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

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('es', { style: 'currency', currency }).format(minor / 100);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

function paymentReturnTitle(state: PaymentReturnState): string {
  if (state === 'confirmed') return 'Pago confirmado.';
  if (state === 'pending') return 'PayPal todavía está procesando el pago.';
  if (state === 'error') return 'No pudimos verificar el pago.';
  return 'Estamos confirmando tu pago.';
}

function paymentReturnDescription(state: PaymentReturnState): string {
  if (state === 'confirmed') return 'Tu plan mensual y tu nuevo saldo ya están activos.';
  if (state === 'pending') return 'Tu saldo no cambiará hasta encontrar una transacción confirmada.';
  if (state === 'error') return 'Tu saldo no cambió. Puedes reintentar la consulta segura a PayPal.';
  return 'Consultaremos directamente a PayPal; normalmente tarda solo unos segundos.';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
