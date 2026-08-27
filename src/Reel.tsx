import React from 'react';
import {
	AbsoluteFill,
	Audio,
	Sequence,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';

export type ReelPoint = {
	label: string;
	text: string;
	highlight?: string;
};

export type ReelScript = {
	hook: string;
	subhook?: string;
	points: ReelPoint[];
	cta: string;
	audioFile?: string; // filename inside public/audio/. Omit = no audio track (manual mix later).
};

const ACCENT = '#3B82F6'; // the ONLY accent color — used only for: numbers, highlighted
// psychology terms, progress bar, indicator dots, hook emphasis, small interface accents.
const BG_GRADIENT = 'radial-gradient(circle at 50% 20%, #1b1e26 0%, #111318 60%, #0a0b0e 100%)';
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";

// ─── Pacing ──────────────────────────────────────────────────────────────
// Duration is NOT fixed per section — it's computed from how much text is in
// that section, so a short point doesn't drag and a long one doesn't get cut
// off before the viewer can read it. Formula per section:
//   max(time the reveal animation needs, comfortable reading time for the
//   word count) + a hold pause so the viewer isn't rushed to the next beat
//   the instant the last word lands.
const SECONDS_PER_WORD = 0.32; // ~3.1 words/sec — a comfortable silent-reading pace for short captions
const READ_BUFFER_SECONDS = 0.3; // initial fixation time before reading speed kicks in
const HOLD_SECONDS = 0.7; // pause after the text is fully revealed, before cutting away
const MIN_HOOK_SECONDS = 2.6;
const MIN_POINT_SECONDS = 2.6;
const CTA_SECONDS = 2.4; // CTA content is brand-fixed (not Gemini-length-variable), so this stays constant

// ─── Phrase-chunk reveal timing ─────────────────────────────────────────
// Text reveals in whole semantic phrases (clauses), not individual words —
// e.g. "If they over-explain your tiny mistake," lands as one unit, not
// word-by-word. Gaps between chunks approximate natural narration rhythm:
// there is no actual voiceover in this pipeline (music only), so these are
// reading/speaking-rhythm heuristics, not measurements from real audio.
const NORMAL_CHUNK_GAP_SECONDS = 0.5; // between two ordinary chunks (spec range: 0.4-0.7s)
const PRE_HIGHLIGHT_GAP_SECONDS = 0.65; // extra breathing room before the emphasized term
const POST_HIGHLIGHT_HOLD_SECONDS = 0.9; // the term stays emphasized alone for a beat
const CHUNK_ENTER_SECONDS = 0.38; // each chunk's own fade/slide-in duration — restrained, not a pop
const EXIT_FRAMES = 10; // fade/slide-out window at the end of each point's Sequence

const FAST_SPRING = {damping: 200, stiffness: 260, mass: 0.5};

function wordCount(text: string): number {
	return text.replace(/[{}]/g, '').trim().split(/\s+/).filter(Boolean).length;
}

// ─── Sound design placeholders ──────────────────────────────────────────
// No real SFX assets exist yet — these are documented cue points only, in
// seconds from the start of the video, for a future sound-design pass to
// wire up (soft impact on hook, whoosh on point transitions, tick on
// emphasized terms). Not connected to any audio file.
export function getSfxCues(script: ReelScript, fps = 30) {
	const timing = computeTiming(script, fps);
	const cues: {label: string; atSeconds: number}[] = [];
	cues.push({label: 'hook_soft_impact', atSeconds: timing.hookStart / fps});
	script.points.forEach((_, i) => {
		const startSec = timing.pointStarts[i] / fps;
		const durSec = timing.pointDurs[i] / fps;
		cues.push({label: `point_${i + 1}_whoosh_in`, atSeconds: startSec});
		cues.push({label: `point_${i + 1}_term_tick`, atSeconds: startSec + durSec * 0.45});
	});
	cues.push({label: 'cta_soft_impact', atSeconds: timing.ctaStart / fps});
	return cues;
}

// Splits text into meaningful phrase chunks (clauses), not individual words.
// The {highlighted phrase} always becomes its own chunk; the surrounding
// plain text is split on commas so each chunk is a natural spoken unit —
// e.g. "If they over-explain your tiny mistake," / "they are using" /
// "weaponized guilt" (highlighted) / "against your confidence."
function chunkize(text: string): {text: string; highlighted: boolean}[] {
	const match = text.match(/\{([^}]+)\}/);
	const splitOnCommas = (s: string) =>
		s
			.split(/(?<=,)\s+/)
			.map((c) => c.trim())
			.filter(Boolean);

	if (!match) {
		return splitOnCommas(text).map((t) => ({text: t, highlighted: false}));
	}

	const before = text.slice(0, match.index);
	const highlighted = match[1];
	const after = text.slice((match.index || 0) + match[0].length);

	return [
		...splitOnCommas(before).map((t) => ({text: t, highlighted: false})),
		{text: highlighted, highlighted: true},
		...splitOnCommas(after).map((t) => ({text: t, highlighted: false})),
	];
}

