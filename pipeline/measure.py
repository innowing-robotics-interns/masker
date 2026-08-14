"""Crack-width measurement pipeline (web-integration module).

This is the productionized form of the standalone ScanRGBD measurement script:
every algorithm function and tuning knob is kept verbatim, but the hardcoded
file paths and the matplotlib debug visuals (stage images, plane-check panels,
width profile, CSV, ``main``) are dropped. The web endpoint only needs the raw
annotated overlay, so ``save_overlay_raw`` is refactored into
``render_overlay_raw`` which returns the BGR ndarray instead of writing to disk.

Pipeline (unchanged): signed distance field -> skeletonize -> prune -> sample
points along the crack -> sub-pixel edges via SDF zero-crossing -> depth sampled
around each point -> RANSAC plane fit -> back-project both edges onto the plane
-> Euclidean 3D distance = width in mm.

Entry point for measure_router.py:
    run_measurement(rgb_path, mask_path, depth_path, confidence_path=None) -> dict
        {"samples": [{"row","col","width_mm","good","rms_mm","inlier_pct"}, ...],
         "overlay": <np.ndarray BGR>,
         "max_width_mm": float | None}
"""

import json

import cv2
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.ndimage import distance_transform_edt, map_coordinates
from skimage.morphology import skeletonize


# --- segmentation ---
MIN_BLOB_PX   = 60            # drop tiny specks from the mask

# --- confidence filtering (iPad LiDAR needs this, D435 never did) ---
MIN_CONFIDENCE = 2            # ARConfidenceLevel: 0=low, 1=medium, 2=high
                               # only applied if a confidence map is provided

# --- pipeline knobs ---
N_SAMPLES   = 20              # measurement points along the crack
PRUNE_LEN   = 25              # remove skeleton branches shorter than this (px)
RANSAC_MM   = 1.0             # distance from the plane in mm to be an inlier
RMS_OK_MM   = 3.0             # sample flagged CHECK if rms above this
INLIER_OK   = 80.0            # sample flagged CHECK if inlier % below this

# --- plane-fit sampling window (RADIUS) ------------------------------------
RADIUS_MODE    = "adaptive"   # "adaptive" (recommended) or "fixed"
BASE_RADIUS_PX = 20           # only used when RADIUS_MODE == "fixed"
BASE_RADIUS_MM = 8.0          # floor: always sample at least this much real wall
SAFETY_FACTOR  = 1.75         # radius must clear (local half-width in mm) * this
MIN_RADIUS_PX  = 8
MAX_RADIUS_PX  = 150
MIN_WALL_POINTS = 20

# --- sub-pixel edge march distance ------------------------------------
MAX_EDGE_MARCH_PX = 300
DEBUG_FAILURES = True   # print why each sample was dropped, not just a count


#  PART 1 — LOAD (RGB jpg + ScanRGBD's frame_N.json)
def make_K(fx, fy, cx, cy):
    return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float64)


def load_rgb(path):
    rgb = cv2.imread(path)                      # BGR
    if rgb is None:
        raise FileNotFoundError(path)
    return rgb


def load_frame_json(path):
    """
    ScanRGBD's frame_N.json: raw depth (metres, native LiDAR resolution,
    e.g. 256x192) + that frame's camera intrinsics. ARKit depth is metres.
    """
    with open(path) as f:
        data = json.load(f)

    dm = data["depth_map"]
    w, h = dm["width"], dm["height"]
    depth_native = np.array(dm["values"], dtype=np.float32).reshape(h, w)
    depth_native[~np.isfinite(depth_native)] = 0.0

    # ARKit's camera.intrinsics, Swift Codable-encoded column-major. Flatten to
    # 9 numbers regardless of nesting depth so a wrapping-level mismatch can't
    # break this again.
    def _flatten(x):
        if isinstance(x, (list, tuple)):
            out = []
            for e in x:
                out.extend(_flatten(e))
            return out
        return [float(x)]

    flat = _flatten(data["intrinsic"])
    if len(flat) != 9:
        raise ValueError(f"Expected 9 intrinsic values (3x3 matrix), got "
                         f"{len(flat)}: {flat}")
    # column-major: [fx,0,0, 0,fy,0, cx,cy,1]
    fx, fy = flat[0], flat[4]
    cx, cy = flat[6], flat[7]
    K = make_K(fx, fy, cx, cy)
    return depth_native, K


