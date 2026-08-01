import { Service } from '@angular/core';

export type ReturnUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

@Service()
export class ReturnUrlValidator {
  validate(returnUrl: string | null | undefined): ReturnUrlValidation {
    if (!returnUrl?.trim()) {
      return { ok: false, reason: 'Missing returnUrl.' };
    }

    let url: URL;
    try {
      url = new URL(returnUrl);
    } catch {
      return { ok: false, reason: 'returnUrl is invalid.' };
    }

    const isLocalHttp =
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');

    // Allow any https origin (and localhost http for local apps).
    // Still reject javascript:, data:, and other non-http(s) schemes.
    if (url.protocol !== 'https:' && !isLocalHttp) {
      return {
        ok: false,
        reason: 'Only https URLs are allowed (plus http://localhost for local development).',
      };
    }

    return { ok: true, url };
  }

  buildRedirectUrl(
    returnUrl: URL,
    params: { scanValue?: string; format?: string; state?: string | null; error?: string },
  ): string {
    // Hash-based return URLs (e.g. https://host/app/#/demo-caller) must carry
    // query params in the hash, or Angular Router will not see them.
    if (returnUrl.hash.startsWith('#/')) {
      const hashWithoutSharp = returnUrl.hash.slice(1);
      const qIndex = hashWithoutSharp.indexOf('?');
      const hashPath =
        qIndex >= 0 ? hashWithoutSharp.slice(0, qIndex) : hashWithoutSharp;
      const existingQuery =
        qIndex >= 0 ? hashWithoutSharp.slice(qIndex + 1) : '';
      const search = new URLSearchParams(existingQuery);
      this.applyParams(search, params);

      const qs = search.toString();
      return `${returnUrl.origin}${returnUrl.pathname}${returnUrl.search}#${hashPath}${
        qs ? `?${qs}` : ''
      }`;
    }

    const target = new URL(returnUrl.href);
    this.applyParams(target.searchParams, params);
    return target.toString();
  }

  private applyParams(
    search: URLSearchParams,
    params: { scanValue?: string; format?: string; state?: string | null; error?: string },
  ): void {
    if (params.error) {
      search.set('error', params.error);
    }
    if (params.scanValue !== undefined) {
      search.set('scanValue', params.scanValue);
    }
    if (params.format !== undefined) {
      search.set('format', params.format);
    }
    if (params.state) {
      search.set('state', params.state);
    }
  }
}