// A soft breathing radial glow, meant to sit behind an emphasized/highlighted
// term. Continuous, slow, subconscious — never a hard pulse.
const GlowPulse: React.FC<{size?: number}> = ({size = 220}) => {
	const frame = useCurrentFrame();
	const breathe = 0.5 + 0.5 * Math.sin(frame / 40);
	const opacity = interpolate(breathe, [0, 1], [0.08, 0.22]);
	const scale = interpolate(breathe, [0, 1], [0.92, 1.05]);
	return (
		<div
			style={{
				position: 'absolute',
				left: '50%',
				top: '50%',
				width: size,
				height: size,
				transform: `translate(-50%, -50%) scale(${scale})`,
				background: `radial-gradient(circle, ${ACCENT} 0%, transparent 70%)`,
				opacity,
				zIndex: -1,
				pointerEvents: 'none',
			}}
		/>
	);
};

// Computes each chunk's start frame given the gap rules above, and returns
// the frame at which the whole run finishes revealing (used to time
// whatever comes after — subhook, tag pill, next section's duration).
function computeChunkStarts(
	chunks: {highlighted: boolean}[],
	fps: number,
	startDelayFrames = 0
): {starts: number[]; endFrame: number} {
	const starts: number[] = [];
	let t = startDelayFrames;
	chunks.forEach((c, i) => {
		if (i > 0) {
			const prevWasHighlight = chunks[i - 1].highlighted;
			const gapSeconds = prevWasHighlight
				? POST_HIGHLIGHT_HOLD_SECONDS
				: c.highlighted
				? PRE_HIGHLIGHT_GAP_SECONDS
				: NORMAL_CHUNK_GAP_SECONDS;
			t += Math.round(gapSeconds * fps);
		}
		starts.push(t);
	});
	const endFrame = (starts[starts.length - 1] || 0) + Math.round(CHUNK_ENTER_SECONDS * fps);
	return {starts, endFrame};
}

// Reveals a run of phrase chunks with a deliberate, controlled cadence —
// whole clauses fade/slide in together, not word-by-word. Highlighted
// phrases get a size/weight boost, a subtle scale-in, and a breathing glow,
// with extra pause before and after so they land as the payoff of the line.
const PhraseReveal: React.FC<{
	chunks: {text: string; highlighted: boolean}[];
	startDelayFrames?: number;
	fontSize: number;
	fontWeight?: number;
}> = ({chunks, startDelayFrames = 0, fontSize, fontWeight = 600}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const {starts} = computeChunkStarts(chunks, fps, startDelayFrames);
	const enterFrames = Math.round(CHUNK_ENTER_SECONDS * fps);

	return (
		<span style={{display: 'inline'}}>
			{chunks.map((c, i) => {
				const local = frame - starts[i];
				const opacity = interpolate(local, [0, enterFrames], [0, 1], {
					extrapolateLeft: 'clamp',
					extrapolateRight: 'clamp',
				});
				const translateY = interpolate(local, [0, enterFrames], [8, 0], {
					extrapolateLeft: 'clamp',
					extrapolateRight: 'clamp',
				});
				const scale = c.highlighted
					? interpolate(local, [0, enterFrames], [0.98, 1], {
							extrapolateLeft: 'clamp',
							extrapolateRight: 'clamp',
					  })
					: 1;

				return (
					<span
						key={i}
						style={{
							position: 'relative',
							display: 'inline',
							opacity,
							transform: `translateY(${translateY}px) scale(${scale})`,
							color: c.highlighted ? ACCENT : 'white',
							fontStyle: c.highlighted ? 'italic' : 'normal',
							fontFamily: SERIF,
							fontWeight: c.highlighted ? 700 : fontWeight,
							fontSize: c.highlighted ? fontSize * 1.14 : fontSize,
						}}
					>
						{c.highlighted ? <GlowPulse size={fontSize * 2.4} /> : null}
						{c.text}{' '}
					</span>
				);
			})}
		</span>
	);
};

