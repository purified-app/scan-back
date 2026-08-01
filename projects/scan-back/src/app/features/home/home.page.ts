import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

function appBaseUrl(): string {
  const baseHref = document.querySelector('base')?.href ?? `${location.origin}/`;
  return baseHref.replace(/\/$/, '');
}

@Component({
  selector: 'sb-home-page',
  imports: [RouterLink],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  /** Concrete open-URL using this deployment + demo-caller as return target. */
  readonly demoOpenUrl: string;

  /** Example of what comes back after a successful scan. */
  readonly demoReturnUrl: string;

  constructor() {
    const base = appBaseUrl();
    const returnUrl = `${base}/demo-caller`;

    this.demoOpenUrl = `${base}/scan?returnUrl=${encodeURIComponent(returnUrl)}&state=demo1`;
    this.demoReturnUrl = `${base}/demo-caller?scanValue=ABC-123&format=QR_CODE&state=demo1`;
  }
}
