import { detectContactSharing } from './contact-detector';

describe('detectContactSharing (off-platform contact exchange)', () => {
  it.each([
    ['Call me 08031234567', 'phone'],
    ['my number is 0803 123 4567', 'phone'],
    ['0803-123-4567 abeg', 'phone'],
    ['0.8.0.3.1.2.3.4.5.6.7', 'phone'],
    ['+234 803 123 4567', 'phone'],
    ['2348031234567', 'phone'],
    ['8031234567', 'phone'],
    ['07012345678 or 09012345678', 'phone'],
    ['+44 7700 900123', 'phone'],
    ['zero eight zero three one two three four five six seven', 'phone'],
    ['ada.obi@gmail.com', 'email'],
    ['ada.obi at gmail dot com', 'email'],
    ['ada(at)yahoo(dot)com', 'email'],
    ['follow me @ada_obi', 'handle'],
    ['add me on WhatsApp', 'whatsapp'],
    ['wa.me/2348031234567', 'whatsapp'],
    ['send me a watsap message', 'whatsapp'],
    ['what is your IG?', 'instagram'],
    ['my insta is adaobi', 'instagram'],
    ['you get Snapchat?', 'snapchat'],
    ['join my telegram', 'telegram'],
    ['t.me/adaobi', 'telegram'],
    ['dm me on tiktok', 'other_app'],
  ])('flags %p as %s', (text, signal) => {
    expect(detectContactSharing(text)).toContain(signal);
  });

  it.each([
    'Hello! How was your day?',
    'I paid ₦50,000 for the ticket',
    'Meet at 12:30 on 14/11/2026?',
    'I was born in 1998',
    'Score was 3-1, what a match',
    'The room is 304, floor 2',
    'I love jollof rice and suya',
    'He said one or two things',
    'Call me when you get home', // no number, no app
    'Are you on the island this weekend?',
  ])('does not flag ordinary chat: %p', (text) => {
    expect(detectContactSharing(text)).toEqual([]);
  });

  it('reports every signal at once', () => {
    expect(detectContactSharing('WhatsApp me on 08031234567 or ada@mail.com').sort()).toEqual(
      ['email', 'phone', 'whatsapp'].sort(),
    );
  });
});
