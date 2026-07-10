const relayOrigin = document.documentElement.dataset.relayOrigin ?? '';
const status = document.getElementById('status');
const relay = document.getElementById('relay-origin');

if (status) status.textContent = 'Bundle loaded';
if (relay) relay.textContent = relayOrigin || 'Missing relay origin';
