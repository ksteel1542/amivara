import { createVerify, generateKeyPairSync } from 'node:crypto';

import { FcmPushSender } from './push-sender';

describe('FcmPushSender (FCM HTTP v1 without firebase-admin)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const creds = {
    projectId: 'amivara-test',
    clientEmail: 'push@amivara-test.iam.gserviceaccount.com',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  function fakeFetch(fcmStatus = 200, fcmBody = '{}') {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
      }
      return new Response(fcmBody, { status: fcmStatus });
    }) as typeof fetch;
    return { impl, calls };
  }

  it('exchanges a signed service-account JWT for an access token, then sends', async () => {
    const http = fakeFetch();
    const sender = new FcmPushSender(creds, http.impl);
    const result = await sender.send('device-token', {
      notification: { title: "It's a match ✦", body: 'You have a new match on AMIVARA.' },
      data: { type: 'match.created', match_id: 'm-1' },
    });
    expect(result).toBe('sent');

    // 1. OAuth: a valid RS256 assertion for the FCM scope.
    const assertion = new URLSearchParams(http.calls[0].init.body as URLSearchParams).get('assertion')!;
    const [header, payload, signature] = assertion.split('.');
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, signature, 'base64url');
    expect(verified).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims).toMatchObject({
      iss: creds.clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });

    // 2. Send: v1 endpoint, bearer token, private lock-screen visibility.
    expect(http.calls[1].url).toBe('https://fcm.googleapis.com/v1/projects/amivara-test/messages:send');
    expect((http.calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
    const body = JSON.parse(http.calls[1].init.body as string);
    expect(body.message).toMatchObject({
      token: 'device-token',
      data: { type: 'match.created', match_id: 'm-1' },
      android: { priority: 'high', notification: { visibility: 'PRIVATE' } },
    });
  });

  it('reuses the access token until it nears expiry', async () => {
    const http = fakeFetch();
    const sender = new FcmPushSender(creds, http.impl);
    await sender.send('t1', { data: { type: 'x' } });
    await sender.send('t2', { data: { type: 'x' } });
    expect(http.calls.filter((c) => c.url.includes('oauth2')).length).toBe(1);
  });

  it('sends data-only messages without a visible notification', async () => {
    const http = fakeFetch();
    await new FcmPushSender(creds, http.impl).send('t', { data: { type: 'match.removed', match_id: 'm' } });
    const body = JSON.parse(http.calls[1].init.body as string);
    expect(body.message.notification).toBeUndefined();
    expect(body.message.android).toEqual({ priority: 'normal' });
  });

  it('reports dead tokens as unregistered', async () => {
    const http = fakeFetch(404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}');
    expect(await new FcmPushSender(creds, http.impl).send('gone', { data: {} })).toBe('unregistered');
  });

  it('reports other failures without throwing', async () => {
    const http = fakeFetch(500, 'oops');
    expect(await new FcmPushSender(creds, http.impl).send('t', { data: {} })).toBe('failed');
  });
});