def resize_depth_to_rgb(depth_native, target_shape):
    """
    Upsample native LiDAR depth (e.g. 256x192) to RGB pixel space so it can be
    indexed by the same (row, col) as the sub-pixel edges. Nearest-neighbor
    keeps real depth values but does NOT add real resolution.
    """
    if depth_native.shape != target_shape:
        return cv2.resize(depth_native, (target_shape[1], target_shape[0]),
                          interpolation=cv2.INTER_NEAREST)
    return depth_native


def load_confidence(path, target_shape):
    """ARConfidenceLevel per pixel (0/1/2), resized to RGB space (nearest --
    confidence is categorical, never interpolate it)."""
    if path is None:
        return None
    c = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if c is None:
        print(f"  WARNING: could not read confidence map at {path}; "
              f"continuing without confidence filtering.")
        return None
    if c.shape != target_shape:
        c = cv2.resize(c, (target_shape[1], target_shape[0]),
                       interpolation=cv2.INTER_NEAREST)
    return c


def check_orientation(rgb_shape, depth_native_shape):
    """
    Sanity check for a known ScanRGBD export pitfall: RGB can be saved rotated
    90 degrees relative to the raw depth array and intrinsics.
    """
    rh, rw = rgb_shape
    dh, dw = depth_native_shape
    rgb_landscape = rw > rh
    depth_landscape = dw > dh
    if rgb_landscape != depth_landscape:
        print("  WARNING: RGB and native depth disagree on orientation "
              "(one looks portrait, the other landscape).")
        print("  This usually means the RGB export is rotated 90 degrees "
              "relative to the raw depth + intrinsics -- fix in Swift "
              "(Helper.swift's convertToUIImage) before trusting results.")
    else:
        print("  RGB/depth orientation looks consistent.")


#  PART 2 — CRACK MASK  (loaded from the saved label PNG)
def load_gt_mask(path, target_shape):
    g = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if g is None:
        raise FileNotFoundError(path)
    if g.shape[:2] != target_shape:
        g = cv2.resize(g, (target_shape[1], target_shape[0]),
                       interpolation=cv2.INTER_NEAREST)
    return g > 127


