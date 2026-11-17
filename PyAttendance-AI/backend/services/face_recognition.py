"""Facial embedding extraction and cosine similarity matching service."""
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity as sk_cosine


class FaceRecognitionService:
    def __init__(self):
        self._resnet = None

    def _get_resnet(self):
        if self._resnet is None:
            from facenet_pytorch import InceptionResnetV1
            self._resnet = InceptionResnetV1(pretrained="vggface2").eval()
        return self._resnet

    def extract_embedding(self, aligned_rgb_160: np.ndarray) -> list[float]:
        """Convert aligned 160x160 RGB face crop into L2-normalized 512-D FaceNet embedding."""
        import torch

        tensor = torch.from_numpy(aligned_rgb_160).permute(2, 0, 1).float()
        tensor = (tensor - 127.5) / 128.0
        with torch.no_grad():
            emb = self._get_resnet()(tensor.unsqueeze(0)).squeeze(0).cpu().numpy()
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        return [float(x) for x in emb.tolist()]

    @staticmethod
    def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
        a = np.asarray(vec_a, dtype=np.float32).reshape(1, -1)
        b = np.asarray(vec_b, dtype=np.float32).reshape(1, -1)
        if a.shape[1] != b.shape[1] or a.shape[1] == 0:
            return -1.0
        return float(sk_cosine(a, b)[0][0])

    @classmethod
    def match_against_templates(
        cls,
        query_embedding: list[float],
        enrolled_templates: list[tuple[int, str, str, list[float]]],
        recognition_threshold: float,
        uncertain_threshold: float,
    ) -> dict:
        """
        Compare query embedding against enrolled (student_id, roll_number, name, embedding) templates.
        Returns decision in {'matched', 'uncertain', 'unknown'}.
        """
        best = None
        best_sim = -1.0

        for student_id, roll_number, name, tpl_emb in enrolled_templates:
            sim = cls.cosine_similarity(query_embedding, tpl_emb)
            if sim > best_sim:
                best_sim = sim
                best = (student_id, roll_number, name)

        if best is not None and best_sim >= recognition_threshold:
            return {
                "decision": "matched",
                "student_id": best[0],
                "roll_number": best[1],
                "student_name": best[2],
                "cosine_similarity": round(best_sim, 4),
            }
        if best is not None and best_sim >= uncertain_threshold:
            return {
                "decision": "uncertain",
                "student_id": best[0],
                "roll_number": best[1],
                "student_name": best[2],
                "cosine_similarity": round(best_sim, 4),
            }
        return {
            "decision": "unknown",
            "student_id": None,
            "roll_number": None,
            "student_name": None,
            "cosine_similarity": round(max(best_sim, 0.0), 4),
        }