const SignalPing: React.FC<{size?: number}> = ({size = 22}) => {
	const frame = useCurrentFrame();
	const cycle = 50;
	const ringA = (frame % cycle) / cycle;
	const ringB = ((frame + cycle / 2) % cycle) / cycle;

	const ring = (t: number) => ({
		scale: interpolate(t, [0, 1], [0.6, 2.2]),
		opacity: interpolate(t, [0, 0.15, 1], [0, 0.5, 0]),
	});
	const a = ring(ringA);
	const b = ring(ringB);

	return (
		<div style={{position: 'relative', width: size, height: size, margin: '0 auto'}}>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					borderRadius: '50%',
					border: `1.5px solid ${ACCENT}`,
					transform: `scale(${a.scale})`,
					opacity: a.opacity,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					borderRadius: '50%',
					border: `1.5px solid ${ACCENT}`,
					transform: `scale(${b.scale})`,
					opacity: b.opacity,
				}}
			/>
			<div style={{position: 'absolute', inset: size / 2 - 5, borderRadius: '50%', background: ACCENT}} />
		</div>
	);
};

const Watermark: React.FC = () => (
	<div
		style={{
			position: 'absolute',
			top: 60,
			left: 0,
			right: 0,
			display: 'flex',
			justifyContent: 'center',
			alignItems: 'center',
			gap: 14,
		}}
	>
		<div style={{width: 8, height: 8, borderRadius: 4, background: ACCENT}} />
		<div
			style={{
				color: 'rgba(255,255,255,0.55)',
				fontFamily: SERIF,
				fontSize: 26,
				letterSpacing: 4,
				textTransform: 'uppercase',
			}}
		>
			The Unspoken Mind
		</div>
	</div>
);

const ProgressBar: React.FC<{totalDurationInFrames: number}> = ({totalDurationInFrames}) => {
	const frame = useCurrentFrame();
	const pct = interpolate(frame, [0, totalDurationInFrames], [0, 100], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	return (
		<div style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: 6, background: 'rgba(255,255,255,0.08)'}}>
			<div style={{width: `${pct}%`, height: '100%', background: ACCENT}} />
		</div>
	);
};

// Slow, near-imperceptible drift across the whole video — the frame should
// never feel completely frozen.
const BackgroundDrift: React.FC<{totalDurationInFrames: number}> = ({totalDurationInFrames}) => {
	const frame = useCurrentFrame();
	const scale = interpolate(frame, [0, totalDurationInFrames], [1, 1.02], {extrapolateRight: 'clamp'});
	const translateX = interpolate(frame, [0, totalDurationInFrames], [0, -10], {extrapolateRight: 'clamp'});
	const glowBreathe = 0.5 + 0.5 * Math.sin(frame / 90);
	const glowOpacity = interpolate(glowBreathe, [0, 1], [0.5, 0.75]);

	return (
		<AbsoluteFill style={{background: BG_GRADIENT, transform: `scale(${scale}) translateX(${translateX}px)`}}>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '18%',
					width: 900,
					height: 900,
					transform: 'translate(-50%, -50%)',
					background: `radial-gradient(circle, ${ACCENT} 0%, transparent 65%)`,
					opacity: glowOpacity * 0.06,
				}}
			/>
		</AbsoluteFill>
	);
};

// A handful of soft, slowly-drifting dots — continuous ambient micro-motion
// the viewer shouldn't consciously register.
const FloatingGrain: React.FC = () => {
	const frame = useCurrentFrame();
	const particles = [
		{x: 12, y: 20, speed: 0.9, phase: 0, size: 3},
		{x: 82, y: 15, speed: 0.7, phase: 1.4, size: 2},
		{x: 25, y: 70, speed: 1.1, phase: 2.6, size: 2.5},
		{x: 70, y: 78, speed: 0.6, phase: 0.7, size: 3},
		{x: 90, y: 55, speed: 0.85, phase: 3.3, size: 2},
		{x: 8, y: 60, speed: 1.0, phase: 1.9, size: 2},
	];
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			{particles.map((p, i) => {
				const drift = Math.sin(frame / (30 / p.speed) + p.phase) * 14;
				const opacity = 0.12 + 0.08 * Math.sin(frame / (40 / p.speed) + p.phase);
				return (
					<div
						key={i}
						style={{
							position: 'absolute',
							left: `${p.x}%`,
							top: `${p.y}%`,
							width: p.size,
							height: p.size,
							borderRadius: '50%',
							background: '#ffffff',
							opacity,
							transform: `translateY(${drift}px)`,
							filter: 'blur(0.5px)',
						}}
					/>
				);
			})}
		</AbsoluteFill>
	);
};

