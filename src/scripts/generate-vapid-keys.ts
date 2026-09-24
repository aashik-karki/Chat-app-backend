import webPush from 'web-push';
import { randomBytes } from 'node:crypto';

// Run once: npm run push:vapid  → paste the output into your .env
const { publicKey, privateKey } = webPush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log(`PUSH_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
