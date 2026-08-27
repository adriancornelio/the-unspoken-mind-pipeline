import React from 'react';
import {Composition} from 'remotion';
import {Reel, getReelDurationInFrames, ReelScript} from './Reel';
// Fallback script — only used when previewing in Remotion Studio with no --props passed.
// Real renders always pass --props=content/script-XXX.json (see scripts/run_pipeline.mjs).
import fallbackScript from '../content/script-001.json';

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

export const RemotionRoot: React.FC = () => {
	const typed = fallbackScript as ReelScript;

	return (
		<Composition
			id="Reel"
			component={Reel}
			// calculateMetadata lets duration adjust to whatever script is passed via --props
			calculateMetadata={async ({props}) => {
				const s = (props.script || typed) as ReelScript;
				return {durationInFrames: getReelDurationInFrames(s, FPS)};
			}}
			durationInFrames={getReelDurationInFrames(typed, FPS)}
			fps={FPS}
			width={WIDTH}
			height={HEIGHT}
			defaultProps={{script: typed}}
		/>
	);
};