// Three generic, abstract low-opacity motifs that rotate by point index.
// NOTE (honesty flag): these are NOT semantically tied to each point's actual
// concept (e.g. "false dilemma" specifically) — the concepts vary every run
// since Gemini writes them, so a hand-illustrated per-concept visual isn't
// feasible to generate reliably. These are generic "psychological tension"
// motifs that rotate 1/2/3 by point position instead.
const BackgroundMotif: React.FC<{variant: 0 | 1 | 2}> = ({variant}) => {
	const frame = useCurrentFrame();
	const opacity = 0.07;

	if (variant === 0) {
		const drift = Math.sin(frame / 100) * 6;
		return (
			<svg viewBox="0 0 400 400" style={{position: 'absolute', inset: 0, width: '100%', height: '100%', opacity}}>
				<path d={`M200,60 L${140 + drift},340`} stroke={ACCENT} strokeWidth="1.5" fill="none" />
				<path d={`M200,60 L${260 - drift},340`} stroke={ACCENT} strokeWidth="1.5" fill="none" />
			</svg>
		);
	}

	if (variant === 1) {
		const t = (frame % 140) / 140;
		const rings = [0, 0.33, 0.66].map((offset) => {
			const local = (t + offset) % 1;
			return {r: interpolate(local, [0, 1], [180, 20]), o: interpolate(local, [0, 1], [0, 0.5])};
		});
		return (
			<svg viewBox="0 0 400 400" style={{position: 'absolute', inset: 0, width: '100%', height: '100%', opacity}}>
				{rings.map((ring, i) => (
					<circle key={i} cx="200" cy="200" r={ring.r} stroke={ACCENT} strokeWidth="1" fill="none" opacity={ring.o} />
				))}
			</svg>
		);
	}

	const rotation = (frame / 3) % 360;
	return (
		<svg viewBox="0 0 400 400" style={{position: 'absolute', inset: 0, width: '100%', height: '100%', opacity}}>
			<g transform={`rotate(${rotation} 200 200)`}>
				<circle cx="200" cy="200" r="150" stroke={ACCENT} strokeWidth="1.5" fill="none" strokeDasharray="12 220" />
			</g>
		</svg>
	);
};

const TagPill: React.FC<{delayFrames: number}> = ({delayFrames}) => {
	const frame = useCurrentFrame();
	const opacity = interpolate(frame, [delayFrames, delayFrames + 10], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	return (
		<div style={{opacity}}>
			<div
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					gap: 10,
					border: `1px solid rgba(59,130,246,0.4)`,
					borderRadius: 999,
					padding: '10px 22px',
				}}
			>
				<div style={{width: 6, height: 6, borderRadius: 3, background: ACCENT}} />
				<div
					style={{
						fontFamily: SERIF,
						fontSize: 22,
						letterSpacing: 3,
						color: 'rgba(255,255,255,0.55)',
						textTransform: 'uppercase',
					}}
				>
					Psychological Insight
				</div>
			</div>
		</div>
	);
};

const HookCard: React.FC<{hook: string; subhook?: string}> = ({hook, subhook}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const cardEnter = spring({frame, fps, config: FAST_SPRING});
	const scale = interpolate(cardEnter, [0, 1], [0.96, 1]);
	const chunks = chunkize(hook);
	const {endFrame: revealEnd} = computeChunkStarts(chunks, fps);

	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', paddingLeft: 80, paddingRight: 80}}>
			<div style={{marginBottom: 36}}>
				<SignalPing />
			</div>
			<div style={{transform: `scale(${scale})`, textAlign: 'center'}}>
				<div style={{lineHeight: 1.16}}>
					<PhraseReveal chunks={chunks} fontSize={88} fontWeight={700} />
				</div>
				{subhook ? (
					<div
						style={{
							marginTop: 28,
							fontFamily: SERIF,
							fontStyle: 'italic',
							fontSize: 34,
							color: 'rgba(255,255,255,0.6)',
							opacity: interpolate(frame, [revealEnd + 4, revealEnd + 14], [0, 1], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
							}),
						}}
					>
						{subhook}
					</div>
				) : null}
				<div style={{marginTop: 60}}>
					<TagPill delayFrames={revealEnd + 14} />
				</div>
			</div>
		</AbsoluteFill>
	);
};

