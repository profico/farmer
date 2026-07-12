import { Plus } from "lucide-react";
import { CATEGORY_COLORS } from "#/lib/category-colors.ts";
import { cn } from "#/lib/utils.ts";

const NEUTRAL_SWATCH = "#4a5568";

// The preset row: the 5 palette colors plus a neutral gray, in picker order.
const PRESET_SWATCHES = [...CATEGORY_COLORS.map((c) => c.dot), NEUTRAL_SWATCH];

const isPreset = (value: string) =>
	PRESET_SWATCHES.some((s) => s.toLowerCase() === value.toLowerCase());

/**
 * Color field with a preset row and a custom-color section. A value that isn't
 * one of the presets is treated as custom: the custom swatch shows it, reads as
 * selected, and its hex is displayed. Emits `#rrggbb` on every change.
 */
export function ColorPicker({
	value,
	onChange,
	className,
}: {
	value: string | undefined;
	onChange: (color: string) => void;
	className?: string;
}) {
	const customColor = value && !isPreset(value) ? value : undefined;

	return (
		<div className={cn("space-y-2.5", className)}>
			<div className="flex flex-wrap gap-2">
				{PRESET_SWATCHES.map((swatch) => {
					const selected = value?.toLowerCase() === swatch.toLowerCase();
					return (
						<button
							key={swatch}
							type="button"
							aria-label={swatch}
							onClick={() => onChange(swatch)}
							className={cn(
								"size-6 rounded-md ring-offset-2 ring-offset-background transition-shadow",
								selected && "ring-2 ring-ring",
							)}
							style={{ backgroundColor: swatch }}
						/>
					);
				})}
			</div>

			<div className="flex items-center gap-2">
				{/* Native color input behind a swatch-styled label: when a non-preset
				    color is active the label shows it and reads as selected; otherwise a
				    rainbow-with-plus invites picking one. */}
				<label
					title="Custom color"
					className={cn(
						"relative size-6 shrink-0 cursor-pointer rounded-md ring-offset-2 ring-offset-background transition-shadow",
						customColor && "ring-2 ring-ring",
					)}
					style={
						customColor
							? { backgroundColor: customColor }
							: {
									backgroundImage:
										"conic-gradient(from 0deg, #f87171, #fbbf24, #4ade80, #22d3ee, #818cf8, #e879f9, #f87171)",
								}
					}
				>
					<input
						type="color"
						aria-label="Custom color"
						value={customColor ?? "#7b54d6"}
						onChange={(e) => onChange(e.target.value)}
						className="absolute inset-0 size-full cursor-pointer opacity-0"
					/>
					{!customColor && (
						<Plus className="pointer-events-none absolute inset-0 m-auto size-3.5 text-white drop-shadow-sm" />
					)}
				</label>
				<span className="text-xs text-muted-foreground">
					Custom color
					{customColor && (
						<span className="ml-1.5 font-mono uppercase">{customColor}</span>
					)}
				</span>
			</div>
		</div>
	);
}
