from os import listdir
from os.path import join, isfile, splitext, basename
import base64
import re
import argparse
from typing import Union

from flask import Flask, render_template, jsonify, request, redirect, url_for
from predictor import Predictor
from magic_pen_router import magic_pen_router

predictor = Predictor(model_settings_path='model_settings.yaml')

parser = argparse.ArgumentParser()
# Config
parser.add_argument('--root_data_path', default="./datasets", type=str,
                    help="""Path to the root data folder. Must be the
                            parent folder containing category folders.
                            Defaults to ./datasets""")
args = parser.parse_args()


# Utility Functions
def atoi(text: str) -> Union[int, str]:
    """Transforms string-based integers into Python integers.
    Text that is not an integer remains as text.

    :param text: A potentially containing an integer
    :type text: str
    :return: An integer or a string
    :rtype: Union[int, str]
    """

    return int(text) if text.isdigit() else text


def natural_keys(text: str) -> list[Union[int, str]]:
    """Splits and parses zero padded, string-based integers
    so that comparison and sorting are in 'human' order.

    :param text: A string potentially containing an integer
    :type text: str
    :return: A split and integer-parsed list
    :rtype: list[Union[int, str]]
    """

    return [atoi(c) for c in re.split(r'(\d+)', text)]


def get_files(path: str) -> list[str]:
    """Retrieves a list of files from a directory sorted
    in human order.

    :param path: A string-based path to a valid directory
    :type path: str
    :return: A list of string-based file paths
    :rtype: list[str]
    """

    files = [f for f in listdir(path) if isfile(join(path, f))]
    files.sort(key=natural_keys)  # Sorted in human order
    return files


def get_image_paths(path: str) -> list[str]:
    """Retrieves a list of valid PNG or JPEG images in a
    specified directory. The paths returned are scoped at
    a level relative to the input path.

    :param path: A valid folder path
    :type path: str
    :return: A list of image file paths
    :rtype: list[str]
    """

    paths = get_files(path)
    imgs = []
    for img in paths:
        if (img.endswith('.jpg') or img.endswith('.png')
                or img.endswith('.jpeg')):
            imgs.append(join(path, img))
    return imgs


def get_base64_encoded_image(image_path: str) -> str:
    """Retrieves and encodes an image into a base64 string
    from a given path.

    :param image_path: A valid file path to an image
    :type image_path: str
    :return: A base64 encoded string
    :rtype: str
    """

    with open(image_path, "rb") as img_file:
        return base64.b64encode(img_file.read())


# Flask App
app = Flask(__name__,
            static_url_path='/static',
            static_folder='public')

# Register blueprints
app.register_blueprint(magic_pen_router, url_prefix='/magic_pen')


@app.route("/")
def index():
    return datasets()

@app.route("/datasets")
def datasets() -> str:
    datasets_path = args.root_data_path
    print(f"Looking for datasets in: {datasets_path}")
    try:
        datasets = [d for d in listdir(datasets_path) if not isfile(join(datasets_path, d))]
        print(f"Found datasets: {datasets}")
        return render_template('select_dataset.html', datasets=datasets)
    except Exception as e:
        print(f"Error accessing datasets: {e}")
        return f"Error: {e}", 500

@app.route("/masking", methods=["GET"])
def img_mask() -> str:
    return render_template('index.html',
                           dataset=request.args.get('dataset', 'none'))

@app.route("/datasets/<dataset>/<img_or_label>/<filename>", methods=["GET"])
def get_file(dataset: str, img_or_label: str, filename: str) -> str:

    path = join('datasets', dataset, img_or_label, filename)
    if not isfile(path):
        return jsonify({"status": "error", "message": "File not found."}), 404

    return get_base64_encoded_image(path)

# Temporary endpoint for giving images to the react frontend
@app.route("/datasets/<dataset>/<img_or_label>/<filename>/new", methods=["GET"])
def get_file_new(dataset: str, img_or_label: str, filename: str):
    path = join('datasets', dataset, img_or_label, filename)
    if not isfile(path):
        return jsonify({"status": "error", "message": "File not found."}), 404

    # Determine MIME type
    if filename.lower().endswith(('.jpg', '.jpeg')):
        mime_type = 'image/jpeg'
    else:
        mime_type = 'image/png'

    # Return actual image bytes with proper content type
    with open(path, 'rb') as img_file:
        from flask import Response
        return Response(img_file.read(), mimetype=mime_type)

@app.route('/datasets/<dataset>/images', methods=['GET'])
def get_image_list_in_dataset(dataset: str) -> str:
    path = join('datasets', dataset, 'images')
    images = get_files(path)
    return jsonify(images)

@app.route('/datasets/<dataset>/labels', methods=['GET'])
def get_label_list_in_dataset(dataset: str) -> str:
    path = join('datasets', dataset, 'labels')
    labels = get_files(path)
    return jsonify(labels)

