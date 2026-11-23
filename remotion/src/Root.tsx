import { Composition } from "remotion";
import "./fonts";
import { FORMATS, FPS, Short, calculateShortMetadata, type ShortProps } from "./Short";

// Valeurs par défaut pour le Studio : fichiers locaux de public/input (non versionnés).
const defaultProps: ShortProps = {
  format: "9:16",
  title: "Titre de la vidéo",
  avatar: "input/avatar.webm",
  audio: "input/voice.mp3",
  alignment: "input/voice-alignment.json",
  durationSeconds: 10,
};

export function Root() {
  return (
    <Composition
      id="Short"
      component={Short}
      defaultProps={defaultProps}
      calculateMetadata={calculateShortMetadata}
      width={FORMATS["9:16"].width}
      height={FORMATS["9:16"].height}
      fps={FPS}
      durationInFrames={FPS * defaultProps.durationSeconds}
    />
  );
}
