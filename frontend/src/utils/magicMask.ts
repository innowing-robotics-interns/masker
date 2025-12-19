export async function requestMagicMask(
  imageDataUrl: string,
  point: { x: number; y: number },
  radius: number = 10,
): Promise<string> {
  // Example: POST FormData with image and metadata
  const form = new FormData();
  // strip the prefix "data:image/png;base64," if needed by backend
  form.append("image", imageDataUrl);
  form.append("x", String(Math.round(point.x)));
  form.append("y", String(Math.round(point.y)));
  form.append("radius", String(radius));

  const res = await fetch("/magic_pen/predict_crops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: form,
  });
  if (!res.ok) {
    throw new Error("Magic mask request failed: " + res.statusText);
  }
  // Backend returns base64 PNG (raw) or JSON with base64 string
  const json = await res.json();
  // assume { mask: "data:image/png;base64,..." }
  return json.mask as string;
}
