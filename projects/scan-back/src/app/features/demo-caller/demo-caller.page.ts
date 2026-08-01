import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

function appBaseUrl(): string {
  const baseHref = document.querySelector('base')?.href ?? `${location.origin}/`;
  return baseHref.replace(/\/$/, '');
}

@Component({
  selector: 'sb-demo-caller-page',
  imports: [FormsModule],
  templateUrl: './demo-caller.page.html',
  styleUrl: './demo-caller.page.scss',
})
export class DemoCallerPage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  readonly scannedValue = signal('');
  readonly lastFormat = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly lastState = signal<string | null>(null);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const scanValue = params.get('scanValue');
    const format = params.get('format');
    const error = params.get('error');
    const state = params.get('state');

    if (scanValue) {
      this.scannedValue.set(scanValue);
    }
    if (format) {
      this.lastFormat.set(format);
    }
    if (error) {
      this.lastError.set(error);
    }
    if (state) {
      this.lastState.set(state);
    }
  }

  startScan(): void {
    const base = appBaseUrl();
    const returnUrl = `${base}/demo-caller`;
    location.href = `${base}/scan?returnUrl=${encodeURIComponent(returnUrl)}&state=demo1`;
  }
}
