module.exports = {
  ci: {
    collect: {
      // El build es estático; Python sirve `dist` de forma aislada para LHCI en Windows.
      // `astro preview` llega a iniciar, pero Chrome de LHCI recibe un interstitial local.
      startServerCommand: 'python -u -m http.server 4321 --bind 127.0.0.1 --directory dist',
      startServerReadyPattern: 'Serving HTTP',
      startServerReadyTimeout: 30000,
      url: ['http://127.0.0.1:4321/'],
      numberOfRuns: 1,
      settings: {
        chromeFlags: '--no-proxy-server --proxy-bypass-list=<-loopback> --disable-features=HttpsUpgrades',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
      },
    },
  },
};
