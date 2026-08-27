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
			// calculateMetadata lets duration adjust to whatever script is passed via --props.
			// NOTE: props here ARE the script directly (flat shape) — every script-XXX.json
			// file written by generate_script.mjs is flat, not nested under a "script" key,
			// and --props injects that file's content as the top-level props object. An
			// earlier version of this file expected props.script, which was always undefined
			// for real pipeline runs and silently fell back to script-001 every time.
			calculateMetadata={async ({props}) => {
				const hasContent = props && Object.keys(props).length > 0;
				const s = (hasContent ? props : typed) as ReelScript;
				return {durationInFrames: getReelDurationInFrames(s, FPS)};
			}}
			durationInFrames={getReelDurationInFrames(typed, FPS)}
			fps={FPS}
			width={WIDTH}
			height={HEIGHT}
			defaultProps={typed}
		/>
	);
};
