const {
  capacitorOrigins,
  defaultAllowedOrigins,
  isAllowedOrigin,
  parseAllowedOrigins,
} = require('../../src/utils/corsOrigin');

describe('corsOrigin', () => {
  describe('parseAllowedOrigins', () => {
    it('falls back to the default list when the env var is empty', () => {
      expect(parseAllowedOrigins(undefined)).toEqual(defaultAllowedOrigins);
      expect(parseAllowedOrigins('')).toEqual(defaultAllowedOrigins);
    });

    it('normalizes trim, quotes and trailing slash', () => {
      expect(parseAllowedOrigins(' "https://rh.omnipunt.com/" , ,https://x.com ')).toEqual([
        'https://rh.omnipunt.com',
        'https://x.com',
      ]);
    });
  });

  describe('isAllowedOrigin in production', () => {
    const production = { isProduction: true };
    // Producao real: a VPS define CORS_ALLOWED_ORIGINS, entao a lista default e
    // ignorada por inteiro.
    const allowedOrigins = parseAllowedOrigins('https://omnipunt.com,https://app.omnipunt.com');

    it('accepts the Android Capacitor origin', () => {
      expect(isAllowedOrigin('https://localhost', allowedOrigins, production)).toBe(true);
    });

    it('accepts the iOS Capacitor origin', () => {
      expect(isAllowedOrigin('capacitor://localhost', allowedOrigins, production)).toBe(true);
    });

    it('accepts an origin coming from CORS_ALLOWED_ORIGINS', () => {
      expect(isAllowedOrigin('https://app.omnipunt.com', allowedOrigins, production)).toBe(true);
    });

    it('rejects an unknown domain', () => {
      expect(isAllowedOrigin('https://evil.example.com', allowedOrigins, production)).toBe(false);
    });

    it('rejects lookalikes of the Capacitor origins', () => {
      expect(isAllowedOrigin('https://localhost.evil.com', allowedOrigins, production)).toBe(false);
      expect(isAllowedOrigin('http://localhost', allowedOrigins, production)).toBe(false);
      expect(isAllowedOrigin('https://localhost:5173', allowedOrigins, production)).toBe(false);
      expect(isAllowedOrigin('capacitor://evil.com', allowedOrigins, production)).toBe(false);
    });

    it('still allows a missing origin', () => {
      expect(isAllowedOrigin(undefined, allowedOrigins, production)).toBe(true);
      expect(isAllowedOrigin('', allowedOrigins, production)).toBe(true);
    });

    it('normalizes a trailing slash on the incoming origin', () => {
      expect(isAllowedOrigin('https://localhost/', allowedOrigins, production)).toBe(true);
      expect(isAllowedOrigin(' https://app.omnipunt.com/ ', allowedOrigins, production)).toBe(true);
    });

    it('does not fall back to the localhost bypass', () => {
      expect(isAllowedOrigin('http://localhost:5173', allowedOrigins, production)).toBe(false);
      expect(isAllowedOrigin('http://127.0.0.1:3000', allowedOrigins, production)).toBe(false);
    });
  });

  describe('isAllowedOrigin outside production', () => {
    const allowedOrigins = parseAllowedOrigins('https://omnipunt.com');

    it('keeps the localhost bypass on any port', () => {
      expect(isAllowedOrigin('http://localhost:5173', allowedOrigins, { isProduction: false })).toBe(true);
      expect(isAllowedOrigin('http://127.0.0.1:4173', allowedOrigins, {})).toBe(true);
    });

    it('still rejects a random domain', () => {
      expect(isAllowedOrigin('https://evil.example.com', allowedOrigins, {})).toBe(false);
    });
  });

  it('embeds exactly the two Capacitor platform origins', () => {
    expect(capacitorOrigins).toEqual(['https://localhost', 'capacitor://localhost']);
    expect(defaultAllowedOrigins).not.toEqual(expect.arrayContaining(capacitorOrigins));
  });
});
