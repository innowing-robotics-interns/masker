from flask import Blueprint, request, jsonify
import cv2
import numpy as np
import base64
from predictor import Predictor
from sam_predictor import SAMPredictor

magic_pen_router = Blueprint('magic_pen_router', __name__)

# Initialize predictors
predictor = Predictor(model_settings_path='model_settings.yaml')
sam_predictor = SAMPredictor()

class PredictionMerger:
    def __init__(self, canvas_width, canvas_height):
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height

        # Arrays to store accumulated values and counts for averaging
        self.accumulated_values = np.zeros((canvas_height, canvas_width), dtype=np.float64)
        self.pixel_counts = np.zeros((canvas_height, canvas_width), dtype=np.int32)
        # New: track how many times each pixel has been "brushed" by the pen
        self.brush_counts = np.zeros((canvas_height, canvas_width), dtype=np.int32)

    def add_crop_prediction(self, crop_info, prediction_mask):
        """
        Add a crop prediction to the merger

        Args:
            crop_info: Dictionary containing centerX, centerY, width, height
            prediction_mask: 2D numpy array of the prediction normalized to [0.0, 1.0]
        """
        center_x = crop_info['centerX']
        center_y = crop_info['centerY']
        crop_width = crop_info['width']
        crop_height = crop_info['height']

        # Calculate crop boundaries on the main canvas
        start_x = int(center_x - crop_width // 2)
        start_y = int(center_y - crop_height // 2)
        end_x = start_x + crop_width
        end_y = start_y + crop_height

        # Clamp to canvas boundaries
        canvas_start_x = max(0, start_x)
        canvas_start_y = max(0, start_y)
        canvas_end_x = min(self.canvas_width, end_x)
        canvas_end_y = min(self.canvas_height, end_y)

        # Calculate the valid region in the crop
        crop_start_x = canvas_start_x - start_x
        crop_start_y = canvas_start_y - start_y
        crop_end_x = crop_start_x + (canvas_end_x - canvas_start_x)
        crop_end_y = crop_start_y + (canvas_end_y - canvas_start_y)

        # Extract the valid portion of the prediction
        if crop_end_x > crop_start_x and crop_end_y > crop_start_y:
            valid_prediction = prediction_mask[crop_start_y:crop_end_y, crop_start_x:crop_end_x]

            # Add to accumulated values and increment counts
            # Note: we now accumulate normalized float values (0..1)
            self.accumulated_values[canvas_start_y:canvas_end_y, canvas_start_x:canvas_end_x] += valid_prediction
            self.pixel_counts[canvas_start_y:canvas_end_y, canvas_start_x:canvas_end_x] += 1
            # Increment brush counts for this region (each crop counts as a brush)
            self.brush_counts[canvas_start_y:canvas_end_y, canvas_start_x:canvas_end_x] += 1

    # Edited generate_final_prediction
    def generate_final_prediction(self, apply_morphology=True, morph_kernel_size=3, morph_iterations=2,
                                  apply_dbscan=True, db_eps=10, db_min_samples=5,
                                  brush_multiplier_base=2, threshold=0.5):
        """
        Generate the final averaged prediction with optional morphological filtering

        Args:
            apply_morphology: Whether to apply morphological operations
            morph_kernel_size: Size of the morphological kernel (default: 3)
            morph_iterations: Number of iterations for morphological operations (default: 2)
            brush_multiplier_base: Base multiplier for brush counts (default 2). For pixels brushed n times
                                  multiplier = brush_multiplier_base ** (n-1)
            threshold: Threshold applied after averaging & multiplying (in 0..1)

        Returns:
            2D numpy array of the final prediction (0-255)
        """
        # Avoid division by zero
        mask = self.pixel_counts > 0
        final_prediction = np.zeros_like(self.accumulated_values, dtype=np.uint8)


        # Work in float normalized space (0..1)
        final_float = np.zeros_like(self.accumulated_values, dtype=np.float64)
        # Average where we have predictions -> values in 0..1
        final_float[mask] = (self.accumulated_values[mask] / self.pixel_counts[mask])

        # Apply brush-based multiplicative scaling on the averaged float values:
        # For pixels brushed n times (n>=1), multiply by brush_multiplier_base ** (n-1).
        if np.any(self.brush_counts > 0):
            brush_counts_mask = self.brush_counts.astype(np.int32)
            positive_brush_mask = brush_counts_mask > 0
            # compute multipliers (float)
            multipliers = np.ones_like(final_float, dtype=np.float64)
            multipliers[positive_brush_mask] = brush_multiplier_base ** (brush_counts_mask[positive_brush_mask] - 1)
            # Apply multipliers where we have averaged predictions
            apply_mask = mask & positive_brush_mask
            if np.any(apply_mask):
                final_float[apply_mask] = final_float[apply_mask] * multipliers[apply_mask]

        # Clip to 0..1 and then threshold to binary mask
        final_float = np.clip(final_float, 0.0, 1.0)
        binary_mask = (final_float > float(threshold)).astype(np.uint8) * 255

        # Proceed with DBSCAN and morphology on the binary mask
        final_prediction = binary_mask

        if apply_dbscan:
            final_prediction = predictor.dbscan(final_prediction, eps=db_eps, min_samples=db_min_samples)


        # Apply morphological filtering if requested
        if apply_morphology and np.any(final_prediction > 0):
            final_prediction = self.apply_morphological_filtering(
                final_prediction,
                kernel_size=morph_kernel_size,
                iterations=morph_iterations
            )


        return final_prediction

    def apply_morphological_filtering(self, mask, kernel_size=3, iterations=2):
        """
        Apply morphological operations to clean up the mask

        Args:
            mask: Input binary mask (0-255)
            kernel_size: Size of the morphological kernel
            iterations: Number of iterations for each operation

        Returns:
            Cleaned binary mask (0-255)
        """
        # Convert to binary (0 or 1)
        binary_mask = (mask > 127).astype(np.uint8)

        # Create morphological kernel
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))

        # Apply morphological closing (fill holes and connect nearby objects)
        closed = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel, iterations=iterations)

        # Apply morphological opening (remove noise and small objects)
        opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kernel, iterations=1)

        # Optional: Apply median filter to further reduce noise
        if kernel_size >= 3:
            opened = cv2.medianBlur(opened, min(kernel_size, 5))

        # Convert back to 0-255 range
        return (opened * 255).astype(np.uint8)

