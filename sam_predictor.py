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

    def __call__(self, image, mode: str = "normal") -> np.ndarray:
        """
        Run SAM3 with text prompt. Ignores mode for now.
        Returns: np.ndarray (H, W), float, values in [0, 1] — same as Predictor.__call__.
        """
        pil_image = self._image_to_pil(image)
        self.image = pil_image
        self.inference_state = self.processor.set_image(self.image)
        self.output = self.processor.set_text_prompt(
            state=self.inference_state, prompt=self.text_prompt
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


if __name__ == "__main__":
    sam_predictor = SAMPredictor()
    result = sam_predictor("datasets/137.png")
    plt.imshow(result, cmap="gray")
    plt.axis("off")
    plt.savefig("mask.png")
    print(f"Returned shape {result.shape}, dtype {result.dtype}, range [{result.min():.2f}, {result.max():.2f}]")
