// Rotates across the locked sub-lanes for "Unspoken Psychology".
// State is tracked in content/state.json so each run picks the next lane in sequence.

export const TOPIC_LANES = [
	{
		id: 'dark_psychology',
		label: 'Dark psychology',
		guidance:
			'Manipulation tactics and how to recognize/counter them. Frame as awareness, not how-to-manipulate.',
	},
	{
		id: 'persuasion',
		label: 'Persuasion & influence',
		guidance: 'Principles of influence (reciprocity, authority, scarcity, framing, negotiation).',
	},
	{
		id: 'body_language',
		label: 'Body language & microexpressions',
		guidance: 'What specific gestures, posture, or facial cues actually signal.',
	},
	{
		id: 'cognitive_biases',
		label: 'Cognitive biases',
		guidance: 'A specific bias (anchoring, sunk cost, confirmation bias, etc.) and how it shows up daily.',
	},
	{
		id: 'attachment',
		label: 'Attachment & relationship psychology',
		guidance: 'Attachment styles, relationship patterns, red/green flags grounded in real psychology.',
	},
];

export function nextTopicLane(lastLaneId) {
	if (!lastLaneId) return TOPIC_LANES[0];
	const idx = TOPIC_LANES.findIndex((l) => l.id === lastLaneId);
	const next = TOPIC_LANES[(idx + 1) % TOPIC_LANES.length];
	return next;
}
