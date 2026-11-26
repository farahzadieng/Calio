import { Player } from "@remotion/player";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill, Img } from "remotion";
import landscape from "../../../assets/illustrations/landscape.webp";

function Reveal() {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={6}>
        <AbsoluteFill style={{ background: "transparent" }} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 6 })}
      />
      <TransitionSeries.Sequence durationInFrames={10}>
        <AbsoluteFill>
          <Img
            src={landscape}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
}

export default function ReportReveal({
  reduceMotion,
}: {
  reduceMotion: boolean;
}) {
  return (
    <div className="report-reveal" aria-hidden="true">
      {reduceMotion ? (
        <img src={landscape} alt="" width="560" height="315" />
      ) : (
        <Player
          component={Reveal}
          compositionWidth={560}
          compositionHeight={146}
          durationInFrames={10}
          fps={30}
          autoPlay
          controls={false}
          loop={false}
          clickToPlay={false}
          allowFullscreen={false}
          numberOfSharedAudioTags={0}
          style={{ width: "100%" }}
        />
      )}
    </div>
  );
}
