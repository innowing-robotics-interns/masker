/**
 * Right-side panel showing the crack severity category for a measurement.
 *
 * The category that matches the computed max width_mm is auto-highlighted, and
 * each category carries a static explanation of what it means.
 */

// ---------------------------------------------------------------------------
// Drainage-oriented crack-width severity.
//
// Basis: concrete in continuous contact with moisture / soil / groundwater —
// i.e. drainage structures — has a crack-width DURABILITY limit of ~0.2 mm
// (moderate exposure), tightening to ~0.1 mm for severe exposure, with 0.3 mm
// the general limit above which water ingress and reinforcement corrosion
// accelerate. See theconstructor.org "Severity of Concrete Cracks" and the
// CEDD/Concrete Society exposure-based crack-width limits.
//
// Adjust `maxMm` here if your CEDD drainage spec dictates different cutoffs.
// Categories are matched in order: the first whose `maxMm` is >= the measured
// max width wins (last one is the catch-all, so keep its maxMm = Infinity).
// ---------------------------------------------------------------------------
interface SeverityCategory {
  key: string;
  label: string;
  /** Upper bound in mm (inclusive). Use Infinity for the most-severe bucket. */
  maxMm: number;
  /** Human-readable range shown on the card. */
  range: string;
  /** Static explanation of what this category means. */
  blurb: string;
  /** Tailwind accent classes for the highlighted state. */
  accent: string;
}

const SEVERITY_CATEGORIES: SeverityCategory[] = [
  {
    key: "hairline",
    label: "Hairline/Minor",
    maxMm: 0.2,
    range: "< 0.2 mm",
    blurb:
      "Within the crack-width durability limit for wet/buried drainage concrete. Routine monitoring only.",
    accent: "border-emerald-500 bg-emerald-50 text-emerald-900",
  },
  {
    key: "moderate",
    label: "Moderate",
    maxMm: 1.0,
    range: "0.2 – 1.0 mm",
    blurb:
      "Exceeds the 0.2 mm moisture-exposure durability limit which permits water ingress/exfiltration and reinforcement corrosion. Seal/repair and schedule inspection.",
    accent: "border-amber-500 bg-amber-50 text-amber-900",
  },
  {
    key: "severe",
    label: "Severe",
    maxMm: Infinity,
    range: "≥ 1.0 mm",
    blurb:
      "Well beyond durability limits which significant infiltration/exfiltration and possible structural distress. Priority assessment and remediation.",
    accent: "border-red-500 bg-red-50 text-red-900",
  },
];

/** Return the category whose range contains the given width, or null. */
export const categorizeWidth = (
  maxWidthMm: number | null,
): SeverityCategory | null => {
  if (maxWidthMm == null || !Number.isFinite(maxWidthMm)) return null;
  return (
    SEVERITY_CATEGORIES.find((c) => maxWidthMm <= c.maxMm) ??
    SEVERITY_CATEGORIES[SEVERITY_CATEGORIES.length - 1]
  );
};

export default function MeasurementPanel({
  maxWidthMm,
  numSamples,
  numExcluded,
  onClose,
}: {
  maxWidthMm: number | null;
  numSamples?: number;
  numExcluded?: number;
  onClose?: () => void;
}) {
  const active = categorizeWidth(maxWidthMm);

  return (
    <div className="fixed top-4 right-4 z-50 w-72 rounded-lg bg-white shadow-xl border border-neutral-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
        <h2 className="text-sm font-semibold text-neutral-800">
          Crack Severity
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 text-lg leading-none"
            aria-label="Close measurement panel"
          >
            ×
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-b border-neutral-200">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          Max width
        </div>
        <div className="text-2xl font-bold text-neutral-900">
          {maxWidthMm != null ? `${maxWidthMm.toFixed(2)} mm` : "—"}
        </div>
        {numSamples != null && (
          <div className="text-xs text-neutral-500">
            from {numSamples} good sample{numSamples === 1 ? "" : "s"}
            {numExcluded ? ` (${numExcluded} excluded)` : ""}
          </div>
        )}
      </div>

      <div className="p-3 space-y-2">
        {SEVERITY_CATEGORIES.map((cat) => {
          const isActive = active?.key === cat.key;
          return (
            <div
              key={cat.key}
              className={`rounded-md border p-3 transition-colors ${
                isActive
                  ? cat.accent
                  : "border-neutral-200 bg-neutral-50 text-neutral-500"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{cat.label}</span>
                <span className="text-xs font-medium">{cat.range}</span>
              </div>
              <p className="mt-1 text-xs leading-snug">{cat.blurb}</p>
              {isActive && (
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide">
                  ● Matches this measurement
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
