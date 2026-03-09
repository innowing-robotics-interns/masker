import yaml
import torch
import numpy as np
from sklearn.cluster import DBSCAN
from torch.nn import functional as F
class Predictor:
    def __init__(self, model_settings_path: str):
        """Initializes the Predictor with a model and its settings.

        :param model_settings_path: Path to the YAML file containing model settings
        :type model_settings_path: str
        """
        try:

            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            print(f"Using device: {self.device}")
            self.model_settings = self._load_model_settings(model_settings_path)
            self.model = self._init_model(self.model_settings['model_type'], model_state_dict=None)
            self.model.load_state_dict(torch.load(self.model_settings['pth_path'], map_location=self.device))
            self.model.eval()

        except Exception as e:
            raise RuntimeError(f"Failed to initialize Predictor: {e}")

    def __call__(self, image: torch.Tensor | np.ndarray, mode:str = 'slide_window') -> torch.Tensor:
        """Runs the model on the input tensor.

        :param image: Input tensor to the model
        :param mode: Inference mode ('slide_window' or 'normal')
        :type image: torch.Tensor
        :type mode: str
        :return: Model output
        :rtype: torch.Tensor
        """
        with torch.no_grad():
            if isinstance(image, np.ndarray):
                # Convert numpy array to tensor
                if len(image.shape) == 3 and image.shape[2] == 3:  # H, W, C format
                    image = torch.from_numpy(image.transpose(2, 0, 1)).float() / 255.0
                else:
                    raise ValueError("Input image should be in H, W, C format for numpy arrays")
            elif isinstance(image, torch.Tensor):
                if image.dim() != 3 or image.size(0) != 3:
                    raise ValueError("Input tensor should be in C, H, W format for PyTorch tensors")

            image = image.to(self.device)

            if mode == 'slide_window':
                predictor = SlidingWindowCrop(
                    window_size=self.model_settings['window_size'],
                    overlap=self.model_settings['overlap'],
                )
            elif mode == 'normal':
                # For normal mode, ensure we add batch dimension
                predictor = lambda model, img: torch.sigmoid(model(img.unsqueeze(0))).squeeze(0)
            else:
                raise ValueError(f"Unsupported mode: {mode}")

            output = predictor(self.model, image)
            output = output.cpu().numpy()
            return output

    def dbscan(self, output, eps=0.5, min_samples=5):
        """Applies DBSCAN clustering on the output mask.

        :param output: Model output mask
        :type output: np.ndarray
        :param threshold: Threshold to binarize the output
        :type threshold: float
        :param eps: DBSCAN epsilon parameter
        :type eps: float
        :param min_samples: DBSCAN minimum samples parameter
        :type min_samples: int
        :return: Clustering result as a binary mask
        :rtype: np.ndarray
        """

        if output.max() > 1.0:
            output = output / 255.0 # Normalize to 0-1 range

        coords = np.column_stack(np.where(output))


        if coords.shape[0] == 0:
            return np.zeros_like(output)

        clustering = DBSCAN(eps=eps, min_samples=min_samples).fit(coords)
        labels = clustering.labels_

        unique_labels = np.unique(labels)

        # Count points in each valid cluster
        valid_clusters = 0
        for label in unique_labels:
            if label != -1:
                valid_clusters += 1

        print(f"Total valid clusters: {valid_clusters}")

        output_dbscan = np.zeros_like(output)
        for label in unique_labels:
            if label != -1:
                cluster_mask = labels == label
                output_dbscan[coords[cluster_mask, 0], coords[cluster_mask, 1]] = 1

        output_dbscan = (output_dbscan * 255).astype(np.uint8) # back to 0-255 range

        return output_dbscan

    def _load_model_settings(self, file_path):
        """Loads model settings from a YAML file.

        :param file_path: Path to the YAML file containing model settings
        :type file_path: str
        :return: Dictionary containing model settings
        :rtype: dict
        """

        try:
            with open(file_path, 'r') as file:
                settings = yaml.safe_load(file)
                return settings
        except Exception as e:
            raise RuntimeError(f"Failed to load model settings: {e}")

    def _init_model(self, model_type:str, model_state_dict:dict):
        model_type = model_type.lower()
        if model_type == 'hnet':
            from model.hnet import HNet
            model = HNet()
        elif model_type == 'unet':
            from model.unet import UNet
            model = UNet()
        elif model_type == 'deepcrack':
            from model.deepcrack import DeepCrack
            model = DeepCrack()
        elif model_type == 'segformer':
            from model.segformer import SegFormer
            model = SegFormer(pretrained=True)
        elif model_type == 'attention_unet':
            from model.attention_unet import AttentionUNet
            model = AttentionUNet()
        else:
            raise ValueError(f"Unsupported model type: {model_type}")

        if model_state_dict:
            try:
                model.load_state_dict(model_state_dict)
            except Exception as e:
                raise RuntimeError(f"Failed to load model state dict: {e}")
        return model.to(self.device)