def decode_base64_image(base64_string):
    """
    Decode base64 image string to numpy array

    Args:
        base64_string: Base64 encoded image string

    Returns:
        numpy array of the image
    """
    # Remove data URL prefix if present
    if base64_string.startswith('data:image'):
        base64_string = base64_string.split(',', 1)[1]

    # Decode base64 to bytes
    image_bytes = base64.b64decode(base64_string)

    # Convert to numpy array
    nparr = np.frombuffer(image_bytes, np.uint8)

    # Decode image
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Failed to decode image")

    return image

def encode_mask_to_base64(mask):
    """
    Encode numpy mask to base64 PNG string

    Args:
        mask: 2D numpy array (0-255)

    Returns:
        Base64 encoded PNG string with data URL prefix
    """
    # Ensure mask is uint8
    if mask.dtype != np.uint8:
        mask = mask.astype(np.uint8)

    # Encode to PNG
    success, encoded_img = cv2.imencode('.png', mask)
    if not success:
        raise ValueError("Failed to encode mask to PNG")

    # Convert to base64
    mask_base64 = base64.b64encode(encoded_img).decode('utf-8')

    return f"data:image/png;base64,{mask_base64}"

@magic_pen_router.route('/predict_crops', methods=['POST'])
def predict_crops():
# Added brush_multiplier_base and threshold parameters
    """
    Process multiple crops and return a merged prediction mask

    Expected JSON payload:
    {
        "crops": [
            {
                "id": 0,
                "image_base64": "data:image/png;base64,...",
                "centerX": 100,
                "centerY": 100,
                "width": 256,
                "height": 256,
                "canvas_width": 800,
                "canvas_height": 600,
                "timestamp": 1234567890,
                "line_distance": 50.5
            },
            ...
        ],
        "apply_morphology": true,  // Optional: Apply morphological filtering (default: true)
        "morph_kernel_size": 3,    // Optional: Kernel size for morphology (default: 3)
        "morph_iterations": 2      // Optional: Number of iterations (default: 2)
    }

    Returns:
    {
        "status": "success",
        "message": "Predictions completed successfully",
        "merged_mask_base64": "data:image/png;base64,...",
        "num_crops_processed": 5,
        "canvas_dimensions": [800, 600],
        "morphology_applied": true
    }
    """
    try:
        # Get crops from request
        if not request.is_json:
            return jsonify({
                "status": "error",
                "message": "Request must be JSON"
            }), 400

        data = request.json
        if data is None:
            return jsonify({
                "status": "error",
                "message": "Invalid JSON data"
            }), 400

        crops = data.get('crops', [])
        predict_mode = data.get('mode', 'normal')  # Default to normal mode

        # Brush multiplier base and threshold (use defaults if not provided)
        sensitivity = data.get('sensitivity', 5)
        print(sensitivity)
        threshold = data.get('threshold', 0.5)

        # Get morphological filtering parameters (optional)
        apply_morphology = data.get('apply_morphology', True)
        morph_kernel_size = data.get('morph_kernel_size', 3)
        morph_iterations = data.get('morph_iterations', 2)

        # Get DBSCAN parameters (optional)
        apply_dbscan = data.get('apply_dbscan', True)
        db_eps = data.get('db_eps', 10)
        db_min_samples = data.get('db_min_samples', 5)

        if not crops:
            return jsonify({
                "status": "error",
                "message": "No crops provided"
            }), 400

        # Get canvas dimensions from the first crop
        first_crop = crops[0]
        canvas_width = first_crop.get('canvas_width')
        canvas_height = first_crop.get('canvas_height')

        if not canvas_width or not canvas_height:
            return jsonify({
                "status": "error",
                "message": "Canvas dimensions not provided in crop data"
            }), 400

        # Initialize the prediction merger
        merger = PredictionMerger(canvas_width, canvas_height)

        processed_crops = 0
        failed_crops = []

        # Process each crop
        for i, crop in enumerate(crops):
            try:
                # Decode the crop image
                crop_image = decode_base64_image(crop['image_base64'])

                # Run prediction on the crop
                prediction_result = predictor(crop_image, mode=predict_mode)

                # Process prediction: use raw probabilities (normalize to 0..1) and add to merger
                if prediction_result.ndim > 2:
                    prediction_result = prediction_result.squeeze()

                # Ensure float and normalized to [0,1]
                pred = prediction_result.astype(np.float32)
                if pred.max() > 1.0:
                    pred = pred / 255.0

                # Add normalized prediction to merger (multiplication & thresholding happens later)
                merger.add_crop_prediction(crop, pred)
                processed_crops += 1

            except Exception as e:
                print(f"Error processing crop {i}: {str(e)}")
                failed_crops.append({
                    "crop_id": crop.get('id', i),
                    "error": str(e)
                })
                continue

        if processed_crops == 0:
            return jsonify({
                "status": "error",
                "message": "No crops were successfully processed",
                "failed_crops": failed_crops
            }), 500

        # Generate final merged prediction
        try:
            final_mask = merger.generate_final_prediction(
                apply_morphology=apply_morphology,
                morph_kernel_size=morph_kernel_size,
                morph_iterations=morph_iterations,
                apply_dbscan=apply_dbscan,
                db_eps=db_eps,
                db_min_samples=db_min_samples,
                brush_multiplier_base=sensitivity,
                threshold=threshold
            )

            # Encode final mask to base64
            merged_mask_base64 = encode_mask_to_base64(final_mask)

            response_data = {
                "status": "success",
                "message": f"Successfully processed {processed_crops} out of {len(crops)} crops",
                "merged_mask_base64": merged_mask_base64,
                "num_crops_processed": processed_crops,
                "canvas_dimensions": [canvas_width, canvas_height],
                "morphology_applied": apply_morphology,
                "morph_kernel_size": morph_kernel_size if apply_morphology else None,
                "morph_iterations": morph_iterations if apply_morphology else None,
                "dbscan_applied": apply_dbscan,
                "db_eps": db_eps if apply_dbscan else None,
                "db_min_samples": db_min_samples if apply_dbscan else None
            }

            # Include failed crops info if any
            if failed_crops:
                response_data["failed_crops"] = failed_crops
                response_data["num_failed_crops"] = len(failed_crops)

            return jsonify(response_data)

        except Exception as e:
            return jsonify({
                "status": "error",
                "message": f"Error generating final prediction: {str(e)}"
            }), 500

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": f"Server error: {str(e)}"
        }), 500

