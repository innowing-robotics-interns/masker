"""Folder-alias resolution so datasets can use either the app's own layout
(images/ labels/ depth/) or a ScanRGBD capture layout (RGB/ Frame/ Confidence/)
interchangeably.

A "dataset" is a single directory under ``datasets/``. Each logical folder
(images, labels, depth, confidence, meta) may live under one of several real
folder names; these helpers pick the right one so the rest of the app doesn't
have to care whether it's looking at a hand-made dataset or a raw ScanRGBD
capture. Nothing is copied or renamed — the ScanRGBD export is used in place.
"""

from os import listdir, makedirs
from os.path import join, isdir, isfile

# Root of the datasets tree. app.py's file-serving routes are hardcoded to
# ./datasets, so we match that here (rather than args.root_data_path).
ROOT_DATA_PATH = 'datasets'

# Logical folder -> ordered list of real on-disk names to try. First match wins;
# the first entry is also the canonical name used when creating a folder to
# write into (labels/meta always get the app's own name, never a ScanRGBD one).
FOLDER_ALIASES = {
    'images': ['images', 'RGB'],
    'labels': ['labels'],
    'depth': ['depth', 'Frame'],
    'confidence': ['confidence', 'Confidence'],
    'meta': ['meta'],
}


def _aliases(logical: str):
    return FOLDER_ALIASES.get(logical, [logical])


def resolve_dir(dataset: str, logical: str, root: str = ROOT_DATA_PATH):
    """Return the first existing alias directory for a logical folder, or None."""
    for name in _aliases(logical):
        p = join(root, dataset, name)
        if isdir(p):
            return p
    return None


def canonical_dir(dataset: str, logical: str, root: str = ROOT_DATA_PATH):
    """Return the canonical (first-alias) directory path for writing."""
    return join(root, dataset, _aliases(logical)[0])


def ensure_dir(dataset: str, logical: str, root: str = ROOT_DATA_PATH):
    """Return an existing alias dir, or create+return the canonical one."""
    existing = resolve_dir(dataset, logical, root)
    if existing is not None:
        return existing
    path = canonical_dir(dataset, logical, root)
    makedirs(path, exist_ok=True)
    return path


def resolve_file(dataset: str, logical: str, filename: str,
                 root: str = ROOT_DATA_PATH):
    """Find a file by exact name within any alias dir for a logical folder."""
    for name in _aliases(logical):
        p = join(root, dataset, name, filename)
        if isfile(p):
            return p
    return None


def list_datasets(root: str = ROOT_DATA_PATH):
    """List dataset directory names under the datasets root (dirs only)."""
    if not isdir(root):
        return []
    return sorted(d for d in listdir(root) if isdir(join(root, d)))
