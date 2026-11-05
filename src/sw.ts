import { version as appVersion } from '../package.json';

// export default null
declare let self: ServiceWorkerGlobalScope;

const buildRevision = '__SUPERSPLAT_BUILD_REVISION__';
const cacheName = `superSplat-v${appVersion}-${buildRevision}`;

const cacheUrls = [
    './',
    './index.css',
    './index.html',
    './index.js',
    './index.js.map',
    './manifest.json',
    './static/icons/logo-192.png',
    './static/icons/logo-512.png',
    './static/images/screenshot-narrow.jpg',
    './static/images/screenshot-wide.jpg',
    './static/lib/webp/webp.mjs',
    './static/lib/webp/webp.wasm',
    './static/locales/de.json',
    './static/locales/en.json',
    './static/locales/fr.json',
    './static/locales/ja.json',
    './static/locales/ko.json',
    './static/locales/zh-CN.json'
];

self.addEventListener('install', (event) => {
    console.log(`installing v${appVersion} build ${buildRevision}`);

    // create cache for current version
    event.waitUntil(
        caches.open(cacheName)
        .then(cache => cache.addAll(cacheUrls))
        .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    console.log(`activating v${appVersion} build ${buildRevision}`);

    // delete the old caches once this one is activated
    event.waitUntil(caches.keys().then(names => Promise.all(
        names.filter(name => name.startsWith('superSplat-v') && name !== cacheName)
        .map(name => caches.delete(name))
    )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.open(cacheName).then(cache => cache.match(event.request))
        .then(response => response ?? fetch(event.request))
    );
});
