import { ReturnUrlValidator } from './return-url.validator';

describe('ReturnUrlValidator', () => {
  const validator = new ReturnUrlValidator();

  it('accepts localhost http URLs', () => {
    const result = validator.validate('http://localhost:4200/callback');
    expect(result.ok).toBe(true);
  });

  it('accepts any https origin', () => {
    const result = validator.validate('https://example.com/callback');
    expect(result.ok).toBe(true);
  });

  it('rejects javascript URLs', () => {
    const result = validator.validate('javascript:alert(1)');
    expect(result.ok).toBe(false);
  });

  it('rejects plain http non-localhost URLs', () => {
    const result = validator.validate('http://example.com/callback');
    expect(result.ok).toBe(false);
  });

  it('merges query params into existing returnUrl search', () => {
    const url = new URL('http://localhost:4200/demo-caller?existing=1');
    const redirect = validator.buildRedirectUrl(url, {
      scanValue: 'ABC',
      format: 'QR_CODE',
      state: 'demo1',
    });
    const parsed = new URL(redirect);
    expect(parsed.searchParams.get('existing')).toBe('1');
    expect(parsed.searchParams.get('scanValue')).toBe('ABC');
    expect(parsed.searchParams.get('format')).toBe('QR_CODE');
    expect(parsed.searchParams.get('state')).toBe('demo1');
  });

  it('puts query params inside hash for hash-based return URLs', () => {
    const url = new URL('http://localhost:4200/#/demo-caller');
    const redirect = validator.buildRedirectUrl(url, {
      scanValue: 'XYZ',
      format: 'EAN_13',
      state: 'demo1',
    });
    expect(redirect).toBe(
      'http://localhost:4200/#/demo-caller?scanValue=XYZ&format=EAN_13&state=demo1',
    );
  });
});
