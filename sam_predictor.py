import torch
import os
from dotenv import load_dotenv
import numpy as np
import matplotlib.pyplot as plt

from PIL import Image
import cv2
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor


class SAMPredictor:
    """Same return contract as Predictor.__call__: np.ndarray (H, W), float, values in [0, 1]."""

    def __init__(self, text_prompt: str = "cracks"):
        load_dotenv()
        self.hf_token = os.getenv("HF_TOKEN")
        if self.hf_token is not None:
            os.environ["HF_TOKEN"] = self.hf_token
        self.model = build_sam3_image_model()
        self.processor = Sam3Processor(self.model)
        self.text_prompt = text_prompt

    def _image_to_pil(self, image) -> Image.Image:
        """Convert np.ndarray (H,W,C) BGR or path to PIL RGB."""
        if isinstance(image, (str, os.PathLike)):
            return Image.open(image).convert("RGB")
        if isinstance(image, np.ndarray):
            # cv2 is BGR
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            return Image.fromarray(rgb)
        if isinstance(image, Image.Image):
            return image.convert("RGB")
        raise TypeError("image must be path (str), np.ndarray (H,W,C), or PIL Image")

    def __call__(self, image, mode: str = "normal",
                 text_prompt: str = None,
                 confidence_threshold: float = None) -> np.ndarray:
        """
        Run SAM3 with a text prompt. Ignores mode for now.

        :param text_prompt: overrides the default prompt ("cracks") for this run.
        :param confidence_threshold: overrides the processor's detection keep
            threshold (default 0.5) for this run. Lower it (e.g. 0.25-0.3) to
            surface low-confidence crack detections; raise it to be stricter.
            After the call, ``self.scores`` holds the kept detections' scores
            (so callers can report how many SAM found).
        Returns: np.ndarray (H, W), float, values in [0, 1] — same as Predictor.
        """
        pil_image = self._image_to_pil(image)
        self.image = pil_image

        # Apply the per-call confidence threshold before grounding runs
        # (set_text_prompt -> _forward_grounding reads processor.confidence_threshold).
        if confidence_threshold is not None:
            self.processor.confidence_threshold = float(confidence_threshold)

        prompt = text_prompt if text_prompt else self.text_prompt

        self.inference_state = self.processor.set_image(self.image)
        self.output = self.processor.set_text_prompt(
            state=self.inference_state, prompt=prompt
        )
        self.masks = self.output["masks"]
        self.boxes = self.output["boxes"]
        self.scores = self.output["scores"]

        # Match Predictor: single (H,W) float array in [0, 1]
        if self.masks.numel() == 0:
            h, w = pil_image.size[1], pil_image.size[0]
            return np.zeros((h, w), dtype=np.float32)
        combined = torch.any(self.masks, dim=0).squeeze(0)
        out = combined.cpu().numpy().astype(np.float32)
        return out

    def last_detection_info(self) -> dict:
        """Number and scores of detections kept in the most recent __call__."""
        scores = getattr(self, "scores", None)
        if scores is None:
            return {"num_detections": 0, "scores": []}
        try:
            arr = scores.detach().cpu().numpy().reshape(-1)
        except Exception:
            arr = np.asarray(scores).reshape(-1)
        return {
            "num_detections": int(arr.shape[0]),
            "scores": [round(float(s), 3) for s in arr.tolist()],
        }


if __name__ == "__main__":
    sam_predictor = SAMPredictor()
    result = sam_predictor("datasets/137.png")
    plt.imshow(result, cmap="gray")
    plt.axis("off")
    plt.savefig("mask.png")
    print(f"Returned shape {result.shape}, dtype {result.dtype}, range [{result.min():.2f}, {result.max():.2f}]")
