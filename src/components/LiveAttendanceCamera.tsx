import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Check,
  CheckCheck,
  Play,
  Square,
  Upload,
  UserCheck,
  X,
  AlertTriangle,
  Scan,
} from 'lucide-react';
import { apiFetch } from '../services/api';
import {
  detectAndExtractFaces,
  drawDetectionsOverlay,
  loadFaceModels,
  type DetectorBackend,
  type OverlayAnnotation,
} from '../services/faceAI';
import { useToast } from './ToastContext';
import type {
  AttendanceRecord,
  AttendanceSession,
  AuthUser,
  Student,
  Subject,
} from '../types';

interface LiveAttendanceCameraProps {
  user: AuthUser;
  initialSubjectId?: number | null;
}

interface RecognitionEventItem {
  face_index: number;
  decision: 'proposed' | 'duplicate' | 'uncertain' | 'unknown';
  student_id: number | null;
  roll_number: string | null;
  student_name: string | null;
  cosine_similarity: number;
  attendance_id: number | null;
  message: string;
}

export function LiveAttendanceCamera({
  user,
  initialSubjectId,
}: LiveAttendanceCameraProps) {
  const { notify, confirm } = useToast();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | ''>(
    initialSubjectId || ''
  );
  const [section, setSection] = useState('A');
  const [detector, setDetector] = useState<DetectorBackend>('ssd_mobilenetv1');

  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<Student[]>([]);
  const [sessionRecords, setSessionRecords] = useState<AttendanceRecord[]>([]);
  const [uncertainQueue, setUncertainQueue] = useState<RecognitionEventItem[]>([]);
  const [lastStats, setLastStats] = useState({
    facesDetected: 0,
    proposals: 0,
    unknowns: 0,
    templatesChecked: 0,
  });

  const [modelsReady, setModelsReady] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [testImageSrc, setTestImageSrc] = useState<string | null>(null);

  const [manualStudentId, setManualStudentId] = useState<string>('');
  const [manualStatus, setManualStatus] = useState<'Present' | 'Late' | 'Excused' | 'Absent'>('Present');
  const [manualNotes, setManualNotes] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    setAutoScan(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    loadFaceModels()
      .then(() => setModelsReady(true))
      .catch((err) => notify('error', `Model load failed: ${String(err)}`));

    Promise.all([
      apiFetch<{ subjects: Subject[] }>('/api/academic'),
      apiFetch<{ sessions: AttendanceSession[] }>('/api/sessions'),
    ]).then(([acad, sess]) => {
      const available =
        user.role === 'faculty'
          ? acad.subjects.filter((s) => s.faculty_id === user.id)
          : acad.subjects;
      setSubjects(available);
      const existingActive = sess.sessions.find((s) => s.session_status === 'active');
      if (existingActive) {
        setActiveSession(existingActive);
        setSelectedSubjectId(existingActive.subject_id);
        setSection(existingActive.section);
      } else if (initialSubjectId) {
        setSelectedSubjectId(initialSubjectId);
      } else if (available[0]) {
        setSelectedSubjectId(available[0].subject_id);
      }
    });

    return () => {
      stopCamera();
    };
  }, []);

  const refreshSessionState = async (session: AttendanceSession) => {
    const [attRes, stuRes] = await Promise.all([
      apiFetch<{ attendance: AttendanceRecord[] }>(
        `/api/attendance?session_id=${session.session_id}`
      ),
      apiFetch<{ students: Student[] }>(
        `/api/students?subject_id=${session.subject_id}`
      ),
    ]);
    setSessionRecords(attRes.attendance);
    setEnrolledStudents(stuRes.students.filter((s) => s.is_active === 1));
    if (!manualStudentId && stuRes.students[0]) {
      setManualStudentId(String(stuRes.students[0].student_id));
    }
  };

  useEffect(() => {
    if (activeSession) {
      refreshSessionState(activeSession);
    }
  }, [activeSession?.session_id]);

  // Auto-scan interval when camera + active session + autoScan are enabled
  useEffect(() => {
    if (!autoScan || !cameraActive || !activeSession || !modelsReady) return;
    const id = setInterval(() => {
      if (videoRef.current && !scanning) {
        runFrameRecognition(videoRef.current);
      }
    }, 3200);
    return () => clearInterval(id);
  }, [autoScan, cameraActive, activeSession, modelsReady, scanning]);

  const handleStartSession = async () => {
    if (!selectedSubjectId) {
      notify('error', 'Select a subject first.');
      return;
    }
    try {
      const res = await apiFetch<{ session: AttendanceSession }>('/api/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          subject_id: Number(selectedSubjectId),
          section,
          detector_used: detector,
        }),
      });
      setActiveSession(res.session);
      setUncertainQueue([]);
      setLastStats({ facesDetected: 0, proposals: 0, unknowns: 0, templatesChecked: 0 });
      notify('success', `Started attendance session #${res.session.session_id} for ${res.session.subject_code}.`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to start session.');
    }
  };

  const handleCloseSession = async () => {
    if (!activeSession) return;
    const ok = await confirm({
      title: 'Stop & Close Attendance Session',
      message:
        'Closing this session stops camera capture and marks any remaining unmarked enrolled students as Absent. You can still review or correct individual records afterward.',
      confirmLabel: 'Close Session',
    });
    if (!ok) return;

    stopCamera();
    try {
      await apiFetch(`/api/sessions/${activeSession.session_id}/close`, {
        method: 'POST',
        body: JSON.stringify({ mark_unmarked_absent: true }),
      });
      notify('success', `Session #${activeSession.session_id} closed and finalized.`);
      await refreshSessionState(activeSession);
      setActiveSession({ ...activeSession, session_status: 'closed' });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to close session.');
    }
  };

  const openWebcam = async () => {
    setCameraError(null);
    setTestImageSrc(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Webcam API is unavailable. Use Classroom Test Frame or Upload Image below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
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
          ? 'Camera permission denied by browser. Grant permission or test with a classroom frame.'
          : 'No webcam hardware detected. Use the Classroom Sample Frame or Photo Upload tester.'
      );
    }
  };

  const runFrameRecognition = async (sourceEl: HTMLVideoElement | HTMLImageElement) => {
    if (!activeSession || activeSession.session_status !== 'active') {
      notify('error', 'Start an active attendance session before scanning faces.');
      return;
    }
    if (!modelsReady) {
      notify('error', 'Neural face detection models are still loading.');
      return;
    }
    setScanning(true);
    try {
      const detected = await detectAndExtractFaces(sourceEl, detector, { minFaceWidth: 32 });
      const w =
        sourceEl instanceof HTMLVideoElement
          ? sourceEl.videoWidth || sourceEl.clientWidth
          : sourceEl.naturalWidth || sourceEl.clientWidth;
      const h =
        sourceEl instanceof HTMLVideoElement
          ? sourceEl.videoHeight || sourceEl.clientHeight
          : sourceEl.naturalHeight || sourceEl.clientHeight;

      if (detected.length === 0) {
        if (overlayRef.current) {
          drawDetectionsOverlay(overlayRef.current, w, h, []);
        }
        notify('info', 'No faces detected in this frame.');
        return;
      }

      const recRes = await apiFetch<{
        threshold_used: number;
        enrolled_templates_checked: number;
        results: RecognitionEventItem[];
      }>('/api/attendance/recognize', {
        method: 'POST',
        body: JSON.stringify({
          session_id: activeSession.session_id,
          detector_name: detector,
          faces: detected.map((d) => ({
            embedding: d.embedding,
            qualityScore: d.qualityScore,
          })),
        }),
      });

      const annotations: OverlayAnnotation[] = recRes.results.map((r) => {
        const box = detected[r.face_index]?.box || { x: 0, y: 0, width: 60, height: 60 };
        if (r.decision === 'proposed' || r.decision === 'duplicate') {
          return {
            box,
            label: `${r.roll_number} · ${r.cosine_similarity.toFixed(2)}`,
            tone: 'matched',
          };
        }
        if (r.decision === 'uncertain') {
          return {
            box,
            label: `Uncertain (${r.cosine_similarity.toFixed(2)})`,
            tone: 'uncertain',
          };
        }
        return {
          box,
          label: `Unknown (${r.cosine_similarity.toFixed(2)})`,
          tone: 'unknown',
        };
      });

      if (overlayRef.current) {
        drawDetectionsOverlay(overlayRef.current, w, h, annotations);
      }

      const newUncertains = recRes.results.filter((r) => r.decision === 'uncertain');
      if (newUncertains.length > 0) {
        setUncertainQueue((prev) => [...newUncertains, ...prev].slice(0, 15));
      }

      const proposedCount = recRes.results.filter((r) => r.decision === 'proposed').length;
      const unknownCount = recRes.results.filter((r) => r.decision === 'unknown').length;

      setLastStats((prev) => ({
        facesDetected: detected.length,
        proposals: prev.proposals + proposedCount,
        unknowns: prev.unknowns + unknownCount,
        templatesChecked: recRes.enrolled_templates_checked,
      }));

      await refreshSessionState(activeSession);

      if (proposedCount > 0) {
        notify('success', `Detected ${detected.length} face(s); staged ${proposedCount} AI proposal(s) for faculty review.`);
      } else {
        notify(
          'info',
          `Detected ${detected.length} face(s): ${newUncertains.length} uncertain, ${unknownCount} unknown.`
        );
      }
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Recognition failed.');
    } finally {
      setScanning(false);
    }
  };

  const handleReviewAction = async (
    attendanceId: number,
    action: 'approve' | 'reject',
    status: 'Present' | 'Late' = 'Present'
  ) => {
    try {
      await apiFetch('/api/attendance/review', {
        method: 'POST',
        body: JSON.stringify({ attendance_id: attendanceId, action, status }),
      });
      if (activeSession) await refreshSessionState(activeSession);
      notify('success', action === 'approve' ? `Confirmed as ${status}.` : 'AI proposal dismissed.');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Review action failed.');
    }
  };

  const handleApproveAll = async () => {
    if (!activeSession) return;
    try {
      const res = await apiFetch<{ approved_count: number }>('/api/attendance/review', {
        method: 'POST',
        body: JSON.stringify({
          attendance_id: 1,
          action: 'approve_all',
          session_id: activeSession.session_id,
        }),
      });
      await refreshSessionState(activeSession);
      notify('success', `Approved ${res.approved_count} AI attendance proposal(s).`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Batch approval failed.');
    }
  };

  const handleManualMark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !manualStudentId) return;
    try {
      await apiFetch('/api/attendance/manual', {
        method: 'POST',
        body: JSON.stringify({
          session_id: activeSession.session_id,
          student_id: Number(manualStudentId),
          status: manualStatus,
          notes: manualNotes,
        }),
      });
      setManualNotes('');
      await refreshSessionState(activeSession);
      notify('success', `Manually marked ${manualStatus}.`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to record manual attendance.');
    }
  };

  const handleResolveUncertain = async (item: RecognitionEventItem, markPresent: boolean) => {
    if (markPresent && item.student_id && activeSession) {
      try {
        await apiFetch('/api/attendance/manual', {
          method: 'POST',
          body: JSON.stringify({
            session_id: activeSession.session_id,
            student_id: item.student_id,
            status: 'Present',
            notes: `Manually confirmed from uncertain match (${item.cosine_similarity.toFixed(2)})`,
          }),
        });
        await refreshSessionState(activeSession);
        notify('success', `Confirmed ${item.student_name} manually.`);
      } catch (err: unknown) {
        notify('error', err instanceof Error ? err.message : 'Could not mark student.');
      }
    }
    setUncertainQueue((prev) => prev.filter((x) => x !== item));
  };

  const handleUploadFrame = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCamera();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setTestImageSrc(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const pendingProposals = sessionRecords.filter(
    (r) => r.verification_method === 'AI_Proposal_Pending'
  );

  return (
    <div className="space-y-6">
      {/* Session Setup & Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
            <select
              disabled={activeSession?.session_status === 'active'}
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
            >
              {subjects.map((sub) => (
                <option key={sub.subject_id} value={sub.subject_id}>
                  {sub.code} — {sub.subject_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Class Section</label>
            <select
              disabled={activeSession?.session_status === 'active'}
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
            >
              <option value="A">Section A</option>
              <option value="B">Section B</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Face Detector</label>
            <select
              value={detector}
              onChange={(e) => setDetector(e.target.value as DetectorBackend)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="ssd_mobilenetv1">SSD MobileNet v1 (Multi-Face)</option>
              <option value="tiny_face_detector">Tiny Face Detector (Fast)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {!activeSession || activeSession.session_status !== 'active' ? (
            <button
              type="button"
              onClick={handleStartSession}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              <Play className="w-4 h-4" />
              <span>Start Attendance Session</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCloseSession}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              <Square className="w-4 h-4" />
              <span>Stop &amp; Finalize Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Stats Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Session Status</div>
          <div className="mt-1 text-base font-semibold text-slate-900 capitalize">
            {activeSession ? `#${activeSession.session_id} · ${activeSession.session_status}` : 'Not Started'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Faces in Last Frame</div>
          <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900">
            {lastStats.facesDetected}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Pending AI Proposals</div>
          <div className="mt-1 text-base font-semibold font-mono tabular-nums text-teal-700">
            {pendingProposals.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Unknown Detections</div>
          <div className="mt-1 text-base font-semibold font-mono tabular-nums text-red-600">
            {lastStats.unknowns}
          </div>
        </div>
      </div>

      {/* Main Split: Camera Feed (Left) + AI Review & Manual Fallback (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Classroom Camera &amp; Frame Analyzer</h2>
              <p className="text-xs text-slate-500">
                {modelsReady ? 'Neural detector ready' : 'Loading detection models...'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!cameraActive ? (
                <button
                  type="button"
                  onClick={openWebcam}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Enable Webcam</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300"
                >
                  <CameraOff className="w-3.5 h-3.5" />
                  <span>Disable Webcam</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setTestImageSrc('/src/assets/images/sample_classroom_group_1794904594463.jpg');
                }}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg"
              >
                Sample Classroom
              </button>

              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setTestImageSrc('/src/assets/images/sample_student_aarav_1794904592806.jpg');
                }}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg"
              >
                Sample Student
              </button>

              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Frame</span>
                <input type="file" accept="image/*" onChange={handleUploadFrame} className="hidden" />
              </label>
            </div>
          </div>

          {cameraError && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{cameraError}</span>
            </div>
          )}

          <div className="relative bg-slate-950 rounded-xl overflow-hidden aspect-video flex items-center justify-center border border-slate-200">
            {cameraActive && (
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
            )}
            {!cameraActive && testImageSrc && (
              <img
                ref={imgRef}
                src={testImageSrc}
                alt="Classroom frame preview"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            )}
            {!cameraActive && !testImageSrc && (
              <div className="text-center px-6 text-slate-400 text-xs space-y-1.5">
                <Camera className="w-8 h-8 mx-auto text-slate-500" />
                <p className="text-sm font-medium text-slate-300">Camera Standby</p>
                <p>Enable Webcam, load a Sample Frame, or upload a classroom photo to run face detection.</p>
              </div>
            )}
            <canvas
              ref={overlayRef}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                disabled={!cameraActive}
                checked={autoScan}
                onChange={(e) => setAutoScan(e.target.checked)}
              />
              <span>Auto-scan webcam every 3 seconds</span>
            </label>

            <button
              type="button"
              disabled={
                scanning ||
                !modelsReady ||
                !activeSession ||
                activeSession.session_status !== 'active' ||
                (!cameraActive && !testImageSrc)
              }
              onClick={() => {
                if (cameraActive && videoRef.current) runFrameRecognition(videoRef.current);
                else if (imgRef.current) runFrameRecognition(imgRef.current);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              <Scan className="w-3.5 h-3.5" />
              <span>{scanning ? 'Detecting & Matching...' : 'Scan Frame & Propose Attendance'}</span>
            </button>
          </div>
        </div>

        {/* Right column: Review Queue + Manual Fallback */}
        <div className="lg:col-span-5 space-y-5">
          {/* AI Recognition Review Queue */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">AI Recognition Review Queue</h3>
                <p className="text-xs text-slate-500">Faculty approval required for proposals</p>
              </div>
              {pendingProposals.length > 0 && (
                <button
                  type="button"
                  onClick={handleApproveAll}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-md whitespace-nowrap"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Approve All ({pendingProposals.length})</span>
                </button>
              )}
            </div>

            {pendingProposals.length === 0 && uncertainQueue.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No pending AI proposals or uncertain detections in queue.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {pendingProposals.map((rec) => (
                  <div key={rec.attendance_id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-medium text-slate-900">
                        {rec.roll_number} · {rec.student_name}
                      </div>
                      <div className="text-teal-700 font-mono tabular-nums">
                        Cosine similarity: {Number(rec.confidence_score || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleReviewAction(rec.attendance_id, 'approve', 'Present')}
                        className="p-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded"
                        title="Approve Present"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewAction(rec.attendance_id, 'reject')}
                        className="p-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded"
                        title="Reject Proposal"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

                {uncertainQueue.map((item, idx) => (
                  <div key={`${item.face_index}-${idx}`} className="py-2.5 flex items-center justify-between gap-2 text-xs bg-amber-50/50 px-2 rounded">
                    <div>
                      <div className="font-medium text-amber-900">
                        Uncertain: {item.student_name || 'Candidate'} ({item.roll_number})
                      </div>
                      <div className="text-amber-700 font-mono tabular-nums">
                        Similarity {item.cosine_similarity.toFixed(2)} — Manual verification needed
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleResolveUncertain(item, true)}
                        className="px-2 py-1 bg-slate-900 text-white rounded text-xs"
                      >
                        Mark Present
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveUncertain(item, false)}
                        className="px-2 py-1 border border-slate-300 bg-white text-slate-700 rounded text-xs"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Independent Manual Attendance Alternative */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-700" />
              <h3 className="text-sm font-semibold text-slate-900">Manual Attendance Entry</h3>
            </div>
            <p className="text-xs text-slate-500">
              Independent non-biometric attendance fallback for any enrolled student.
            </p>
            <form onSubmit={handleManualMark} className="space-y-3">
              <select
                disabled={!activeSession || activeSession.session_status !== 'active'}
                value={manualStudentId}
                onChange={(e) => setManualStudentId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {enrolledStudents.map((st) => (
                  <option key={st.student_id} value={st.student_id}>
                    {st.roll_number} — {st.name} {st.non_biometric_opt_out ? '(Non-Biometric)' : ''}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={manualStatus}
                  onChange={(e) =>
                    setManualStatus(e.target.value as 'Present' | 'Late' | 'Excused' | 'Absent')
                  }
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Present">Present</option>
                  <option value="Late">Late</option>
                  <option value="Excused">Excused</option>
                  <option value="Absent">Absent</option>
                </select>
                <input
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Optional note"
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <button
                type="submit"
                disabled={!activeSession || activeSession.session_status !== 'active' || !manualStudentId}
                className="w-full py-2 px-4 text-xs font-medium bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg"
              >
                Record Manual Attendance
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Session Attendance Table */}
      {activeSession && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Session #{activeSession.session_id} Recorded Roster ({sessionRecords.length} entries)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Roll No</th>
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Method</th>
                  <th className="py-2.5 px-4">Confidence</th>
                  <th className="py-2.5 px-4">Reviewed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessionRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                      No attendance marked yet in this session. Scan a frame or use Manual Attendance Entry.
                    </td>
                  </tr>
                ) : (
                  sessionRecords.map((rec) => (
                    <tr key={rec.attendance_id}>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{rec.roll_number}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">{rec.student_name}</td>
                      <td
                        className={`py-2.5 px-4 font-medium text-xs ${
                          rec.status === 'Present'
                            ? 'text-teal-700'
                            : rec.status === 'Absent'
                            ? 'text-red-600'
                            : 'text-amber-700'
                        }`}
                      >
                        {rec.status}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">
                        {rec.verification_method.replaceAll('_', ' ')}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-slate-600">
                        {rec.confidence_score !== null ? rec.confidence_score.toFixed(2) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-500">{rec.reviewed_by || 'Pending'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
