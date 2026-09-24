import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

export function renderOgImage({
	eyebrow,
	title,
	description,
}: {
	eyebrow: string;
	title: string;
	description?: string;
}) {
	return new ImageResponse(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				width: "100%",
				height: "100%",
				padding: 72,
				background: "#0a0a0a",
				backgroundImage:
					"radial-gradient(circle at 85% 10%, rgba(197,247,79,0.22), transparent 45%)",
				color: "#fafafa",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 16,
					fontSize: 32,
					fontWeight: 600,
				}}
			>
				<div
					style={{
						width: 20,
						height: 20,
						borderRadius: 999,
						background: "#c5f74f",
					}}
				/>
				better-drizzle
				<span style={{ color: "#a1a1aa", fontWeight: 400 }}>
					{`/ ${eyebrow}`}
				</span>
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
				<div
					style={{
						fontSize: 76,
						fontWeight: 700,
						lineHeight: 1.05,
						letterSpacing: -2,
					}}
				>
					{title}
				</div>
				{description ? (
					<div
						style={{
							fontSize: 32,
							color: "#a1a1aa",
							lineHeight: 1.35,
						}}
					>
						{description}
					</div>
				) : null}
			</div>
			<div style={{ display: "flex", fontSize: 26, color: "#c5f74f" }}>
				Type-safe repository API for Drizzle ORM
			</div>
		</div>,
		OG_SIZE,
	);
}
