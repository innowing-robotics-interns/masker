import React, { useEffect, useMemo, useState } from "react";

type SliderSetting = {
  key: string;
  type: "slider";
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  showValue?: boolean;
};

type CheckboxSetting = {
  key: string;
  type: "checkbox";
  label: string;
  checked: boolean;
};

type ColorSetting = {
  key: string;
  type: "color";
  label: string;
  value: string;
};

export type SettingItem = SliderSetting | CheckboxSetting | ColorSetting;

export type SettingsProps = {
  title?: string;
  items: SettingItem[];
  visible: boolean;
  /**
   * Optional absolute anchor coordinates (page space) to position the floating menu near toolbar.
   * If not provided the menu will render in the top-left corner with a small offset.
   */
  anchor?: { x: number; y: number } | undefined;
  /**
   * Called whenever any setting changes: (key, newValue) => void
   */
  onChange?: (key: string, value: number | boolean | string) => void;
  /**
   * Close handler (also called when user presses the X).
   */
  onClose?: () => void;
  /**
   * Optional width of the floating menu (defaults to 320)
   */
  width?: number;
};

function formatSliderValue(v: number) {
  // display as int if whole, else 2 decimals
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/**
 * Reusable floating settings menu.
 *
 * - Renders a list of setting items (sliders, checkboxes, colors).
 * - Positions itself near `anchor` coordinates when provided.
 * - Controlled visibility via `visible`.
 * - Fires `onChange(key, value)` when a setting is adjusted.
 */
export default function Settings({
  title = "Settings",
  items,
  visible,
  anchor,
  onChange,
  onClose,
  width = 320,
}: SettingsProps) {
  // local copy of values so UI updates are instant; propagate changes up via onChange
  const initialState = useMemo(() => {
    const s: Record<string, number | boolean | string> = {};
    for (const it of items) {
      if (it.type === "slider") s[it.key] = it.value;
      else if (it.type === "checkbox") s[it.key] = it.checked;
      else if (it.type === "color") s[it.key] = it.value;
    }
    return s;
  }, [items]);

  const [state, setState] =
    useState<Record<string, number | boolean | string>>(initialState);

  // sync when items prop changes
  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  if (!visible) return null;

  // position the panel near the anchor. We add a small offset so it doesn't sit under the button.
  const left = anchor ? anchor.x + 12 : 12;
  const top = anchor ? Math.max(8, anchor.y - 8) : 12;

  function handleSliderChange(key: string, value: number): void {
    setState((s: Record<string, number | boolean | string>) => {
      return { ...s, [key]: value };
    });
    if (onChange) {
      onChange(key, value);
    }
  }

  function handleCheckboxChange(key: string, value: boolean): void {
    setState((s: Record<string, number | boolean | string>) => {
      return { ...s, [key]: value };
    });
    if (onChange) {
      onChange(key, value);
    }
  }

  function handleColorChange(key: string, value: string): void {
    setState((s: Record<string, number | boolean | string>) => {
      return { ...s, [key]: value };
    });
    if (onChange) {
      onChange(key, value);
    }
  }

  return (
    <div
      className="fixed z-50"
      style={{
        left,
        top,
        width,
      }}
      role="dialog"
      aria-modal="false"
    >
      <div
        className="bg-neutral-900 text-white rounded-md shadow-2xl border border-neutral-800 overflow-hidden"
        style={{ width }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="text-2xl select-none">🔧</div>
            <h3 className="text-lg font-semibold leading-tight">{title}</h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (onClose) {
                  onClose();
                }
              }}
              className="p-1 rounded hover:bg-neutral-800/60"
              aria-label="Close settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-neutral-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {items.map((it) => {
            if (it.type === "slider") {
              const v = Number(state[it.key]);
              return (
                <div key={it.key} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-neutral-200 font-medium">
                      {it.label}
                    </div>
                    <div className="text-sm text-neutral-300 font-mono">
                      {it.showValue ? formatSliderValue(v) : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={it.min}
                      max={it.max}
                      step={it.step ?? 1}
                      value={v}
                      onChange={(e) =>
                        handleSliderChange(it.key, Number(e.target.value))
                      }
                      className="accent-blue-500 w-full"
                    />
                    <div className="min-w-[42px] px-2 py-1 text-center bg-neutral-800 rounded text-sm">
                      {formatSliderValue(v)}
                    </div>
                  </div>
                </div>
              );
            }

            if (it.type === "checkbox") {
              const checked = Boolean(state[it.key]);
              return (
                <div key={it.key} className="flex items-center justify-between">
                  <div className="text-sm text-neutral-200">{it.label}</div>
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        handleCheckboxChange(it.key, e.target.checked)
                      }
                      className="form-checkbox h-5 w-5 rounded text-blue-500 accent-blue-500"
                    />
                  </label>
                </div>
              );
            }

            if (it.type === "color") {
              const v = String(state[it.key] || "#ffffff");
              return (
                <div
                  key={it.key}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="text-sm text-neutral-200">{it.label}</div>
                  <input
                    type="color"
                    value={v}
                    onChange={(e) => handleColorChange(it.key, e.target.value)}
                    className="h-8 w-10 rounded border border-neutral-700 p-0"
                  />
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * MagicBrushSettings
 *
 * A prewired wrapper that supplies the settings required for the "magic brush".
 * Caller should manage `visible`, `anchor`, and `onClose`.
 *
 * onChange receives the full settings object whenever any sub-setting changes.
 */
export function MagicBrushSettings({
  visible,
  anchor,
  onClose,
  onChange,
}: {
  visible: boolean;
  anchor?: { x: number; y: number };
  onClose?: () => void;
  onChange?: (settings: {
    applyMorphology: boolean;
    kernelSize: number;
    iterations: number;
    sensitivity: number;
    applyDBSCAN: boolean;
    eps: number;
    minSamples: number;
  }) => void;
}) {
  // default values chosen to match screenshot & sensible defaults
  const [applyMorphology, setApplyMorphology] = useState(true);
  const [kernelSize, setKernelSize] = useState(3);
  const [iterations, setIterations] = useState(2);
  const [sensitivity, setSensitivity] = useState(2);
  const [applyDBSCAN, setApplyDBSCAN] = useState(true);
  const [eps, setEps] = useState(10);
  const [minSamples, setMinSamples] = useState(5);

  // Fire full settings whenever any piece changes
  useEffect(() => {
    if (onChange) {
      onChange({
        applyMorphology,
        kernelSize,
        iterations,
        sensitivity,
        applyDBSCAN,
        eps,
        minSamples,
      });
    }
  }, [
    applyMorphology,
    kernelSize,
    iterations,
    sensitivity,
    applyDBSCAN,
    eps,
    minSamples,
    onChange,
  ]);

  const items: SettingItem[] = [
    {
      key: "applyMorphology",
      type: "checkbox",
      label: "Apply Morphology",
      checked: applyMorphology,
    },
    {
      key: "kernelSize",
      type: "slider",
      label: "Kernel Size",
      min: 1,
      max: 21,
      step: 1,
      value: kernelSize,
      showValue: true,
    },
    {
      key: "iterations",
      type: "slider",
      label: "Iterations",
      min: 1,
      max: 10,
      step: 1,
      value: iterations,
      showValue: true,
    },
    {
      key: "sensitivity",
      type: "slider",
      label: "Sensitivity",
      min: 0,
      max: 10,
      step: 1,
      value: sensitivity,
      showValue: true,
    },
    {
      key: "applyDBSCAN",
      type: "checkbox",
      label: "Apply DBSCAN",
      checked: applyDBSCAN,
    },
    {
      key: "eps",
      type: "slider",
      label: "EPS (Distance)",
      min: 1,
      max: 100,
      step: 1,
      value: eps,
      showValue: true,
    },
    {
      key: "minSamples",
      type: "slider",
      label: "Min Samples",
      min: 1,
      max: 50,
      step: 1,
      value: minSamples,
      showValue: true,
    },
  ];

  function handleItemChange(key: string, value: number | boolean | string) {
    switch (key) {
      case "applyMorphology":
        setApplyMorphology(Boolean(value));
        break;
      case "kernelSize":
        setKernelSize(Number(value));
        break;
      case "iterations":
        setIterations(Number(value));
        break;
      case "sensitivity":
        setSensitivity(Number(value));
        break;
      case "applyDBSCAN":
        setApplyDBSCAN(Boolean(value));
        break;
      case "eps":
        setEps(Number(value));
        break;
      case "minSamples":
        setMinSamples(Number(value));
        break;
      default:
        break;
    }
  }

  if (!visible) return null;

  // Primary panel (Morphology + basic controls)
  return (
    <div>
      <Settings
        title="AI Brush Controls"
        items={[
          {
            key: "__morph_header",
            type: "slider",
            label: "Morphology",
            min: 0,
            max: 1,
            step: 1,
            value: 0,
            showValue: false,
          } as SliderSetting,
          ...items.slice(0, 3),
        ]}
        visible={visible}
        anchor={anchor}
        onClose={onClose}
        onChange={(k, v) => {
          if (k === "__morph_header") return;
          handleItemChange(k, v);
        }}
      />

      {/* Secondary panel positioned adjacent for Sensitivity + DBSCAN */}
      <div
        className="fixed z-50"
        style={{
          left: (anchor ? anchor.x + 12 : 12) + (320 + 12),
          top: anchor ? Math.max(8, anchor.y - 8) : 12,
          width: 320,
        }}
      >
        <div
          className="bg-neutral-900 text-white rounded-md shadow-2xl border border-neutral-800 overflow-hidden"
          style={{ width: 320 }}
        >
          <div className="p-4">
            <div className="text-sm text-neutral-400 mb-2">Sensitivity</div>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-neutral-200">Sensitivity</div>
                <div className="text-sm text-neutral-300 font-mono">
                  {sensitivity}
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={sensitivity}
                onChange={(e) =>
                  handleItemChange("sensitivity", Number(e.target.value))
                }
                className="accent-blue-500 w-full"
              />
            </div>

            <hr className="border-neutral-800 my-3" />

            <div className="text-sm text-neutral-400 mb-2">
              DBSCAN Clustering
            </div>

            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-neutral-200">Apply DBSCAN</div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyDBSCAN}
                  onChange={(e) =>
                    handleItemChange("applyDBSCAN", e.target.checked)
                  }
                  className="form-checkbox h-5 w-5 rounded text-blue-500 accent-blue-500"
                />
              </label>
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-neutral-200">EPS (Distance)</div>
                <div className="text-sm text-neutral-300 font-mono">{eps}</div>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={eps}
                onChange={(e) =>
                  handleItemChange("eps", Number(e.target.value))
                }
                className="accent-blue-500 w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-neutral-200">Min Samples</div>
                <div className="text-sm text-neutral-300 font-mono">
                  {minSamples}
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={minSamples}
                onChange={(e) =>
                  handleItemChange("minSamples", Number(e.target.value))
                }
                className="accent-blue-500 w-full"
              />
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  if (onClose) {
                    onClose();
                  }
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
