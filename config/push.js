const fs = require('fs');
const path = require('path');
const os = require('os');
const webPush = require('web-push');

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@vancare.advan.id';

if (publicKey && privateKey) {
  webPush.setVapidDetails(subject, publicKey, privateKey);
}

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const dataDir = isServerless
  ? path.join(os.tmpdir(), 'vancare_data')
  : path.join(__dirname, '..', 'data');
const subscriptionsFile = path.join(dataDir, 'push_subscriptions.json');
let inMemorySubscriptions = [];

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(subscriptionsFile)) {
    fs.writeFileSync(subscriptionsFile, JSON.stringify([], null, 2));
  }
}

function readSubscriptions() {
  try {
    ensureStore();
    inMemorySubscriptions = JSON.parse(fs.readFileSync(subscriptionsFile, 'utf8'));
  } catch (error) {
    console.warn('[Web Push] Gagal membaca subscription:', error.message);
  }
  return inMemorySubscriptions;
}

function writeSubscriptions(subscriptions) {
  inMemorySubscriptions = subscriptions;
  try {
    ensureStore();
    fs.writeFileSync(subscriptionsFile, JSON.stringify(subscriptions, null, 2));
  } catch (error) {
    console.warn('[Web Push] Gagal menyimpan subscription:', error.message);
  }
}

function saveSubscription(subscription) {
  if (!subscription || typeof subscription.endpoint !== 'string' ||
      !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error('Data subscription Web Push tidak valid.');
  }

  const subscriptions = readSubscriptions();
  const next = subscriptions.filter(item => item.endpoint !== subscription.endpoint);
  next.push({
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    },
    createdAt: new Date().toISOString()
  });
  writeSubscriptions(next);
  return next.length;
}

function removeSubscription(subscription) {
  const endpoint = typeof subscription === 'string'
    ? subscription
    : subscription?.endpoint;
  if (!endpoint) return 0;

  const next = readSubscriptions().filter(item => item.endpoint !== endpoint);
  writeSubscriptions(next);
  return next.length;
}

async function sendPushNotification(payload) {
  if (!publicKey || !privateKey) {
    console.warn('[Web Push] VAPID belum dikonfigurasi.');
    return { sent: 0, removed: 0 };
  }

  let sent = 0;
  let removed = 0;
  const subscriptions = readSubscriptions();
  const expiredEndpoints = [];

  await Promise.all(subscriptions.map(async subscription => {
    try {
      await webPush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 60 * 60
      });
      sent++;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        expiredEndpoints.push(subscription.endpoint);
      } else {
        console.error('[Web Push] Gagal mengirim:', error.message);
      }
    }
  }));

  if (expiredEndpoints.length > 0) {
    removed = expiredEndpoints.length;
    writeSubscriptions(
      subscriptions.filter(subscription => !expiredEndpoints.includes(subscription.endpoint))
    );
  }

  return { sent, removed };
}

module.exports = {
  publicKey,
  saveSubscription,
  removeSubscription,
  sendPushNotification
};
