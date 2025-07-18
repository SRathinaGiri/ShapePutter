const CACHE_NAME = 'shape-putter-v1';
const assetsToCache = [
    '/',
    'index.html',
    'rules.html',
    'style.css',
    'game.js',
    'images/icon-192.png',
    'images/icon-512.png',
    'sounds/click.mp3',
    'sounds/clack.mp3',
    'sounds/swoosh.mp3',
    'sounds/plonk.mp3',
    'sounds/life.mp3'
];

// Install event: cache all assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(assetsToCache);
            })
    );
});

// Fetch event: serve assets from cache if available
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request);
            })
    );
});