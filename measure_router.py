"""Flask Blueprint for crack-width measurement and per-image metadata.

This blueprint exposes two groups of endpoints, registered on the app with no
url_prefix so the paths sit under the existing ``/datasets/...`` convention:

  POST /measure/<dataset>/<filename>
      Runs the crack-width measurement pipeline (pipeline/measure.py) against a
      saved mask + its RGB image + a depth frame, returning per-sample widths
      plus a base64 annotated overlay.

  GET  /datasets/<dataset>/meta/<filename>
  POST /datasets/<dataset>/meta/<filename>
      Read / write per-image metadata JSON stored at
      datasets/<dataset>/meta/<filename>.json, mirroring the folder-per-type
      layout used by images/ and labels/.

The heavy lifting (signed distance field -> skeletonize -> prune -> sample ->
sub-pixel edges -> depth sampling -> RANSAC plane fit -> back-project ->
width_mm, plus the annotated overlay) lives in ``pipeline/measure.py``. This
router only resolves file paths, delegates, and shapes the HTTP response, so the
depth-JSON decoding (sceneDepth/smoothedSceneDepth reshaping, orientation,
intrinsics, confidence) stays owned by the pipeline and is never re-implemented
here.
"""

from os import listdir, makedirs
from os.path import join, isfile, dirname
import base64
import json
import re
import time

import cv2
import numpy as np
from flask import Blueprint, request, jsonify

from dataset_paths import (
    resolve_dir,
    resolve_file,
    canonical_dir,
)

measure_router = Blueprint('measure_router', __name__)

# Image extensions we will look for when resolving an RGB file from a mask name.
_IMAGE_EXTS = ('.jpg', '.jpeg', '.png')

# Where measurement outputs are written on disk (visible in the project tree).
RESULTS_ROOT = 'results'


# ---------------------------------------------------------------------------
# Path resolution helpers
# ---------------------------------------------------------------------------
def _stem(filename: str) -> str:
    """Return the label/image stem the same way the frontend does.

    The frontend derives a label name from an image with ``split('.')[0]``
    (see frontend/src/utils/masks.ts::getLabelNameFromImageUrl), so an image
    ``rgb_1.jpg.jpeg`` and a mask ``rgb_1.png`` share the stem ``rgb_1``.
    """
    return filename.split('.')[0]


def _resolve_rgb_path(dataset: str, filename: str):
    """Find the RGB image whose stem matches ``filename``'s stem, or None.

    Looks in the dataset's images folder (``images/`` or, for a ScanRGBD
    capture, ``RGB/``).
    """
    images_dir = resolve_dir(dataset, 'images')
    if images_dir is None:
        return None

    stem = _stem(filename)
    for f in listdir(images_dir):
        if not f.lower().endswith(_IMAGE_EXTS):
            continue
        if _stem(f) == stem:
            return join(images_dir, f)
    return None


def _trailing_int(name: str):
    """Return the trailing integer in a stem (rgb_1 -> 1, frame_03 -> 3), or None."""
    m = re.search(r'(\d+)$', _stem(name))
    return int(m.group(1)) if m else None


def _resolve_depth_path(dataset: str, filename: str):
    """Find the ScanRGBD depth frame JSON for ``filename``, or None.

    Looks in the dataset's depth folder (``depth/`` or, for a ScanRGBD capture,
    ``Frame/``). ScanRGBD names RGB ``rgb_N.jpg`` but the frame ``frame_N.json``
    (different stems, same index N), so resolution tries, in order:
      1. <stem>.json                (e.g. rgb_1.json — if renamed to match RGB)
      2. frame_<N>.json             (e.g. frame_1.json — raw ScanRGBD naming)
      3. any *.json whose trailing index equals N
    """
    depth_dir = resolve_dir(dataset, 'depth')
    if depth_dir is None:
        return None

    stem = _stem(filename)
    idx = _trailing_int(filename)

    # 1. Exact stem match.
    direct = join(depth_dir, f'{stem}.json')
    if isfile(direct):
        return direct

    # 2. ScanRGBD frame_<N>.json.
    if idx is not None:
        frame = join(depth_dir, f'frame_{idx}.json')
        if isfile(frame):
            return frame

    # 3. Any JSON whose stem or trailing index matches.
    for f in listdir(depth_dir):
        if not f.lower().endswith('.json'):
            continue
        if _stem(f) == stem or (idx is not None and _trailing_int(f) == idx):
            return join(depth_dir, f)
    return None


