import { Service } from '@angular/core';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { ScanResult } from '../../core/scan-result.model';

const DEFAULT_FORMATS: BarcodeFormat[] = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.DATA_MATRIX,
];

const FORMAT_ALIASES: Record<string, BarcodeFormat> = {
  QR_CODE: BarcodeFormat.QR_CODE,
  QR: BarcodeFormat.QR_CODE,
  EAN_13: BarcodeFormat.EAN_13,
  EAN_8: BarcodeFormat.EAN_8,
  CODE_128: BarcodeFormat.CODE_128,
  CODE_39: BarcodeFormat.CODE_39,
  UPC_A: BarcodeFormat.UPC_A,
  UPC_E: BarcodeFormat.UPC_E,
  ITF: BarcodeFormat.ITF,
  DATA_MATRIX: BarcodeFormat.DATA_MATRIX,
};

const ZXING_TO_NATIVE: Partial<Record<BarcodeFormat, string>> = {
  [BarcodeFormat.QR_CODE]: 'qr_code',
  [BarcodeFormat.EAN_13]: 'ean_13',
  [BarcodeFormat.EAN_8]: 'ean_8',
  [BarcodeFormat.CODE_128]: 'code_128',
  [BarcodeFormat.CODE_39]: 'code_39',
  [BarcodeFormat.UPC_A]: 'upc_a',
  [BarcodeFormat.UPC_E]: 'upc_e',
  [BarcodeFormat.ITF]: 'itf',
  [BarcodeFormat.DATA_MATRIX]: 'data_matrix',
};

const NATIVE_TO_FORMAT: Record<string, string> = {
  qr_code: 'QR_CODE',
  ean_13: 'EAN_13',
  ean_8: 'EAN_8',
  code_128: 'CODE_128',
  code_39: 'CODE_39',
  upc_a: 'UPC_A',
  upc_e: 'UPC_E',
  itf: 'ITF',
  data_matrix: 'DATA_MATRIX',
};

const DIGITAL_ZOOM_MIN = 1;
const DIGITAL_ZOOM_MAX = 4;
const SCAN_INTERVAL_MS = 45;
const TARGET_DECODE_WIDTH = 960;

export interface ZoomState {
  min: number;
  max: number;
  value: number;
  mode: 'native' | 'digital';
}

type ZoomCapableTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & {
    zoom?: number | { min: number; max: number; step?: number };
  };
  getSettings?: () => MediaTrackSettings & { zoom?: number };
};

interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>;
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

type EnhanceMode = 'plain' | 'contrast' | 'invert';

@Service()
export class ScannerService {
  private reader: BrowserMultiFormatReader | null = null;
  private nativeDetector: NativeBarcodeDetector | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private videoTrack: ZoomCapableTrack | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private enhanceCanvas: HTMLCanvasElement | null = null;
  private enhanceModeIndex = 0;
  private zoomMode: 'native' | 'digital' = 'digital';
  private zoomMin = DIGITAL_ZOOM_MIN;
  private zoomMax = DIGITAL_ZOOM_MAX;
  private zoomValue = DIGITAL_ZOOM_MIN;

  async listVideoDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  parseFormats(formatsParam: string | null): BarcodeFormat[] {
    if (!formatsParam?.trim()) {
      return DEFAULT_FORMATS;
    }

    const parsed = formatsParam
      .split(',')
      .map((f) => f.trim().toUpperCase())
      .map((name) => FORMAT_ALIASES[name])
      .filter((f): f is BarcodeFormat => f !== undefined);

    return parsed.length > 0 ? parsed : DEFAULT_FORMATS;
  }

  getZoomState(): ZoomState {
    return {
      min: this.zoomMin,
      max: this.zoomMax,
      value: this.zoomValue,
      mode: this.zoomMode,
    };
  }

  async setZoom(value: number): Promise<ZoomState> {
    const next = Math.min(this.zoomMax, Math.max(this.zoomMin, value));
    this.zoomValue = next;

    if (this.zoomMode === 'native' && this.videoTrack) {
      try {
        await this.videoTrack.applyConstraints({
          advanced: [{ zoom: next } as MediaTrackConstraintSet],
        });
      } catch {
        this.zoomMode = 'digital';
        this.applyDigitalZoom(next);
      }
    } else {
      this.applyDigitalZoom(next);
    }

    return this.getZoomState();
  }

  async start(
    videoElement: HTMLVideoElement,
    formats: BarcodeFormat[],
    deviceId: string | undefined,
    onResult: (result: ScanResult) => void,
  ): Promise<void> {
    await this.stop();

    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(DecodeHintType.TRY_HARDER, true);

    this.reader = new BrowserMultiFormatReader(hints);
    this.nativeDetector = await this.createNativeDetector(formats);
    this.videoElement = videoElement;
    this.enhanceCanvas = document.createElement('canvas');

    const constraints: MediaStreamConstraints = {
      audio: false,
      video: deviceId
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          }
        : {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = this.stream;
    videoElement.setAttribute('playsinline', 'true');
    videoElement.muted = true;
    await videoElement.play();

    this.videoTrack = this.stream.getVideoTracks()[0] ?? null;
    await this.boostTrackQuality();
    await this.initZoom();

    this.running = true;
    this.scheduleLoop(onResult);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement.style.transform = '';
    }

    this.videoElement = null;
    this.videoTrack = null;
    this.reader = null;
    this.nativeDetector = null;
    this.enhanceCanvas = null;
    this.enhanceModeIndex = 0;
    this.zoomMode = 'digital';
    this.zoomMin = DIGITAL_ZOOM_MIN;
    this.zoomMax = DIGITAL_ZOOM_MAX;
    this.zoomValue = DIGITAL_ZOOM_MIN;
  }

