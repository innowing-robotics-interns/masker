import { Slider as ShadcnSlider} from "@/components/ui/slider"

export default function SliderDemo({
    label,
    min,  
    max,
    step = 1,
    value,
    showValue = true,
    onChange,
}: {
    label: string;
    min: number;
    max: number;
    step?: number;
    value: number;
    showValue?: boolean;
    onChange: (value: number) => void;
}) { 
    return (
        <div className="flex items-center gap-2">
            <span className="text-sm font-sans w-24">{label}</span>
           <ShadcnSlider
                defaultValue={[value]}
                min={min}
                max={max}
                step={step}
                value={[value]}
                onValueChange={(value) => onChange(value[0])}
                className="w-full"
            />
            {showValue && <span className="text-sm">{value}</span>}
        </div>
    );
}