@magic_pen_router.route('/predict_single_crop', methods=['POST'])
def predict_single_crop():
    """
    Process a single crop for testing purposes

    Expected JSON payload:
    {
        "image_base64": "data:image/png;base64,...",
        "centerX": 100,
        "centerY": 100,
        "width": 256,
        "height": 256
    }

    Returns:
    {
        "status": "success",
        "prediction_base64": "data:image/png;base64,...",
        "crop_info": {...}
    }
    """
    try:
        if not request.is_json:
            return jsonify({
                "status": "error",
                "message": "Request must be JSON"
            }), 400

        data = request.json
        image_base64 = data.get('image_base64')
        predict_mode = data.get('mode', 'normal')  # Default to normal mode
        if not image_base64:
            return jsonify({
                "status": "error",
                "message": "No image data provided"
            }), 400

        # Decode and predict
        crop_image = decode_base64_image(image_base64)
        prediction_result = predictor(crop_image, mode=predict_mode)

        # Process prediction
        if prediction_result.ndim > 2:
            prediction_result = prediction_result.squeeze()

        # Apply DBSCAN if requested
        apply_dbscan = data.get('apply_dbscan', True)
        if apply_dbscan:
            db_eps = data.get('db_eps', 10)
            db_min_samples = data.get('db_min_samples', 5)
            binary_mask = predictor.dbscan(binary_mask, eps=db_eps, min_samples=db_min_samples)

        # Apply morphological filtering if requested
        apply_morphology = data.get('apply_morphology', True)
        if apply_morphology:
            morph_kernel_size = data.get('morph_kernel_size', 3)
            morph_iterations = data.get('morph_iterations', 2)

            # Create a temporary merger instance to use the morphological filtering method
            temp_merger = PredictionMerger(binary_mask.shape[1], binary_mask.shape[0])
            binary_mask = temp_merger.apply_morphological_filtering(
                binary_mask,
                kernel_size=morph_kernel_size,
                iterations=morph_iterations
            )

        # Encode result
        prediction_base64 = encode_mask_to_base64(binary_mask)

        return jsonify({
            "status": "success",
            "message": "Single crop prediction completed",
            "prediction_base64": prediction_base64,
            "crop_info": {
                "centerX": data.get('centerX'),
                "centerY": data.get('centerY'),
                "width": data.get('width'),
                "height": data.get('height')
            }
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": f"Error processing single crop: {str(e)}"
        }), 500


@magic_pen_router.route('/predict_sam', methods=['POST'])
def predict_sam():
    """
    Run SAM3 text-prompt segmentation on a full image.

    Expected JSON payload:
    {
        "image_base64": "data:image/png;base64,..."
    }

    Returns:
    {
        "status": "success",
        "merged_mask_base64": "data:image/png;base64,..."
    }
    """
    try:
        if not request.is_json:
            return jsonify({
                "status": "error",
                "message": "Request must be JSON"
            }), 400

        data = request.json
        image_base64 = data.get('image_base64')
        if not image_base64:
            return jsonify({
                "status": "error",
                "message": "No image data provided"
            }), 400

        image = decode_base64_image(image_base64)
        prediction = sam_predictor(image)

        if prediction.ndim > 2:
            prediction = prediction.squeeze()

        binary_mask = (prediction > 0.5).astype(np.uint8) * 255
        mask_base64 = encode_mask_to_base64(binary_mask)

        return jsonify({
            "status": "success",
            "merged_mask_base64": mask_base64
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": f"Error running SAM prediction: {str(e)}"
        }), 500