  private scheduleLoop(onResult: (result: ScanResult) => void): void {
    this.loopTimer = setTimeout(() => {
      void this.tick(onResult);
    }, SCAN_INTERVAL_MS);
  }

  private async tick(onResult: (result: ScanResult) => void): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      const hit = await this.scanOnce();
      if (hit && this.running) {
        onResult(hit);
        return;
      }
    } catch {
      // Keep scanning through transient frame/decode errors.
    }

    if (this.running) {
      this.scheduleLoop(onResult);
    }
  }

  private async scanOnce(): Promise<ScanResult | null> {
    const video = this.videoElement;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    if (this.nativeDetector) {
      try {
        const codes = await this.nativeDetector.detect(video);
        const first = codes[0];
        if (first?.rawValue) {
          return {
            scanValue: first.rawValue,
            format: NATIVE_TO_FORMAT[first.format] ?? first.format.toUpperCase(),
          };
        }
      } catch {
        // Native detector can fail on some frames; continue with ZXing.
      }
    }

    if (!this.reader || !this.enhanceCanvas) {
      return null;
    }

    const modes: EnhanceMode[] = ['plain', 'contrast', 'invert'];
    const mode = modes[this.enhanceModeIndex % modes.length] ?? 'plain';
    this.enhanceModeIndex += 1;

    this.drawEnhancedFrame(video, this.enhanceCanvas, mode);

    try {
      const result = this.reader.decodeFromCanvas(this.enhanceCanvas);
      return {
        scanValue: result.getText(),
        format: BarcodeFormat[result.getBarcodeFormat()] ?? String(result.getBarcodeFormat()),
      };
    } catch {
      return null;
    }
  }

  /**
   * Crops the visible center (respecting digital zoom), upscales, and optionally
   * boosts contrast / inverts — helps ZXing on blurry or low-contrast codes.
   */
  private drawEnhancedFrame(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    mode: EnhanceMode,
  ): void {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      return;
    }

    // Match what the user sees: CSS digital zoom shows the center 1/zoom region.
    const zoom = this.zoomMode === 'digital' ? this.zoomValue : 1;
    const visibleWidth = sourceWidth / zoom;
    const visibleHeight = sourceHeight / zoom;
    const sx = (sourceWidth - visibleWidth) / 2;
    const sy = (sourceHeight - visibleHeight) / 2;

    // Focus on the reticle area (~60% of the visible frame).
    const cropRatio = 0.6;
    const cropWidth = visibleWidth * cropRatio;
    const cropHeight = visibleHeight * cropRatio;
    const cropX = sx + (visibleWidth - cropWidth) / 2;
    const cropY = sy + (visibleHeight - cropHeight) / 2;

    const scale = Math.max(1, TARGET_DECODE_WIDTH / cropWidth);
    const destWidth = Math.round(cropWidth * scale);
    const destHeight = Math.round(cropHeight * scale);

    canvas.width = destWidth;
    canvas.height = destHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (mode === 'contrast') {
      ctx.filter = 'contrast(185%) brightness(112%) saturate(0%)';
    } else if (mode === 'invert') {
      ctx.filter = 'invert(1) contrast(160%) saturate(0%)';
    } else {
      ctx.filter = 'contrast(125%) saturate(0%)';
    }

    ctx.drawImage(
      video,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      destWidth,
      destHeight,
    );
    ctx.filter = 'none';
  }

  private async createNativeDetector(
    formats: BarcodeFormat[],
  ): Promise<NativeBarcodeDetector | null> {
    const Detector = (globalThis as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor })
      .BarcodeDetector;
    if (!Detector) {
      return null;
    }

    try {
      const wanted = formats
        .map((format) => ZXING_TO_NATIVE[format])
        .filter((name): name is string => !!name);

      let formatsToUse = wanted;
      if (typeof Detector.getSupportedFormats === 'function') {
        const supported = await Detector.getSupportedFormats();
        formatsToUse = wanted.filter((name) => supported.includes(name));
      }

      if (formatsToUse.length === 0) {
        return null;
      }

      return new Detector({ formats: formatsToUse });
    } catch {
      return null;
    }
  }

  private async boostTrackQuality(): Promise<void> {
    const track = this.videoTrack;
    if (!track) {
      return;
    }

    try {
      await track.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
        advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
      });
    } catch {
      try {
        await track.applyConstraints({
          width: { ideal: 1280 },
          height: { ideal: 720 },
        });
      } catch {
        // Keep negotiated settings.
      }
    }
  }

  private async initZoom(): Promise<void> {
    const track = this.videoTrack;
    const caps = track?.getCapabilities?.() as
      | (MediaTrackCapabilities & {
          zoom?: number | { min: number; max: number; step?: number };
        })
      | undefined;
    const zoomCap = caps?.zoom;

    if (zoomCap && typeof zoomCap === 'object' && 'min' in zoomCap && 'max' in zoomCap) {
      this.zoomMode = 'native';
      this.zoomMin = zoomCap.min;
      this.zoomMax = zoomCap.max;
      const settings = track?.getSettings?.() as
        | (MediaTrackSettings & { zoom?: number })
        | undefined;
      this.zoomValue = settings?.zoom ?? zoomCap.min;
      await this.setZoom(this.zoomValue);
      return;
    }

    this.zoomMode = 'digital';
    this.zoomMin = DIGITAL_ZOOM_MIN;
    this.zoomMax = DIGITAL_ZOOM_MAX;
    this.zoomValue = DIGITAL_ZOOM_MIN;
    this.applyDigitalZoom(this.zoomValue);
  }

  private applyDigitalZoom(value: number): void {
    if (!this.videoElement) {
      return;
    }
    this.videoElement.style.transform = value <= 1 ? '' : `scale(${value})`;
  }
}