def clean_mask(mask, min_blob=MIN_BLOB_PX):
    """Drop tiny specks so the skeleton doesn't chase noise."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(
        mask.astype(np.uint8), connectivity=8)
    out = np.zeros_like(mask)
    kept = 0
    for i in range(1, n):                            # 0 = background
        if stats[i, cv2.CC_STAT_AREA] >= min_blob:
            out[labels == i] = True
            kept += 1
    removed = (n - 1) - kept
    if removed > 0:
        print(f"  removed {removed} small blob(s) (< {min_blob} px), kept {kept}")
    return out


#  PART 3 — SDF
def signed_distance_field(mask):
    """0 on the crack edge, NEGATIVE inside the crack, POSITIVE outside."""
    inside = distance_transform_edt(mask)
    outside = distance_transform_edt(~mask)
    return outside - inside


#  PART 4/5 — SKELETON + PRUNE
def make_skeleton(mask):
    return skeletonize(mask)


def _neighbours(r, c, pts):
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if (dr or dc) and (r + dr, c + dc) in pts:
                yield (r + dr, c + dc)


def prune_skeleton(skeleton, min_len=PRUNE_LEN):
    """Remove short dead-end branches (spurs)."""
    skel = skeleton.copy()
    for _ in range(min_len):
        pts = set(zip(*np.where(skel)))
        if not pts:
            break
        endpoints = [p for p in pts if sum(1 for _ in _neighbours(*p, pts)) == 1]
        remove = set()
        for ep in endpoints:
            branch, cur, prev = [ep], ep, None
            while len(branch) < min_len:
                nxt = [p for p in _neighbours(*cur, pts) if p != prev]
                if len(nxt) != 1:
                    if len(nxt) > 1:
                        remove.update(branch)
                    break
                prev, cur = cur, nxt[0]
                branch.append(cur)
        if not remove:
            break
        for p in remove:
            skel[p] = False
    return skel


def order_skeleton(skeleton):
    """Walk the skeleton end to end -> ordered list of (row, col)."""
    pts = set(zip(*np.where(skeleton)))
    if not pts:
        return []
    endpoints = [p for p in pts if sum(1 for _ in _neighbours(*p, pts)) == 1]
    start = endpoints[0] if endpoints else next(iter(pts))
    path, visited, cur = [start], {start}, start
    while True:
        nxt = [p for p in _neighbours(*cur, pts) if p not in visited]
        if not nxt:
            break
        cur = nxt[0]
        visited.add(cur)
        path.append(cur)
    return path


def sample_indices(ordered, n_samples=N_SAMPLES):
    n = len(ordered)
    if n == 0:
        return []
    idx = np.linspace(0, n - 1, min(n_samples, n)).round().astype(int)
    return sorted(set(int(i) for i in idx))


#  PART 6 — SUB-PIXEL EDGES
def _sdf_at(sdf, r, c):
    return float(map_coordinates(sdf, [[r], [c]], order=1, mode="nearest")[0])


def _tangent(ordered, i, win=4):
    a, b = max(0, i - win), min(len(ordered) - 1, i + win)
    t = np.array(ordered[b], float) - np.array(ordered[a], float)
    n = np.linalg.norm(t)
    return t / n if n > 1e-9 else np.array([1.0, 0.0])


def _march_to_edge(sdf, centre, direction, step=0.5, max_dist=MAX_EDGE_MARCH_PX):
    """Walk outward until the SDF crosses 0 -> sub-pixel edge (row, col)."""
    prev_val, prev_pos = _sdf_at(sdf, *centre), np.array(centre, float)
    k = step
    while k <= max_dist:
        pos = np.array(centre, float) + k * direction
        if not (0 <= pos[0] < sdf.shape[0] and 0 <= pos[1] < sdf.shape[1]):
            return None
        val = _sdf_at(sdf, *pos)
        if prev_val < 0 <= val:
            frac = -prev_val / (val - prev_val) if val != prev_val else 0.0
            return prev_pos + frac * (pos - prev_pos)
        prev_val, prev_pos = val, pos
        k += step
    return None


def find_edges(sdf, ordered, i):
    """(centre, edge_a, edge_b, width_px) perpendicular to the crack."""
    centre = np.array(ordered[i], float)
    t = _tangent(ordered, i)
    normal = np.array([-t[1], t[0]])
    ea = _march_to_edge(sdf, centre, normal)
    eb = _march_to_edge(sdf, centre, -normal)
    if ea is None or eb is None:
        return centre, ea, eb, None
    return centre, ea, eb, float(np.linalg.norm(ea - eb))


#  PART 7 — DEPTH -> 3D, PLANE FIT, BACK-PROJECT
def pixel_to_3d(u, v, Z, K):
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    return np.array([(u - cx) * Z / fx, (v - cy) * Z / fy, Z])


def wall_points_near(centre, depth_m, mask, K, radius, confidence=None,
                     min_confidence=MIN_CONFIDENCE):
    """3D points from the WALL around a sample (crack + invalid depth +
    low-confidence points all skipped)."""
    H, W = depth_m.shape
    r0, c0 = int(round(centre[0])), int(round(centre[1]))
    pts = []
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            if dr * dr + dc * dc > radius * radius:
                continue
            r, c = r0 + dr, c0 + dc
            if not (0 <= r < H and 0 <= c < W):
                continue
            if mask[r, c]:
                continue
            Z = depth_m[r, c]
            if not np.isfinite(Z) or Z <= 0:
                continue
            if confidence is not None and confidence[r, c] < min_confidence:
                continue
            pts.append(pixel_to_3d(c, r, Z, K))
    return np.array(pts)


def estimate_local_depth(depth_m, centre, mask, probe_radius=15, max_probe_radius=150):
    """
    Rough Z estimate at a sample point -- used only to size the sampling window
    before the real RANSAC plane fit runs. Expands if nothing valid is found.
    """
    H, W = depth_m.shape
    r0, c0 = int(round(centre[0])), int(round(centre[1]))
    radius = probe_radius
    vals = []
    while radius <= max_probe_radius:
        vals = []
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                r, c = r0 + dr, c0 + dc
                if not (0 <= r < H and 0 <= c < W) or mask[r, c]:
                    continue
                Z = depth_m[r, c]
                if np.isfinite(Z) and Z > 0:
                    vals.append(Z)
        if len(vals) >= 5:
            return float(np.median(vals))
        radius *= 2
    return float(np.median(vals)) if vals else None


def adaptive_radius_px(width_px, Z_m, K):
    """
    Width-adaptive AND resolution-adaptive plane-fit sampling radius, derived in
    real millimetres so it means the same physical thing regardless of RGB
    resolution, depth resolution, or working distance.
    """
    if RADIUS_MODE == "fixed":
        return BASE_RADIUS_PX
    if Z_m is None or Z_m <= 0:
        return BASE_RADIUS_PX

    fx = K[0, 0]
    mm_per_px = (Z_m * 1000.0) / fx
    width_mm_est = (width_px or 0.0) * mm_per_px

    radius_mm = max(BASE_RADIUS_MM, (width_mm_est / 2.0) * SAFETY_FACTOR)
    radius_px = radius_mm / mm_per_px
    return int(np.clip(round(radius_px), MIN_RADIUS_PX, MAX_RADIUS_PX))


def fit_plane(pts):
    """Best-fit plane n.X + d = 0 (SVD). Returns (n, d, rms_metres)."""
    centroid = pts.mean(0)
    _, s, vt = np.linalg.svd(pts - centroid)
    n = vt[-1] / np.linalg.norm(vt[-1])
    d = -n.dot(centroid)
    return n, d, s[-1] / np.sqrt(len(pts))


def fit_plane_ransac(pts, thresh_m, iters=300):
    """Ignore outlier points, then refit. Returns (n, d, inliers, rms)."""
    if len(pts) < 3:
        return None
    rng = np.random.default_rng(0)
    best_inl, best = None, 0
    for _ in range(iters):
        p = pts[rng.choice(len(pts), 3, replace=False)]
        nrm = np.cross(p[1] - p[0], p[2] - p[0])
        if np.linalg.norm(nrm) < 1e-9:
            continue
        nrm /= np.linalg.norm(nrm)
        inl = np.abs(pts.dot(nrm) - nrm.dot(p[0])) < thresh_m
        if inl.sum() > best:
            best, best_inl = inl.sum(), inl
    if best_inl is None or best < 3:
        return None
    n, d, rms = fit_plane(pts[best_inl])
    if n[2] > 0:
        n, d = -n, -d
    return n, d, best_inl, rms


def edge_to_3d(edge, K, n, d):
    """Ray through the edge pixel, intersected with the plane."""
    r, c = edge
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    ray = np.array([(c - cx) / fx, (r - cy) / fy, 1.0])
    denom = n.dot(ray)
    if abs(denom) < 1e-9:
        return None
    return (-d / denom) * ray


def measure_one(sdf, ordered, i, depth_m, mask, K, confidence=None):
    """Steps 7 -> 11 for one sample."""
    centre, ea, eb, width_px = find_edges(sdf, ordered, i)
    if ea is None or eb is None:
        if DEBUG_FAILURES:
            print(f"    sample {i}: edge march found no SDF zero-crossing within "
                  f"MAX_EDGE_MARCH_PX={MAX_EDGE_MARCH_PX}px -- crack may be wider "
                  f"than the march distance at this resolution/working distance")
        return None

    Z_probe = estimate_local_depth(depth_m, centre, mask)
    radius_px = adaptive_radius_px(width_px, Z_probe, K)

    pts = wall_points_near(centre, depth_m, mask, K, radius=radius_px,
                          confidence=confidence)
    if len(pts) < MIN_WALL_POINTS:
        if DEBUG_FAILURES:
            print(f"    sample {i}: only {len(pts)} wall points found in "
                  f"radius={radius_px}px (need >= {MIN_WALL_POINTS}) -- "
                  f"check confidence filtering / depth validity / radius sizing")
        return None
    fit = fit_plane_ransac(pts, RANSAC_MM / 1000.0)
    if fit is None:
        if DEBUG_FAILURES:
            print(f"    sample {i}: RANSAC plane fit failed (not enough "
                  f"non-degenerate points)")
        return None
    n, d, inliers, rms = fit
    A, B = edge_to_3d(ea, K, n, d), edge_to_3d(eb, K, n, d)
    if A is None or B is None:
        return None
    rms_mm = 1000.0 * rms
    inl_pct = 100.0 * inliers.mean()
    return dict(idx=i, centre=centre, edge_a=ea, edge_b=eb, width_px=width_px,
                width_mm=1000.0 * np.linalg.norm(A - B),
                depth_m=float(pts[:, 2].mean()),
                radius_px=radius_px,
                rms_mm=rms_mm, inlier_pct=inl_pct, n_pts=len(pts),
                good=(rms_mm < RMS_OK_MM and inl_pct > INLIER_OK),
                A=A, B=B, points=pts, normal=n, d=d)


#  PART 8 — OVERLAY (raw, OpenCV, no axes/padding) — returns the BGR ndarray
def render_overlay_raw(rgb, mask, results):
    """Annotated RGB at NATIVE resolution, drawn with OpenCV. Returns a BGR
    ndarray (the web-facing refactor of the standalone save_overlay_raw)."""
    good = [r for r in results if r["good"]]
    use = good if good else results
    if not use:
        return rgb.copy()

    out = rgb.copy()
    tint = out.copy()
    tint[mask] = (0, 0, 255)
    out = cv2.addWeighted(tint, 0.4, out, 0.6, 0)

    widths = np.array([r["width_mm"] for r in use])
    wmin, wmax = float(widths.min()), float(widths.max())
    span = max(wmax - wmin, 1e-6)

    def width_colour(w):
        t = (w - wmin) / span
        rgba = plt.cm.jet(t)
        return (int(rgba[2] * 255), int(rgba[1] * 255), int(rgba[0] * 255))

    for r in use:
        ea, eb = r["edge_a"], r["edge_b"]
        pa = (int(round(ea[1])), int(round(ea[0])))
        pb = (int(round(eb[1])), int(round(eb[0])))
        col = width_colour(r["width_mm"])
        cv2.line(out, pa, pb, col, 2, cv2.LINE_AA)
        cv2.circle(out, pa, 2, (255, 255, 255), -1, cv2.LINE_AA)
        cv2.circle(out, pb, 2, (255, 255, 255), -1, cv2.LINE_AA)

        lbl = f"{r['width_mm']:.2f}"
        lx = int(round(r["centre"][1])) + 6
        ly = int(round(r["centre"][0])) - 6
        cv2.putText(out, lbl, (lx, ly), cv2.FONT_HERSHEY_SIMPLEX,
                    0.35, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(out, lbl, (lx, ly), cv2.FONT_HERSHEY_SIMPLEX,
                    0.35, (255, 255, 255), 1, cv2.LINE_AA)

    if good:
        for r in results:
            if not r["good"]:
                cx_, cy_ = int(round(r["centre"][1])), int(round(r["centre"][0]))
                cv2.drawMarker(out, (cx_, cy_), (160, 160, 160),
                               cv2.MARKER_TILTED_CROSS, 8, 1, cv2.LINE_AA)

    rm = use[int(np.argmax(widths))]
    mx, my = int(round(rm["centre"][1])), int(round(rm["centre"][0]))
    cv2.circle(out, (mx, my), 12, (255, 255, 255), 2, cv2.LINE_AA)
    tag = f"MAX {rm['width_mm']:.2f} mm"
    (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
    tx = int(np.clip(mx + 16, 6, out.shape[1] - tw - 6))
    ty = int(np.clip(my - 16, th + 6, out.shape[0] - 6))
    cv2.rectangle(out, (tx - 4, ty - th - 4), (tx + tw + 4, ty + 4),
                  (0, 0, 0), -1)
    cv2.putText(out, tag, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX,
                0.5, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.line(out, (mx, my), (tx, ty), (255, 255, 255), 1, cv2.LINE_AA)

    flagged = len(results) - len(good)
    lines = [
        f"max    {widths.max():.2f} mm",
        f"mean   {widths.mean():.2f} mm",
        f"median {np.median(widths):.2f} mm",
        f"{len(use)} samples" + (f" ({flagged} excluded)" if good and flagged else ""),
        f"mask: GT | ~{use[0]['depth_m']:.2f} m",
    ]
    bw = 5 + max(cv2.getTextSize(t, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)[0][0]
                 for t in lines) + 10
    bh = 8 + 18 * len(lines)
    bw, bh = min(bw, out.shape[1] - 8), min(bh, out.shape[0] - 8)
    panel = out[4:4 + bh, 4:4 + bw].copy()
    out[4:4 + bh, 4:4 + bw] = cv2.addWeighted(
        np.zeros_like(panel), 0.55, panel, 0.45, 0)
    for i, t in enumerate(lines):
        cv2.putText(out, t, (10, 22 + i * 18), cv2.FONT_HERSHEY_SIMPLEX,
                    0.45, (255, 255, 255), 1, cv2.LINE_AA)

    bar_w, bar_h = 110, 8
    x0 = out.shape[1] - bar_w - 12
    y0 = out.shape[0] - 26
    for i in range(bar_w):
        w = wmin + span * (i / max(bar_w - 1, 1))
        cv2.line(out, (x0 + i, y0), (x0 + i, y0 + bar_h), width_colour(w), 1)
    cv2.rectangle(out, (x0, y0), (x0 + bar_w, y0 + bar_h), (255, 255, 255), 1)
    for txt, xx in [(f"{wmin:.1f}", x0 - 2), (f"{wmax:.1f} mm", x0 + bar_w - 24)]:
        cv2.putText(out, txt, (xx, y0 - 4), cv2.FONT_HERSHEY_SIMPLEX,
                    0.35, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(out, txt, (xx, y0 - 4), cv2.FONT_HERSHEY_SIMPLEX,
                    0.35, (255, 255, 255), 1, cv2.LINE_AA)

    return out


#  ENTRY POINT — used by measure_router.py
def run_measurement(rgb_path, mask_path, depth_path, confidence_path=None):
    """Run the full crack-width pipeline for one saved mask + RGB + depth frame.

    :param rgb_path: RGB image path (jpg/png).
    :param mask_path: binary mask PNG (white crack on black), the saved label.
    :param depth_path: ScanRGBD frame_N.json (depth_map + intrinsic).
    :param confidence_path: optional ARConfidenceLevel map; None to skip.
    :returns: dict with per-sample measurements, an annotated BGR overlay
        ndarray, and the max width_mm. See module docstring for the shape.
    :raises ValueError: if the mask is empty or no sample could be measured.
    """
    rgb = load_rgb(rgb_path)
    H, W = rgb.shape[:2]

    depth_native, K = load_frame_json(depth_path)
    check_orientation((H, W), depth_native.shape)
    depth_m = resize_depth_to_rgb(depth_native, (H, W))
    confidence = load_confidence(confidence_path, (H, W))

    mask = load_gt_mask(mask_path, (H, W))
    mask = clean_mask(mask)
    if not mask.any():
        raise ValueError("Mask is empty after cleaning — nothing to measure.")

    sdf = signed_distance_field(mask)
    skel = prune_skeleton(make_skeleton(mask))
    ordered = order_skeleton(skel)
    sample_idx = sample_indices(ordered)

    results = [r for r in (measure_one(sdf, ordered, i, depth_m, mask, K, confidence)
                           for i in sample_idx) if r is not None]
    if not results:
        raise ValueError("No sample could be measured — check the mask, depth "
                         "validity, and working distance.")

    overlay = render_overlay_raw(rgb, mask, results)

    samples = [{
        "row": float(r["centre"][0]),
        "col": float(r["centre"][1]),
        "width_mm": float(r["width_mm"]),
        "good": bool(r["good"]),
        "rms_mm": float(r["rms_mm"]),
        "inlier_pct": float(r["inlier_pct"]),
    } for r in results]

    widths = [s["width_mm"] for s in samples]
    return {
        "samples": samples,
        "overlay": overlay,
        "max_width_mm": max(widths) if widths else None,
    }