class SlidingWindowCrop:
    """
    Perform inference on large images using sliding window approach
    """
    def __init__(self, window_size=448, overlap=0.2):
        """
        Args:
            window_size: Size of sliding window (default 448)
            overlap: Overlap ratio between windows (default 0.2)
        """
        self.window_size = window_size
        self.overlap = overlap

    def __call__(self, model, image):
        """
        Args:
            model: Trained model
            image: Input image tensor (C, H, W) or numpy array (H, W, C)

        Returns:
            prediction: Full resolution prediction tensor
        """
        device = next(model.parameters()).device

        # Handle both numpy arrays and tensors
        if isinstance(image, np.ndarray):
            # Convert numpy array to tensor
            if len(image.shape) == 3 and image.shape[2] == 3:  # H, W, C format
                image = torch.from_numpy(image.transpose(2, 0, 1)).float() / 255.0
            else:
                raise ValueError("Input image should be in H, W, C format for numpy arrays")

        # Resize to multiples of 32 for model compatibility
        C, H, W = image.shape
        new_h = (H // 32) * 32
        new_w = (W // 32) * 32

        if H != new_h or W != new_w:
            image = F.interpolate(image.unsqueeze(0), size=(new_h, new_w), mode='bilinear', align_corners=False).squeeze(0)
            H, W = new_h, new_w

        stride = int(self.window_size * (1 - self.overlap))

        # Ensure complete coverage by calculating windows differently
        h_windows = (H + stride - 1) // stride
        w_windows = (W + stride - 1) // stride

        # Initialize prediction and weight maps
        prediction = torch.zeros((1, H, W), device=device)
        weight_map = torch.zeros((H, W), device=device)

        # Create Gaussian weight for blending
        gaussian_weight = torch.ones((self.window_size, self.window_size), device=device)
        center = self.window_size // 2
        for i in range(self.window_size):
            for j in range(self.window_size):
                dist = ((i - center) ** 2 + (j - center) ** 2) ** 0.5
                gaussian_weight[i, j] = np.exp(-(dist ** 2) / (2 * (center / 3) ** 2))

        model.eval()
        with torch.no_grad():
            for h_idx in range(h_windows):
                for w_idx in range(w_windows):
                    # Calculate window coordinates ensuring full coverage
                    h_start = min(h_idx * stride, H - self.window_size)
                    w_start = min(w_idx * stride, W - self.window_size)

                    # Ensure we don't go beyond image boundaries
                    h_start = max(0, h_start)
                    w_start = max(0, w_start)
                    h_end = min(h_start + self.window_size, H)
                    w_end = min(w_start + self.window_size, W)

                    # Extract window with proper padding if needed
                    if h_end - h_start < self.window_size or w_end - w_start < self.window_size:
                        # Pad the window to ensure it's exactly window_size x window_size
                        window = image[:, h_start:h_end, w_start:w_end]
                        pad_h = max(0, self.window_size - (h_end - h_start))
                        pad_w = max(0, self.window_size - (w_end - w_start))

                        # Use reflection padding instead of zero padding
                        # window = F.pad(window, (0, pad_w, 0, pad_h), mode='reflect')
                    else:
                        window = image[:, h_start:h_end, w_start:w_end]

                    window_batch = window.unsqueeze(0).to(device)

                    # Get prediction for window - this will be handled by the caller
                    window_pred = self._predict_window(model, window_batch)
                    window_pred = window_pred.squeeze(0)

                    # Crop prediction back to actual window size if we padded
                    actual_h = h_end - h_start
                    actual_w = w_end - w_start
                    window_pred = window_pred[:, :actual_h, :actual_w]

                    # Create corresponding weight map for this window
                    current_weight = gaussian_weight[:actual_h, :actual_w]

                    # Apply Gaussian weighting
                    weighted_pred = window_pred * current_weight

                    # Add to full prediction with weights
                    prediction[:, h_start:h_end, w_start:w_end] += weighted_pred
                    weight_map[h_start:h_end, w_start:w_end] += current_weight

        # Normalize by weights to handle overlaps
        weight_map[weight_map == 0] = 1  # Avoid division by zero
        prediction = prediction / weight_map.unsqueeze(0)

        return prediction.squeeze(0)

    def _predict_window(self, model, window_batch):
        """
        Predict on a single window - to be overridden or configured based on model type
        """
        # Default implementation - assumes single output model
        return torch.sigmoid(model(window_batch))

    def set_model_predictor(self, predictor_func):
        """
        Set custom prediction function for different model types
        """
        self._predict_window = predictor_func

if __name__ == "__main__":
    # Test Functionality
    import cv2
    image_path = 'datasets/137.png'
    predictor = Predictor(model_settings_path='model_settings.yaml')
    image = cv2.imread(image_path)
    output_original = predictor(image)
    output = predictor.dbscan(output_original, threshold=0.5, eps=5, min_samples=5)
    import matplotlib.pyplot as plt
    plt.figure(figsize=(10, 5))
    plt.subplot(1, 2, 1)
    plt.imshow(output_original, cmap='gray')
    plt.title('Original Output')
    plt.axis('off')
    plt.subplot(1, 2, 2)
    plt.imshow(output, cmap='gray')
    plt.title('DBSCAN Output')
    plt.axis('off')
    plt.show()