def _meta_path(dataset: str, filename: str) -> str:
    """Path to the metadata JSON for a given image/mask filename.

    Stored at datasets/<dataset>/meta/<filename>.json. ``.json`` is appended
    only when not already present so both ``rgb_1.png`` and ``rgb_1.png.json``
    (or ``rgb_1.json``) resolve predictably.
    """
    name = filename if filename.lower().endswith('.json') else f'{filename}.json'
    return join(canonical_dir(dataset, 'meta'), name)


def _encode_overlay_to_base64(overlay) -> str:
    """Encode an overlay (BGR ndarray or raw PNG bytes) to a data URL string."""
    if isinstance(overlay, (bytes, bytearray)):
        png_bytes = bytes(overlay)
    else:
        arr = overlay
        if arr.dtype != np.uint8:
            arr = arr.astype(np.uint8)
        success, encoded = cv2.imencode('.png', arr)
        if not success:
            raise ValueError('Failed to encode overlay to PNG')
        png_bytes = encoded.tobytes()

    b64 = base64.b64encode(png_bytes).decode('utf-8')
    return f'data:image/png;base64,{b64}'


def _save_results(dataset: str, filename: str, samples, overlay,
                  max_width_mm):
    """Persist the annotated overlay + measurements JSON to results/<dataset>/.

    Returns the relative overlay path (for the API response). Failures here are
    non-fatal: the measurement still succeeds even if saving to disk fails.
    """
    stem = _stem(filename)
    out_dir = join(RESULTS_ROOT, dataset)
    makedirs(out_dir, exist_ok=True)

    overlay_path = join(out_dir, f'{stem}_overlay.png')
    if isinstance(overlay, (bytes, bytearray)):
        with open(overlay_path, 'wb') as f:
            f.write(bytes(overlay))
    else:
        arr = overlay if overlay.dtype == np.uint8 else overlay.astype(np.uint8)
        cv2.imwrite(overlay_path, arr)

    meta = {
        'dataset': dataset,
        'image': filename,
        'measured_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'max_width_mm': max_width_mm,
        'num_samples': len(samples),
        'samples': samples,
    }
    with open(join(out_dir, f'{stem}_measurements.json'), 'w',
              encoding='utf-8') as f:
        json.dump(meta, f, indent=2)

    return overlay_path


