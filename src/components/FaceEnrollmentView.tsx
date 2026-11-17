import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ShieldCheck,
  Trash2,
  Upload,
  ScanFace,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../services/api';
import {
  detectAndExtractFaces,
  drawDetectionsOverlay,
  loadFaceModels,
  type DetectedFaceResult,
} from '../services/faceAI';
import { useToast } from './ToastContext';
import type { Student } from '../types';

interface FaceEnrollmentViewProps {
  initialStudentId?: number | null;
}

export function FaceEnrollmentView({ initialStudentId }: FaceEnrollmentViewProps) {
  const { notify, confirm } = useToast();
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<number | ''>(
    initialStudentId || ''
  );
  const [consentChecked, setConsentChecked] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(true);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [capturedResult, setCapturedResult] = useState<DetectedFaceResult | null>(null);
  const [previewMode, setPreviewMode] = useState<'camera' | 'image'>('image');
  const [imagePreviewSrc, setImagePreviewSrc] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadStudents = async () => {
    const res = await apiFetch<{ students: Student[] }>('/api/students');
    setStudents(res.students.filter((s) => s.is_active === 1));
    if (!selectedStudentId && res.students.length > 0) {
      setSelectedStudentId(initialStudentId || res.students[0].student_id);
    }
  };

  useEffect(() => {
    loadStudents();
    loadFaceModels()
      .then(() => setModelsReady(true))
      .catch((err) => notify('error', `Neural model load error: ${String(err)}`))
      .finally(() => setModelLoading(false));

    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (initialStudentId) setSelectedStudentId(initialStudentId);
  }, [initialStudentId]);

  const selectedStudent = students.find((s) => s.student_id === Number(selectedStudentId));

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const startCamera = async () => {
    setCameraError(null);
    setCapturedResult(null);
    setPreviewMode('camera');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Webcam API is unavailable in this browser context. Use Image Upload or Sample Portrait below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: unknown) {
      setCameraError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow browser camera access or test with an authorized sample image.'
          : 'No webcam device detected. Use the authorized image upload or development sample portrait.'
      );
      setCameraActive(false);
    }
  };

  const analyzeSourceAndExtract = async (sourceEl: HTMLVideoElement | HTMLImageElement) => {
    setProcessing(true);
    setCapturedResult(null);
    try {
      const faces = await detectAndExtractFaces(sourceEl, 'ssd_mobilenetv1', {
        minFaceWidth: 48,
      });
      if (faces.length === 0) {
        notify('error', 'No face detected. Ensure good front lighting and centered framing.');
        if (overlayRef.current) {
          const ctx = overlayRef.current.getContext('2d');
          ctx?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
        }
        return;
      }
      if (faces.length > 1) {
        notify('error', `Detected ${faces.length} faces. Enrollment requires exactly one face in frame.`);
        return;
      }
      const face = faces[0];
      setCapturedResult(face);

      if (overlayRef.current) {
        const w =
          sourceEl instanceof HTMLVideoElement
            ? sourceEl.videoWidth || sourceEl.clientWidth
            : sourceEl.naturalWidth || sourceEl.clientWidth;
        const h =
          sourceEl instanceof HTMLVideoElement
            ? sourceEl.videoHeight || sourceEl.clientHeight
            : sourceEl.naturalHeight || sourceEl.clientHeight;
        drawDetectionsOverlay(overlayRef.current, w, h, [
          {
            box: face.box,
            label: `Quality ${face.qualityScore.toFixed(2)} · 128-D Ready`,
            tone: face.qualityScore >= 0.55 ? 'matched' : 'uncertain',
          },
        ]);
      }

      if (face.qualityWarnings.length > 0) {
        notify('info', `Quality advisory: ${face.qualityWarnings.join(', ')}.`);
      } else {
        notify('success', 'Face detected, aligned via 68 landmarks, and 128-D embedding extracted.');
      }
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Face detection error.');
    } finally {
      setProcessing(false);
    }
  };

  const handleCaptureCamera = () => {
    if (videoRef.current && cameraActive) {
      analyzeSourceAndExtract(videoRef.current);
    }
  };

  const handleLoadImageSrc = (src: string) => {
    stopCamera();
    setPreviewMode('image');
    setCapturedResult(null);
    setCameraError(null);
    setImagePreviewSrc(src);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleLoadImageSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCommitEnrollment = async () => {
    if (!selectedStudent || !capturedResult) return;
    if (!consentChecked) {
      notify('error', 'Please confirm student biometric authorization before enrolling.');
      return;
    }
    try {
      const res = await apiFetch<{ message: string }>('/api/students/enroll', {
        method: 'POST',
        body: JSON.stringify({
          student_id: selectedStudent.student_id,
          embedding: capturedResult.embedding,
          quality_score: capturedResult.qualityScore,
          sample_count: 1,
          consent_confirmed: true,
          model_name: 'face_recognition_resnet34_128d',
        }),
      });
      notify('success', res.message);
      setCapturedResult(null);
      loadStudents();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to store biometric template.');
    }
  };

  const handleWithdrawTemplate = async () => {
    if (!selectedStudent) return;
    const ok = await confirm({
      title: 'Withdraw Biometric Authorization & Delete Template',
      message: `Permanently delete the encrypted facial template for ${selectedStudent.name} (${selectedStudent.roll_number}) and switch them to manual non-biometric attendance?`,
      confirmLabel: 'Delete Template',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/students/${selectedStudent.student_id}/biometrics`,
        { method: 'DELETE' }
      );
      notify('success', res.message);
      setCapturedResult(null);
      loadStudents();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete biometric template.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left column: Student & Consent Controls */}
      <div className="lg:col-span-5 space-y-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">1. Select Student</h2>
            <p className="text-xs text-slate-500">Enroll or update authorized facial biometric templates</p>
          </div>

          <select
            value={selectedStudentId}
            onChange={(e) => {
              setSelectedStudentId(Number(e.target.value));
              setCapturedResult(null);
            }}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            {students.map((s) => (
              <option key={s.student_id} value={s.student_id}>
                {s.roll_number} — {s.name} {s.face_enrolled ? '(Enrolled)' : '(Not Enrolled)'}
              </option>
            ))}
          </select>

          {selectedStudent && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Program</span>
                <span className="font-medium text-slate-800">
                  {selectedStudent.department_code} · Sem {selectedStudent.semester}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Biometric Status</span>
                <span
                  className={`font-medium ${
                    selectedStudent.face_enrolled
                      ? 'text-teal-700'
                      : selectedStudent.non_biometric_opt_out
                      ? 'text-slate-600'
                      : 'text-amber-700'
                  }`}
                >
                  {selectedStudent.face_enrolled
                    ? `Encrypted Template Active (Q: ${Number(selectedStudent.template_quality || 0).toFixed(2)})`
                    : selectedStudent.non_biometric_opt_out
                    ? 'Non-Biometric Opt-Out'
                    : 'Pending Enrollment'}
                </span>
              </div>
            </div>
          )}

          {/* Consent & DPDP notice */}
          <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-slate-700 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-blue-700" />
              <span>Biometric Authorization &amp; Retention Notice</span>
            </div>
            <p className="leading-relaxed text-slate-600">
              Only mathematical 128-D facial embeddings encrypted via AES-256-GCM are stored. Raw
              face photographs are discarded immediately after feature extraction. Students may
              withdraw consent and use manual attendance at any time under institutional policy and
              India&apos;s DPDP Act, 2023.
            </p>
            <label className="flex items-start gap-2 pt-1 font-medium text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I confirm explicit student authorization has been obtained for biometric attendance
                template generation.
              </span>
            </label>
          </div>

          {selectedStudent?.face_enrolled === 1 && (
            <button
              type="button"
              onClick={handleWithdrawTemplate}
              className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Withdraw Consent &amp; Delete Template</span>
            </button>
          )}
        </div>

        {/* Development authorized sample helper */}
        {selectedStudent?.sample_image_url && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-900">
              Authorized Development Sample Available
            </h3>
            <p className="text-xs text-slate-500">
              If running without a physical webcam, load {selectedStudent.name}&apos;s authorized
              studio portrait onto the neural pipeline for real embedding extraction.
            </p>
            <button
              type="button"
              onClick={() => handleLoadImageSrc(selectedStudent.sample_image_url!)}
              className="w-full py-2 px-3 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Load Authorized Sample Portrait
            </button>
          </div>
        )}
      </div>

      {/* Right column: Camera / Image Capture & Neural Pipeline */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              2. Face Detection, Alignment &amp; Embedding Extraction
            </h2>
            <p className="text-xs text-slate-500">
              {modelLoading
                ? 'Loading neural detection & ResNet-34 embedding models...'
                : modelsReady
                ? 'Models loaded locally (SSD MobileNet v1 · 68-Landmark Aligner · 128-D ResNet)'
                : 'Model initialization failed'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Open Webcam</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                <CameraOff className="w-3.5 h-3.5" />
                <span>Stop Webcam</span>
              </button>
            )}

            <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Photo</span>
              <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
        </div>

        {cameraError && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{cameraError}</span>
          </div>
        )}

        {/* Capture stage */}
        <div className="relative bg-slate-950 rounded-xl overflow-hidden aspect-[4/3] flex items-center justify-center border border-slate-200">
          {previewMode === 'camera' && cameraActive && (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-contain"
            />
          )}

          {previewMode === 'image' && imagePreviewSrc && (
            <img
              ref={imageRef}
              src={imagePreviewSrc}
              alt="Authorized enrollment sample"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
              onLoad={() => {
                if (imageRef.current && modelsReady) {
                  analyzeSourceAndExtract(imageRef.current);
                }
              }}
            />
          )}

          {!cameraActive && !imagePreviewSrc && (
            <div className="text-center px-6 text-slate-400 space-y-2">
              <ScanFace className="w-10 h-10 mx-auto text-slate-500" />
              <p className="text-sm font-medium text-slate-300">
                Open webcam, upload a portrait, or select an authorized sample
              </p>
              <p className="text-xs text-slate-500">
                Raw images remain strictly in browser memory and are never persisted on the server.
              </p>
            </div>
          )}

          <canvas
            ref={overlayRef}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />
        </div>

        {/* Action & Extracted Embedding Status */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <div className="text-xs text-slate-600">
            {capturedResult ? (
              <span className="inline-flex items-center gap-1.5 text-teal-700 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                <span className="font-mono tabular-nums">
                  128-D Vector Extracted · Confidence {capturedResult.confidence.toFixed(2)} ·
                  Quality {capturedResult.qualityScore.toFixed(2)}
                </span>
              </span>
            ) : (
              <span>Waiting for face capture and quality verification.</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {cameraActive && (
              <button
                type="button"
                disabled={!modelsReady || processing}
                onClick={handleCaptureCamera}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                {processing ? 'Analyzing...' : 'Capture & Analyze Frame'}
              </button>
            )}
            <button
              type="button"
              disabled={!capturedResult || !consentChecked || !selectedStudent || processing}
              onClick={handleCommitEnrollment}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 rounded-lg whitespace-nowrap"
            >
              Encrypt &amp; Save Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
