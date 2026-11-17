import * as faceapi from '@vladmandic/face-api';

export type DetectorBackend = 'ssd_mobilenetv1' | 'tiny_face_detector';

export interface DetectedFaceResult {
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
  qualityScore: number;
  qualityWarnings: string[];
  embedding: number[];
}

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const modelUrl = '/models';
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
      faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
    ]);
    modelsLoaded = true;
  })();

  try {
    await loadingPromise;
  } catch (err) {
    loadingPromise = null;
    throw err;
  }
}

export async function detectAndExtractFaces(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  detectorBackend: DetectorBackend = 'ssd_mobilenetv1',
  options?: { minFaceWidth?: number }
): Promise<DetectedFaceResult[]> {
  await loadFaceModels();

  const detectorOptions =
    detectorBackend === 'tiny_face_detector'
      ? new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })
      : new faceapi.SsdMobilenetv1Options({ minConfidence: 0.48, maxResults: 30 });

  const detections = await faceapi
    .detectAllFaces(input, detectorOptions)
    .withFaceLandmarks(true)
    .withFaceDescriptors();

  const minWidth = options?.minFaceWidth ?? 36;

  return detections.map((det) => {
    const { x, y, width, height } = det.detection.box;
    const confidence = det.detection.score;
    const warnings: string[] = [];

    if (width < minWidth || height < minWidth) {
      warnings.push('Face too small / distant');
    }
    if (confidence < 0.6) {
      warnings.push('Low detection confidence');
    }

    // Landmark eye-level symmetry check
    const leftEye = det.landmarks.getLeftEye();
    const rightEye = det.landmarks.getRightEye();
    let tiltPenalty = 0;
    if (leftEye.length > 0 && rightEye.length > 0) {
      const ly = leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length;
      const ry = rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length;
      const lx = leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length;
      const rx = rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length;
      const angle = Math.abs(Math.atan2(ry - ly, rx - lx) * (180 / Math.PI));
      if (angle > 18) {
        warnings.push('Head tilt detected');
        tiltPenalty = 0.15;
      }
    }

    const sizeFactor = Math.min(1, width / 110);
    const qualityScore = Math.max(
      0.1,
      Math.min(0.99, confidence * 0.72 + sizeFactor * 0.28 - tiltPenalty)
    );

    return {
      box: { x, y, width, height },
      confidence,
      qualityScore,
      qualityWarnings: warnings,
      embedding: Array.from(det.descriptor),
    };
  });
}

export interface OverlayAnnotation {
  box: { x: number; y: number; width: number; height: number };
  label: string;
  tone: 'matched' | 'uncertain' | 'unknown' | 'detected';
}

export function drawDetectionsOverlay(
  canvas: HTMLCanvasElement,
  displayWidth: number,
  displayHeight: number,
  annotations: OverlayAnnotation[]
): void {
  canvas.width = displayWidth;
  canvas.height = displayHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const colorMap: Record<OverlayAnnotation['tone'], string> = {
    matched: '#0d9488', // Teal
    uncertain: '#d97706', // Amber
    unknown: '#dc2626', // Crimson
    detected: '#2563eb', // Royal blue
  };

  for (const item of annotations) {
    const color = colorMap[item.tone];
    const { x, y, width, height } = item.box;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, width, height);

    // Label banner above box
    ctx.font = '600 12px "JetBrains Mono", monospace';
    const textWidth = ctx.measureText(item.label).width;
    const padX = 8;
    const boxH = 22;
    const labelY = Math.max(0, y - boxH - 2);

    ctx.fillStyle = color;
    ctx.fillRect(x, labelY, textWidth + padX * 2, boxH);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(item.label, x + padX, labelY + 15);
  }
}
