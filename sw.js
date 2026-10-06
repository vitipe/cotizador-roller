/* =====================================================================
   sw.js — Service worker del Cotizador Roller
   ---------------------------------------------------------------------
   · Guarda todos los archivos de la app para que funcione sin internet.
   · index.html: primero red (para recibir versiones nuevas), si no hay
     conexión usa la copia guardada.
   · Resto de archivos: primero caché.

   CADA VEZ QUE PUBLIQUES CAMBIOS, SUBÍ EL NÚMERO DE VERSIÓN:
   roller-v1 → roller-v2 → roller-v3 ...
   Así el navegador detecta la versión nueva y la app muestra
   "Hay una actualización disponible".
   ===================================================================== */

const CACHE = 'roller-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './calc.js',
  './storage.js',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

// Instalación: guarda todos los archivos. No hace skipWaiting solo:
// espera a que el usuario toque "Recargar" en el aviso.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
  );
});

// Activación: borra las cachés de versiones anteriores y toma el control.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

// Mensajes desde la app.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: CACHE });
});

function esIndex(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

// Network-first: intenta la red y actualiza la copia; sin red, usa la caché.
async function primeroRed(request) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) cache.put('./index.html', resp.clone());
    return resp;
  } catch (e) {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

// Cache-first: usa la copia guardada; si no está, la baja y la guarda.
async function primeroCache(request) {
  const cache = await caches.open(CACHE);
  const guardada = await cache.match(request, { ignoreSearch: true });
  if (guardada) return guardada;
  const resp = await fetch(request);
  if (resp && resp.ok && resp.type === 'basic') cache.put(request, resp.clone());
  return resp;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return; // ej: wa.me
  event.respondWith(esIndex(request) ? primeroRed(request) : primeroCache(request));
});
