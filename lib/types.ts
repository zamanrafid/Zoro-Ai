export type AspectRatio = "9:16" | "16:9" | "1:1";
export type VisualStyle =
  | "realistic"
  | "cinematic-documentary"
  | "historical"
  | "dark-mystery"
  | "fantasy"
  | "animation"
  | "custom";

export interface VideoSettings {
  durationSec: number;
  aspectRatio: AspectRatio;
  style: VisualStyle;
  customStyle?: string;
  motionIntensity?: "low" | "medium" | "high";
  cameraMovement?: string;
  resolution?: string;
  negativePrompt?: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  age: string;
  faceShape: string;
  facialFeatures: string;
  skinTone: string;
  eyeColor: string;
  hairstyle: string;
  hairColor: string;
  bodyType: string;
  height: string;
  clothing: string;
  accessories: string;
  distinctiveFeatures: string;
  personality: string;
  role: string;
  /** Fixed reusable visual description stamped into every scene prompt. */
  fixedDescription: string;
  referenceImagePath?: string;
  referenceImageUrl?: string;
  approved: boolean;
  seed?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScenePlan {
  id: string;
  index: number;
  durationSec: number;
  title: string;
  visualPrompt: string;
  camera: string;
  lighting: string;
  transitionIn: string;
  transitionOut: string;
  characterIds: string[];
  narrationSegment: string;
  caption: string;
  sound: string;
  negativePrompt?: string;
  /** Free AI still image for this scene (Pollinations). Used by Free Movie Mode. */
  stillPath?: string;
}

export type JobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface GenerationJob {
  id: string;
  sceneId: string;
  providerId: string;
  model?: string;
  status: JobStatus;
  progress?: number;
  providerJobId?: string;
  clipPath?: string;
  posterPath?: string;
  error?: string;
  logs: string[];
  seed?: number;
  createdAt: string;
  updatedAt: string;
  isMock?: boolean;
}

export interface AssembleOutput {
  path?: string;
  srtPath?: string;
  status: "idle" | "processing" | "succeeded" | "failed";
  error?: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  prompt: string;
  negativePrompt?: string;
  settings: VideoSettings;
  providerId: string;
  title?: string;
  summary?: string;
  narrationScript?: string;
  characters: CharacterProfile[];
  scenes: ScenePlan[];
  sceneOrder: string[];
  jobs: GenerationJob[];
  narrationAudioPath?: string;
  narrationVolume: number;
  musicVolume: number;
  burnCaptions: boolean;
  output: AssembleOutput;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  kind: "mock" | "slideshow" | "replicate" | "huggingface" | "local";
  configured: boolean;
  requiresApiKey: boolean;
  costNote: string;
  supportsReferenceImages: boolean;
  referenceNote: string;
  maxClipSec: number;
  supportedAspects: AspectRatio[];
  resolutions: string[];
  missing?: string;
}
