export function SessionLoading({ preferences = false }: { preferences?: boolean }) {
  return (
    <main className="auth-gate auth-loading" aria-label={preferences ? 'Cargando tus preferencias' : 'Preparando tu sesión'}>
      <div className="auth-loading-symbol" aria-hidden="true">
        <img src="/app-icon.svg?v=grain-2" alt="" width="44" height="44" />
        <span className="auth-loading-ring" />
      </div>
      <p className="auth-gate-kicker">Inglés al Grano</p>
      <h1>{preferences ? 'Todo a tu gusto.' : 'Tu práctica está por empezar.'}</h1>
      <p role="status">{preferences ? 'Cargando tus preferencias…' : 'Preparando tu sesión…'}</p>
      <div className="auth-loading-bars" aria-hidden="true"><span /><span /><span /></div>
    </main>
  );
}
