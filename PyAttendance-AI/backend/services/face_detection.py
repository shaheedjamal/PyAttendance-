"""Configurable OpenCV multi-face detection, quality assessment, and alignment service."""
from dataclasses import dataclass
import cv2
import numpy as np


@dataclass
class DetectedFace:
    bbox: tuple[int, int, int, int]
    aligned_rgb: np.ndarray
    quality_score: float
    warnings: list[str]


class FaceDetectionService:
    def __init__(self, backend: str = "haar"):
        self.backend = backend
        self.haar_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        self.eye_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_eye.xml"
        )
        self._mtcnn = None

    def _get_mtcnn(self):
        if self._mtcnn is None:
            from facenet_pytorch import MTCNN
            self._mtcnn = MTCNN(keep_all=True, image_size=160, margin=20)
        return self._mtcnn

    def detect_faces(self, bgr_image: np.ndarray, target_size: tuple[int, int] = (160, 160)) -> list[DetectedFace]:
        if bgr_image is None or bgr_image.size == 0:
            return []

        rgb = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB)
        gray = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2GRAY)
        boxes: list[tuple[int, int, int, int]] = []

        if self.backend == "mtcnn":
            mtcnn = self._get_mtcnn()
            raw_boxes, _ = mtcnn.detect(rgb)
            if raw_boxes is not None:
                for x1, y1, x2, y2 in raw_boxes:
                    x, y = max(0, int(x1)), max(0, int(y1))
                    w, h = max(1, int(x2 - x1)), max(1, int(y2 - y1))
                    boxes.append((x, y, w, h))
        else:
            detected = self.haar_cascade.detectMultiScale(
                gray, scaleFactor=1.12, minNeighbors=5, minSize=(48, 48)
            )
            boxes = [(int(x), int(y), int(w), int(h)) for (x, y, w, h) in detected]

        results: list[DetectedFace] = []
        img_h, img_w = gray.shape[:2]

        for x, y, w, h in boxes:
            x2, y2 = min(img_w, x + w), min(img_h, y + h)
            crop_gray = gray[y:y2, x:x2]
            crop_rgb = rgb[y:y2, x:x2]
            if crop_rgb.size == 0:
                continue

            warnings: list[str] = []
            # Sharpness check via Laplacian variance
            blur_var = float(cv2.Laplacian(crop_gray, cv2.CV_64F).var())
            if blur_var < 35.0:
                warnings.append("Low sharpness / motion blur")
            mean_lum = float(np.mean(crop_gray))
            if mean_lum < 45.0 or mean_lum > 225.0:
                warnings.append("Suboptimal lighting exposure")
            if w < 64 or h < 64:
                warnings.append("Small face bounding box")

            # Eye-based affine alignment when two eyes are detected
            aligned = crop_rgb
            eyes = self.eye_cascade.detectMultiScale(crop_gray, scaleFactor=1.1, minNeighbors=4)
            if len(eyes) >= 2:
                eyes_sorted = sorted(eyes, key=lambda e: e[0])[:2]
                (ex1, ey1, ew1, eh1), (ex2, ey2, ew2, eh2) = eyes_sorted
                c1 = (ex1 + ew1 / 2.0, ey1 + eh1 / 2.0)
                c2 = (ex2 + ew2 / 2.0, ey2 + eh2 / 2.0)
                angle = np.degrees(np.arctan2(c2[1] - c1[1], c2[0] - c1[0]))
                if abs(angle) <= 25.0:
                    center = (crop_rgb.shape[1] / 2.0, crop_rgb.shape[0] / 2.0)
                    rot_mat = cv2.getRotationMatrix2D(center, angle, 1.0)
                    aligned = cv2.warpAffine(crop_rgb, rot_mat, (crop_rgb.shape[1], crop_rgb.shape[0]))

            resized = cv2.resize(aligned, target_size, interpolation=cv2.INTER_AREA)
            size_score = min(1.0, w / 120.0)
            sharp_score = min(1.0, blur_var / 140.0)
            quality = round(max(0.1, min(0.99, 0.55 * sharp_score + 0.45 * size_score)), 3)
            results.append(DetectedFace(bbox=(x, y, w, h), aligned_rgb=resized, quality_score=quality, warnings=warnings))

        return results
