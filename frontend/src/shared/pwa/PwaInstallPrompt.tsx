import { useEffect, useState } from 'react';

import { PRACTICE_COMPLETED_EVENT, PRACTICE_COMPLETED_KEY } from './installPrompt';

const DISMISSED_KEY = 'ingles-al-grano:install-dismissed';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    const canOfferInstall = () => {
      try {
        return localStorage.getItem(PRACTICE_COMPLETED_KEY) === 'true'
          && localStorage.getItem(DISMISSED_KEY) !== 'true';
      } catch {
        return false;
      }
    };
    try {
      setEligible(canOfferInstall());
    } catch { /* storage unavailable keeps the custom prompt hidden */ }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onCompleted = () => setEligible(canOfferInstall());
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener(PRACTICE_COMPLETED_EVENT, onCompleted);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener(PRACTICE_COMPLETED_EVENT, onCompleted);
    };
  }, []);

  if (!eligible || !promptEvent) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, 'true'); } catch { /* no-op */ }
    setPromptEvent(null);
  };
  const install = async () => {
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } finally {
      dismiss();
    }
  };

  return (
    <aside aria-label="Instalar Inglés al Grano" className="pwa-install-prompt">
      <div>
        <strong>Practica desde tu inicio</strong>
        <p>Instala Inglés al Grano para abrirlo como app. La práctica sigue necesitando internet.</p>
      </div>
      <div>
        <button onClick={dismiss} type="button">Ahora no</button>
        <button className="pwa-install-accept" onClick={() => void install()} type="button">Instalar</button>
      </div>
    </aside>
  );
}