# ---------------------------------------------------------------------------
# Measurement endpoint
# ---------------------------------------------------------------------------
@measure_router.route('/measure/<dataset>/<filename>', methods=['POST'])
def measure(dataset: str, filename: str):
    """Run the crack-width pipeline for a saved mask and return per-sample widths.

    Returns JSON:
    {
      "status": "success",
      "samples": [
        {"row": int, "col": int, "width_mm": float,
         "good": bool, "rms_mm": float, "inlier_pct": float},
        ...
      ],
      "max_width_mm": float,
      "overlay_base64": "data:image/png;base64,..."
    }

    Distinct, explicit failure states are returned for missing mask / RGB /
    depth so the frontend can show a clear message (e.g. "no depth available")
    rather than a generic 500.
    """
    # 1. Locate the saved mask.
    mask_path = resolve_file(dataset, 'labels', filename)
    if mask_path is None:
        expected = join(canonical_dir(dataset, 'labels'), filename)
        return jsonify({
            'status': 'error',
            'reason': 'no_mask',
            'message': f'No saved mask at {expected}. Save the mask first.',
        }), 404

    # 2. Locate the RGB image.
    rgb_path = _resolve_rgb_path(dataset, filename)
    if rgb_path is None:
        return jsonify({
            'status': 'error',
            'reason': 'no_rgb',
            'message': f'No RGB image found for "{filename}" in '
                       f'datasets/{dataset}/images/.',
        }), 404

    # 3. Locate the depth frame. Absence is an expected, first-class state.
    depth_path = _resolve_depth_path(dataset, filename)
    if depth_path is None:
        return jsonify({
            'status': 'no_depth',
            'reason': 'no_depth',
            'message': 'No depth frame available for this image. Expected a '
                       f'ScanRGBD-style JSON at datasets/{dataset}/depth/'
                       f'{_stem(filename)}.json.',
        }), 200

    # 4. Delegate to the pipeline. Imported lazily so the rest of the blueprint
    #    (metadata endpoints) works even before pipeline/measure.py is present.
    try:
        from pipeline.measure import run_measurement
    except Exception as e:  # ImportError or downstream import failure
        return jsonify({
            'status': 'error',
            'reason': 'pipeline_unavailable',
            'message': f'Measurement pipeline not available: {e}',
        }), 501

    try:
        result = run_measurement(
            rgb_path=rgb_path,
            mask_path=mask_path,
            depth_path=depth_path,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'reason': 'pipeline_error',
            'message': f'Measurement failed: {e}',
        }), 500

    # 5. Shape the response. The pipeline returns raw samples + an overlay
    #    (ndarray or PNG bytes); we normalize to the JSON contract above.
    try:
        samples = result['samples']
        overlay_base64 = _encode_overlay_to_base64(result['overlay'])
        # Base the headline width on GOOD samples only, to match the overlay
        # (render_overlay_raw uses good samples and labels "N excluded").
        # Flagged samples are unreliable plane fits and can report huge
        # outliers; including them made the panel's max disagree with the
        # overlay. Fall back to all samples if none passed the quality gate.
        good_samples = [s for s in samples if s.get('good')]
        used = good_samples if good_samples else samples
        widths = [s['width_mm'] for s in used
                  if s.get('width_mm') is not None]
        max_width_mm = max(widths) if widths else None
    except Exception as e:
        return jsonify({
            'status': 'error',
            'reason': 'bad_pipeline_output',
            'message': f'Pipeline returned an unexpected shape: {e}',
        }), 500

    # Persist overlay + measurements to results/<dataset>/ (non-fatal on error).
    saved_overlay_path = None
    try:
        saved_overlay_path = _save_results(
            dataset, filename, samples, result['overlay'], max_width_mm)
    except Exception as e:
        print(f'  WARNING: could not save results to disk: {e}')

    return jsonify({
        'status': 'success',
        'samples': samples,
        'max_width_mm': max_width_mm,
        # num_samples = good samples used for the headline (matches the overlay);
        # num_excluded = flagged samples; num_total = everything measured.
        'num_samples': len(used),
        'num_excluded': len(samples) - len(used),
        'num_total_samples': len(samples),
        'overlay_base64': overlay_base64,
        'overlay_saved_path': saved_overlay_path,
    }), 200


# ---------------------------------------------------------------------------
# Metadata endpoints
# ---------------------------------------------------------------------------
# Fields the metadata document is expected to carry. Unknown fields are kept
# on write (forward-compatible) but these are the documented ones.
_META_FIELDS = (
    'severity',
    'crack_direction',
    'annotator',
    'timestamp',
    'capture_distance_m',
)


@measure_router.route('/datasets/<dataset>/meta/<filename>', methods=['GET'])
def get_meta(dataset: str, filename: str):
    """Read the metadata JSON for an image/mask filename."""
    path = _meta_path(dataset, filename)
    if not isfile(path):
        return jsonify({
            'status': 'error',
            'reason': 'not_found',
            'message': f'No metadata for {filename} in dataset {dataset}.',
        }), 404

    try:
        with open(path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Failed to read metadata: {e}',
        }), 500

    return jsonify({'status': 'success', 'meta': meta}), 200


@measure_router.route('/datasets/<dataset>/meta/<filename>', methods=['POST'])
def save_meta(dataset: str, filename: str):
    """Write the metadata JSON for an image/mask filename.

    Accepts a JSON body with any of: severity, crack_direction, annotator,
    timestamp, capture_distance_m. A server-side timestamp is filled in when the
    client omits one.
    """
    if not request.is_json:
        return jsonify({
            'status': 'error',
            'message': 'Request must be JSON.',
        }), 400

    incoming = request.get_json(silent=True)
    if not isinstance(incoming, dict):
        return jsonify({
            'status': 'error',
            'message': 'Request body must be a JSON object.',
        }), 400

    # Start from the documented fields; keep any extra keys the client sent.
    meta = dict(incoming)
    if not meta.get('timestamp'):
        meta['timestamp'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

    path = _meta_path(dataset, filename)
    try:
        makedirs(dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2)
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Failed to write metadata: {e}',
        }), 500

    return jsonify({
        'status': 'success',
        'message': f'Metadata saved to {path}',
        'meta': meta,
    }), 200