const PointCard: React.FC<{point: ReelPoint; index: number; durationInFrames: number}> = ({
	point,
	index,
	durationInFrames,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const cardEnter = spring({frame, fps, config: FAST_SPRING});
	const translateXIn = interpolate(cardEnter, [0, 1], [-24, 0]);
	const labelOpacity = interpolate(frame, [0, 6], [0, 1], {extrapolateRight: 'clamp'});
	const chunks = chunkize(point.text);

	// Exit fade/slide in the last EXIT_FRAMES of this card's on-screen time,
	// so consecutive points cross-fade instead of hard-cutting.
	const framesRemaining = durationInFrames - frame;
	const exitProgress = interpolate(framesRemaining, [0, EXIT_FRAMES], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const exitOpacity = 1 - exitProgress;
	const exitTranslateY = interpolate(exitProgress, [0, 1], [0, -16]);

	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', paddingLeft: 80, paddingRight: 80}}>
			<BackgroundMotif variant={(index % 3) as 0 | 1 | 2} />
			<div
				style={{
					transform: `translateX(${translateXIn}px) translateY(${exitTranslateY}px)`,
					opacity: exitOpacity,
					maxWidth: 920,
					textAlign: 'left',
				}}
			>
				<div
					style={{
						fontFamily: SERIF,
						fontSize: 100,
						fontWeight: 700,
						color: ACCENT,
						letterSpacing: 2,
						marginBottom: 10,
						opacity: labelOpacity,
						lineHeight: 1,
					}}
				>
					{point.label}
				</div>
				<div style={{lineHeight: 1.28}}>
					<PhraseReveal chunks={chunks} startDelayFrames={4} fontSize={76} fontWeight={600} />
				</div>
			</div>
		</AbsoluteFill>
	);
};

const CtaCard: React.FC<{cta: string}> = ({cta}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const leadEnter = spring({frame, fps, config: FAST_SPRING});
	const leadOpacity = interpolate(leadEnter, [0, 1], [0, 1]);

	const mainDelay = 16;
	const mainLocalFrame = Math.max(0, frame - mainDelay);
	const mainEnter = spring({frame: mainLocalFrame, fps, config: FAST_SPRING});
	const mainOpacity = interpolate(mainEnter, [0, 1], [0, 1]);
	const mainScale = interpolate(mainEnter, [0, 1], [0.94, 1]);

	const subOpacity = interpolate(frame, [mainDelay + 14, mainDelay + 24], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
			<div style={{textAlign: 'center'}}>
				<div style={{position: 'relative', display: 'inline-block', marginBottom: 22, opacity: leadOpacity}}>
					<div style={{fontFamily: SERIF, fontStyle: 'italic', fontSize: 32, color: 'rgba(255,255,255,0.65)'}}>
						Understand people better.
					</div>
				</div>

				<div style={{opacity: mainOpacity, transform: `scale(${mainScale})`, position: 'relative'}}>
					<GlowPulse size={260} />
					<div style={{width: 16, height: 16, borderRadius: 8, background: ACCENT, margin: '0 auto 22px'}} />
					<div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 54, color: 'white'}}>{cta}</div>
				</div>

				<div
					style={{
						marginTop: 22,
						opacity: subOpacity,
						fontFamily: SERIF,
						fontSize: 22,
						letterSpacing: 3,
						color: 'rgba(255,255,255,0.5)',
						textTransform: 'uppercase',
					}}
				>
					Psychology • Human Behavior
				</div>
			</div>
		</AbsoluteFill>
	);
};

const Vignette: React.FC = () => (
	<AbsoluteFill style={{background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)'}} />
);

const Grain: React.FC = () => (
	<AbsoluteFill
		style={{
			opacity: 0.035,
			backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.4) 0px, transparent 1px, transparent 2px)',
			mixBlendMode: 'overlay',
		}}
	/>
);

// Smooth fade to black over the last ENDING_FADE_SECONDS of the whole video,
// so the ending lands rather than cutting hard. Sits above everything else.
const ENDING_FADE_SECONDS = 0.8; // within the requested 0.6-1.0s range

