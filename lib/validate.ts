import { z } from "zod";

export const settingsSchema = z.object({
  durationSec: z.number().min(4).max(120).default(20),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  style: z
    .enum(["realistic", "cinematic-documentary", "historical", "dark-mystery", "fantasy", "animation", "custom"])
    .default("cinematic-documentary"),
  customStyle: z.string().max(200).optional(),
  motionIntensity: z.enum(["low", "medium", "high"]).default("medium"),
  cameraMovement: z.string().max(200).optional(),
  resolution: z.string().max(40).optional(),
  negativePrompt: z.string().max(1000).optional()
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120).default("Untitled video"),
  prompt: z.string().min(10).max(4000),
  negativePrompt: z.string().max(1000).optional(),
  settings: settingsSchema,
  providerId: z.string().min(1).default("mock")
});

export const characterSchema = z.object({
  name: z.string().min(1).max(80),
  age: z.string().max(40).optional().default(""),
  role: z.string().max(80).optional().default(""),
  fixedDescription: z.string().min(10).max(2000),
  clothing: z.string().max(300).optional().default(""),
  distinctiveFeatures: z.string().max(300).optional().default(""),
  approved: z.boolean().optional().default(false)
});

export const sceneUpdateSchema = z.object({
  title: z.string().max(120).optional(),
  visualPrompt: z.string().min(10).max(4000).optional(),
  camera: z.string().max(300).optional(),
  lighting: z.string().max(300).optional(),
  narrationSegment: z.string().max(2000).optional(),
  caption: z.string().max(300).optional(),
  durationSec: z.number().min(2).max(10).optional()
});

export function sanitizePrompt(s: string): string {
  // Never treat model text as code: strip control chars, cap length.
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, 4000);
}
