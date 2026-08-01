import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReturnUrlValidator } from '../../core/return-url.validator';
import { ScanPageStatus, ScanResult } from '../../core/scan-result.model';
import { ScannerService } from './scanner';

@Component({
  selector: 'sb-scan-page',
  imports: [RouterLink],
  templateUrl: './scan.page.html',
  styleUrl: './scan.page.scss',
})
export class ScanPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly scanner = inject(ScannerService);
  private readonly returnUrlValidator = inject(ReturnUrlValidator);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('preview');

  readonly status = signal<ScanPageStatus>('idle');
  readonly statusMessage = signal('Starting camera…');
  readonly result = signal<ScanResult | null>(null);
  readonly errorDetail = signal<string | null>(null);
  readonly deviceCount = signal(0);
  readonly copied = signal(false);
  readonly zoom = signal(1);
  readonly zoomMin = signal(1);
  readonly zoomMax = signal(4);
  readonly zoomLabel = signal('1.0×');

  private returnUrl: URL | null = null;
  private state: string | null = null;
  private devices: MediaDeviceInfo[] = [];
  private deviceIndex = 0;
  private handled = false;
  private readyToScan = false;
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;

  constructor() {
    afterNextRender(() => {
      this.readyToScan = true;
      void this.bootstrap();
    });
  }

  ngOnDestroy(): void {
    void this.scanner.stop();
  }

  async onCancel(): Promise<void> {
    await this.scanner.stop();

    if (this.returnUrl) {
      location.href = this.returnUrlValidator.buildRedirectUrl(this.returnUrl, {
        error: 'cancelled',
        state: this.state,
      });
      return;
    }

    if (history.length > 1) {
      history.back();
      return;
    }
    void this.router.navigateByUrl('/');
  }

  async onSwitchCamera(): Promise<void> {
    if (this.devices.length < 2 || this.handled) {
      return;
    }
    this.deviceIndex = (this.deviceIndex + 1) % this.devices.length;
    await this.startScanner();
  }

  async onScanAgain(): Promise<void> {
    this.handled = false;
    this.result.set(null);
    this.copied.set(false);
    this.status.set('starting');
    queueMicrotask(() => void this.startScanner());
  }

  async onCopy(): Promise<void> {
    const scanValue = this.result()?.scanValue;
    if (!scanValue) {
      return;
    }
    try {
      await navigator.clipboard.writeText(scanValue);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  async onZoomOut(): Promise<void> {
    const step = (this.zoomMax() - this.zoomMin()) / 5;
    await this.applyZoom(this.zoom() - step);
  }

  async onZoomIn(): Promise<void> {
    const step = (this.zoomMax() - this.zoomMin()) / 5;
    await this.applyZoom(this.zoom() + step);
  }

  async onZoomSlider(event: Event): Promise<void> {
    const value = Number((event.target as HTMLInputElement).value);
    await this.applyZoom(value);
  }

  onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 2) {
      return;
    }
    this.pinchStartDistance = this.touchDistance(event.touches);
    this.pinchStartZoom = this.zoom();
  }

  onTouchMove(event: TouchEvent): void {
    if (event.touches.length !== 2 || this.pinchStartDistance <= 0) {
      return;
    }
    event.preventDefault();
    const ratio = this.touchDistance(event.touches) / this.pinchStartDistance;
    // Amplify pinch so small finger moves feel more responsive.
    const amplified = Math.pow(ratio, 1.65);
    void this.applyZoom(this.pinchStartZoom * amplified);
  }

  onTouchEnd(event: TouchEvent): void {
    if (event.touches.length < 2) {
      this.pinchStartDistance = 0;
    }
  }

  private async bootstrap(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    this.state = params.get('state');

    const rawReturnUrl = params.get('returnUrl');
    if (rawReturnUrl) {
      const validation = this.returnUrlValidator.validate(rawReturnUrl);
      if (!validation.ok) {
        this.status.set('invalid-return-url');
        this.errorDetail.set(validation.reason);
        return;
      }
      this.returnUrl = validation.url;
    }

    try {
      this.devices = await this.scanner.listVideoDevices();
      this.deviceCount.set(this.devices.length);
    } catch {
      this.devices = [];
    }

    await this.startScanner();
  }

  private async startScanner(): Promise<void> {
    if (!this.readyToScan) {
      return;
    }

    const video = this.videoRef()?.nativeElement;
    if (!video) {
      requestAnimationFrame(() => void this.startScanner());
      return;
    }

    this.status.set('starting');
    this.statusMessage.set('Starting camera…');
    this.errorDetail.set(null);

    const formats = this.scanner.parseFormats(
      this.route.snapshot.queryParamMap.get('formats'),
    );
    const deviceId =
      this.devices.length > 0 ? this.devices[this.deviceIndex]?.deviceId : undefined;

    try {
      await this.scanner.start(video, formats, deviceId, (scanResult) => {
        void this.handleResult(scanResult);
      });
      this.syncZoomUi(this.scanner.getZoomState());
      this.status.set('scanning');
      this.statusMessage.set('Point at the code · pinch to zoom');
    } catch (err) {
      await this.scanner.stop();
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        this.status.set('permission-denied');
        this.errorDetail.set(
          'Camera permission was denied. Allow camera access in your browser settings, and use HTTPS (or localhost).',
        );
        return;
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        this.status.set('no-camera');
        this.errorDetail.set('No camera found on this device.');
        return;
      }
      this.status.set('error');
      this.errorDetail.set(
        err instanceof Error ? err.message : 'Could not start the camera.',
      );
    }
  }

  private async handleResult(scanResult: ScanResult): Promise<void> {
    if (this.handled) {
      return;
    }
    this.handled = true;
    await this.scanner.stop();

    if (this.returnUrl) {
      this.status.set('redirecting');
      this.statusMessage.set('Returning…');
      location.href = this.returnUrlValidator.buildRedirectUrl(this.returnUrl, {
        scanValue: scanResult.scanValue,
        format: scanResult.format,
        state: this.state,
      });
      return;
    }

    this.result.set(scanResult);
    this.status.set('result');
  }

  private async applyZoom(value: number): Promise<void> {
    const state = await this.scanner.setZoom(value);
    this.syncZoomUi(state);
  }

  private syncZoomUi(state: { min: number; max: number; value: number }): void {
    this.zoomMin.set(state.min);
    this.zoomMax.set(state.max);
    this.zoom.set(state.value);
    this.zoomLabel.set(`${state.value.toFixed(1)}×`);
  }

  private touchDistance(touches: TouchList): number {
    const a = touches.item(0);
    const b = touches.item(1);
    if (!a || !b) {
      return 0;
    }
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  }
}
