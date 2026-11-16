import type { ConfigService } from '@nestjs/config';
import { TokenVerifier } from 'livekit-server-sdk';

import type { Env } from '../../config/env';
import { LiveKitMediaProvider } from './call-media';

const settings: Partial<Env> = {
  LIVEKIT_URL: 'wss://amivara.livekit.example',
  LIVEKIT_API_KEY: 'APItestkey',
  LIVEKIT_API_SECRET: 'a-test-secret-that-is-long-enough-for-hs256',
};
const config = (values: Partial<Env>) =>
  ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

describe('LiveKitMediaProvider', () => {
  it('is unavailable until the URL, key and secret are all set', () => {
    expect(new LiveKitMediaProvider(config({})).configured).toBe(false);
    expect(new LiveKitMediaProvider(config({ ...settings, LIVEKIT_API_SECRET: undefined })).configured).toBe(false);
    expect(new LiveKitMediaProvider(config(settings)).configured).toBe(true);
  });

  it('voice tokens can publish the microphone only; video adds the camera; one room each', async () => {
    const provider = new LiveKitMediaProvider(config(settings));
    const verifier = new TokenVerifier(settings.LIVEKIT_API_KEY!, settings.LIVEKIT_API_SECRET!);

    const voice = await provider.joinToken({ room: 'call_1', identity: 'member-a', video: false });
    expect(voice.url).toBe(settings.LIVEKIT_URL);
    const v = await verifier.verify(voice.token);
    expect(v.sub).toBe('member-a');
    expect(v.video).toMatchObject({ roomJoin: true, room: 'call_1', canPublishData: false });
    expect(v.video?.canPublishSources).toEqual(['microphone']);

    const videoToken = (await provider.joinToken({ room: 'call_2', identity: 'member-b', video: true })).token;
    const video = await verifier.verify(videoToken);
    expect(video.video).toMatchObject({ room: 'call_2' });
    expect(video.video?.canPublishSources).toEqual(['microphone', 'camera']);
    // Short-lived: only long enough to connect.
    const payload = JSON.parse(Buffer.from(videoToken.split('.')[1]!, 'base64url').toString()) as {
      exp: number;
      nbf: number;
    };
    expect(payload.exp - payload.nbf).toBeLessThanOrEqual(600);
  });

  it('refuses webhooks that are not signed with the API secret', async () => {
    const provider = new LiveKitMediaProvider(config(settings));
    await expect(provider.parseWebhook('{"event":"room_finished"}', 'forged')).rejects.toThrow();
  });
});