const EndFade: React.FC<{totalDurationInFrames: number; fps: number}> = ({totalDurationInFrames, fps}) => {
	const frame = useCurrentFrame();
	const fadeFrames = Math.round(ENDING_FADE_SECONDS * fps);
	const fadeStart = totalDurationInFrames - fadeFrames;
	const opacity = interpolate(frame, [fadeStart, totalDurationInFrames], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	return <AbsoluteFill style={{background: '#000000', opacity, pointerEvents: 'none'}} />;
};

// Audio volume curve: steady at the normal level, then eases down to silence
// across the same ENDING_FADE_SECONDS window as the visual fade, so picture
// and sound land together instead of the music cutting off abruptly.
// Audio volume: kept constant here. Remotion's per-frame JS volume automation
// (tested extensively) reliably captures a fade spanning the ENTIRE clip, but
// under-samples/smooths away a fade confined to a short tail on longer clips —
// the sharp late change gets diluted into a barely-there overall slope instead
// of a real fade-to-silence. The actual audio fade-out is applied as a
// post-processing ffmpeg step in run_pipeline.mjs instead, which is
// sample-accurate and standard for exactly this. Kept as a plain constant here
// so this file doesn't imply an audio fade that isn't really happening.

function computeTiming(script: ReelScript, fps: number) {
	const hookChunks = chunkize(script.hook);
	const {endFrame: hookRevealFrames} = computeChunkStarts(hookChunks, fps);
	const hookRevealSeconds = hookRevealFrames / fps;
	const hookReadSeconds = wordCount(script.hook) * SECONDS_PER_WORD + READ_BUFFER_SECONDS;
	// +0.6s flat covers the subhook + tag pill finishing their own fade-in after the
	// main hook text lands — both are short/fixed, so a flat buffer is enough.
	const hookSeconds =
		Math.max(MIN_HOOK_SECONDS, hookRevealSeconds, hookReadSeconds) + HOLD_SECONDS + 0.6;
	const hookDur = Math.round(fps * hookSeconds);

	const pointDurs = script.points.map((point) => {
		const chunks = chunkize(point.text);
		const {endFrame: revealFrames} = computeChunkStarts(chunks, fps, 4);
		const revealSeconds = revealFrames / fps;
		const readSeconds = wordCount(point.text) * SECONDS_PER_WORD + READ_BUFFER_SECONDS;
		const pointSeconds = Math.max(MIN_POINT_SECONDS, revealSeconds, readSeconds) + HOLD_SECONDS;
		return Math.round(fps * pointSeconds);
	});

	const ctaDur = Math.round(fps * CTA_SECONDS);

	let cursor = 0;
	const hookStart = cursor;
	cursor += hookDur;
	const pointStarts = pointDurs.map((dur) => {
		const start = cursor;
		cursor += dur;
		return start;
	});
	const ctaStart = cursor;
	cursor += ctaDur;

	return {hookDur, pointDurs, ctaDur, hookStart, pointStarts, ctaStart, total: cursor};
}

export const Reel: React.FC<{script: ReelScript}> = ({script}) => {
	const {fps} = useVideoConfig();
	const timing = computeTiming(script, fps);

	return (
		<AbsoluteFill>
			<BackgroundDrift totalDurationInFrames={timing.total} />

			{script.audioFile ? <Audio src={staticFile(`audio/${script.audioFile}`)} volume={0.7} /> : null}

			<FloatingGrain />
			<Watermark />

			<Sequence from={timing.hookStart} durationInFrames={timing.hookDur}>
				<HookCard hook={script.hook} subhook={script.subhook} />
			</Sequence>

			{script.points.map((point, i) => (
				<Sequence key={i} from={timing.pointStarts[i]} durationInFrames={timing.pointDurs[i]}>
					<PointCard point={point} index={i} durationInFrames={timing.pointDurs[i]} />
				</Sequence>
			))}

			<Sequence from={timing.ctaStart} durationInFrames={timing.ctaDur}>
				<CtaCard cta={script.cta} />
			</Sequence>

			<Vignette />
			<Grain />
			<ProgressBar totalDurationInFrames={timing.total} />
			<EndFade totalDurationInFrames={timing.total} fps={fps} />
		</AbsoluteFill>
	);
};

export const getReelDurationInFrames = (script: ReelScript, fps: number) => {
	return computeTiming(script, fps).total;
};