@app.route('/datasets/<dataset>/<img_or_label>/<filename>', methods=['POST'])
def upload(dataset: str, img_or_label: str, filename: str) -> str:
    """Saves a file to the specified dataset's images or labels folder."""

    path = join('datasets', dataset, img_or_label, filename)

    # Ensure the directory exists
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    type = request.headers.get('type')
    if type == 'save':
        if img_or_label != 'labels':
            return jsonify({"status": "error", "message": "this method only allow for saving mask."}), 400
        mask = request.json.get('label')
        if not mask:
            return jsonify({"status": "error", "message": "No data provided."}), 400
        if (not is_base64_png(mask)) and (not is_base64_jpg(mask)):
            return jsonify({"status": "error", "message": "Data is not a valid base64 PNG or JPG."}), 400
        if (save(path, mask)):
            return jsonify({"status": "success", "message": f"File saved to {path}"}), 200
        else:
            return jsonify({"status": "error", "message": "Failed to save file."}), 500

    elif type == 'upload':
        if img_or_label == 'images':
            data = request.json.get('image')
        elif img_or_label == 'labels':
            data = request.json.get('label')
        else:
            return jsonify({"status": "error", "message": "Invalid img_or_label type."}), 400
        if not data:
            return jsonify({"status": "error", "message": "No file provided."}), 400
        if (not is_base64_png(data)) and (not is_base64_jpg(data)):
            return jsonify({"status": "error", "message": "File is not a valid base64 PNG or JPG."}), 400
        if (save(path, data)):
            return jsonify({"status": "success", "message": f"File uploaded to {path}"}), 200
        else:
            return jsonify({"status": "error", "message": "Failed to upload file."}), 500
    else:
        return jsonify({"status": "error", "message": "Invalid request type."}), 400


def is_base64_jpg(data: str) -> bool:
    # Check for data URL prefix
    prefix = 'data:image/jpeg;base64,'
    if isinstance(data, bytes):
        try:
            data = data.decode('utf-8')
        except Exception:
            return False
    if data.startswith(prefix):
        data = data[len(prefix):]
    elif ',' in data:
        data = data.split(',', 1)[1]
    try:
        decoded = base64.b64decode(data)
        # JPEG files start with 0xFFD8
        return decoded.startswith(b'\xff\xd8')
    except Exception:
        return False

def is_base64_png(data: str) -> bool:
    # Check for data URL prefix
    prefix = 'data:image/png;base64,'
    if isinstance(data, bytes):
        try:
            data = data.decode('utf-8')
        except Exception:
            return False
    if data.startswith(prefix):
        data = data[len(prefix):]
    elif ',' in data:
        data = data.split(',', 1)[1]
    try:
        decoded = base64.b64decode(data)
        # PNG files start with these 8 bytes
        return decoded.startswith(b'\x89PNG\r\n\x1a\n')
    except Exception as e:
        print(f"Error decoding PNG: {e}")
        return False

def save(path: str, data: str) -> bool:
    try:
        if isinstance(data, str):
            data = data.split(',')[-1]  # Remove the base64 prefix if present
            decoded_data = base64.b64decode(data)
            root, ext = splitext(path)
            if ext == "":
                path = f"{path}.png"
            with open(path, 'wb') as f:
                f.write(decoded_data)
            return True
    except Exception as e:
        raise Exception(f"Failed to save file: {e}")


@app.route('/predict', methods=['POST', 'GET'])
def predict():
    """Endpoint for crack prediction using the model.

    This endpoint receives a base64 encoded image either via POST (JSON body) or GET (query parameter),
    runs it through the predictor model, and returns a base64 encoded mask of the prediction.

    Returns:
        JSON response with the predicted mask encoded in base64
    """
    try:
        # Get image data from request
        if request.method == 'POST':
            if request.is_json:
                # Get from JSON body
                image_data = request.json.get('image')
            else:
                # Get from form data if not JSON
                image_data = request.form.get('image')
        else:  # GET
            # Get from query parameter
            image_data = request.args.get('image')

        if not image_data:
            return jsonify({
                "status": "error",
                "message": "No image data provided. Use POST with JSON body {'image': 'base64_data'} or GET with '?image=base64_data'"
            }), 400

        # Process the base64 image data
        try:
            # Remove data URL prefix if present (already handled by FileSystem.js, but just in case)
            if image_data.startswith('data:image'):
                image_data = image_data.split(',', 1)[1]

            # Convert base64 to bytes
            image_bytes = base64.b64decode(image_data)

            # Convert to numpy array for OpenCV
            import numpy as np
            nparr = np.frombuffer(image_bytes, np.uint8)

            # Decode image
            import cv2
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if image is None:
                return jsonify({
                    "status": "error",
                    "message": "Failed to decode image. Make sure it's a valid image."
                }), 400

            # Run the prediction
            try:
                prediction_result = predictor(image)
            except Exception as e:
                return jsonify({
                    "status": "error",
                    "message": f"Error during prediction: {str(e)}"
                }), 500

            # Process the prediction output to get a binary mask
            # The prediction output format may vary depending on your model
            # Adjust this part based on your specific model output format
            if prediction_result.ndim > 2:
                prediction_result = prediction_result.squeeze()

            # Convert to binary mask (assuming prediction is probability map)
            threshold = 0.5
            binary_mask = (prediction_result > threshold).astype(np.uint8) * 255

            # Encode the binary mask to PNG
            success, encoded_img = cv2.imencode('.png', binary_mask)
            if not success:
                return jsonify({
                    "status": "error",
                    "message": "Failed to encode prediction result"
                }), 500

            # Convert to base64 string
            mask_base64 = base64.b64encode(encoded_img).decode('utf-8')

            # Return the prediction result
            return jsonify({
                "status": "success",
                "message": "Prediction completed successfully",
                "mask_base64": f"data:image/png;base64,{mask_base64}"
            })

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({
                "status": "error",
                "message": f"Error processing image: {str(e)}"
            }), 500

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": f"Server error: {str(e)}"
        }), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
