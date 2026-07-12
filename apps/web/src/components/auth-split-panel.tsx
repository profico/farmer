import type { ReactNode } from "react";

export function AuthSplitPanel({
	tagline,
	brandContent,
	children,
}: {
	tagline: string;
	brandContent?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-svh items-center justify-center p-4 sm:p-8">
			<div className="flex w-full max-w-[900px] overflow-hidden rounded-2xl border shadow-sm">
				<div className="hidden w-[300px] shrink-0 flex-col bg-[#241c33] p-8 text-[#e6dcf0] md:flex">
					<img
						src="/profico-logo-white.svg"
						alt="Profico"
						className="h-6 w-auto"
					/>
					<div className="mt-auto">
						<p className="font-display text-[28px] leading-[1.15] text-white">
							{tagline}
						</p>
						{brandContent}
					</div>
				</div>
				<div className="flex flex-1 flex-col justify-center bg-card px-5 py-8 sm:px-12 sm:py-10">
					{children}
				</div>
			</div>
		</div>
	);
}
