declare module 'tesseract-wasm' {
  export type IntRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };

  export type TextUnit = 'line' | 'word';
  export type ProgressListener = (progress: number) => void;

  export type BoxItem = {
    rect: IntRect;
    flags: number;
  };

  export type TextItem = BoxItem & {
    confidence: number;
    text: string;
  };

  export type Orientation = {
    rotation: number;
    confidence: number;
  };

  export type OCRClientInit = {
    createWorker?: (url: string) => Worker;
    wasmBinary?: Uint8Array | ArrayBuffer;
    workerURL?: string;
  };

  export class OCRClient {
    constructor(init?: OCRClientInit);
    destroy(): Promise<void>;
    loadModel(model: string | ArrayBuffer): Promise<void>;
    loadImage(image: ImageBitmap | ImageData): Promise<void>;
    clearImage(): Promise<void>;
    getBoundingBoxes(unit: TextUnit): Promise<BoxItem[]>;
    getTextBoxes(unit: TextUnit, onProgress?: ProgressListener): Promise<TextItem[]>;
    getText(onProgress?: ProgressListener): Promise<string>;
    getHOCR(onProgress?: ProgressListener): Promise<string>;
    getOrientation(): Promise<Orientation>;
  }

  export class OCREngine {
    destroy(): void;
    getVariable(name: string): string;
    setVariable(name: string, value: string): void;
    loadModel(model: Uint8Array | ArrayBuffer): void;
    loadImage(image: ImageBitmap | ImageData): void;
    clearImage(): void;
    getBoundingBoxes(unit: TextUnit): BoxItem[];
    getTextBoxes(unit: TextUnit, onProgress?: ProgressListener): TextItem[];
    getText(onProgress?: ProgressListener): string;
    getHOCR(onProgress?: ProgressListener): string;
    getOrientation(): Orientation;
  }

  export type CreateOCREngineOptions = {
    wasmBinary?: Uint8Array | ArrayBuffer;
    progressChannel?: MessagePort;
  };

  export const layoutFlags: {
    StartOfLine: number;
    EndOfLine: number;
  };

  export function supportsFastBuild(): boolean;
  export function createOCREngine(options?: CreateOCREngineOptions): Promise<OCREngine>;
}
