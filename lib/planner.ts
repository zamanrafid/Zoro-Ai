import { v4 as uuidv4 } from "uuid";
import type { CharacterProfile, ScenePlan, VideoSettings } from "./types";

export interface PlanInput {
  prompt: string;
  negativePrompt?: string;
  settings: VideoSettings;
  providerMaxClipSec?: number;
}

export interface Storyboard {
  title: string;
  summary: string;
  narrationScript: string;
  characters: CharacterProfile[];
  scenes: ScenePlan[];
  negativePrompt: string;
}

/** Deterministic hash so the same prompt yields the same cast (stable seeds). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STOP = new Set(
  "a,an,the,and,or,but,with,from,into,during,after,before,while,when,where,who,whom,whose,which,that,this,these,those,then,than,there,their,they,them,he,she,it,we,you,your,our,for,of,on,in,at,to,as,by,is,are,was,were,be,been,being,has,have,had,will,would,can,could,should,shall,may,might,must,not,no,yes,if,else,very,just,about,over,under,between,through,across,behind,beyond,film,video,movie,scene,story,cinematic,documentary".split(",")
);

function guessNames(prompt: string): string[] {
  // Capture capitalized multi-word phrases as candidate character names.
  const matches = prompt.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const key = m.toLowerCase();
    if (STOP.has(key.split(" ")[0])) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= 3) break;
  }
  return out;
}

function guessRoles(prompt: string): string[] {
  const p = prompt.toLowerCase();
  const roles: string[] = [];
  const table: Array<[RegExp, string]> = [
    [/detectiv|mystery|noir|case\b|murder|secret/, "Detective"],
    [/histor|ancient|empire|king|queen|pharaoh|roman|viking|mediev|warrior/, "Historical figure"],
    [/astronaut|space|planet|galaxy|alien|cosmos/, "Astronaut explorer"],
    [/pirate|ship|captain|sea\b|ocean/, "Sea captain"],
    [/chef|kitchen|restaurant|cook/, "Chef"],
    [/doctor|hospital|clinic|surgeon/, "Doctor"],
    [/teacher|school|professor|scientist|lab/, "Scientist"],
    [/ghost|haunt|horror|vampire|witch|monster/, "Mystery witness"],
    [/princess|prince|knight|dragon|wizard|fairy|elf/, "Fantasy hero"],
    [/robot|cyber|android|ai\b/, "Robot companion"],
    [/child|kid|boy|girl|daughter|son/, "Young protagonist"],
    [/mother|father|grandmother|grandfather|family/, "Family elder"]
  ];
  for (const [re, role] of table) {
    if (re.test(p)) roles.push(role);
  }
  return roles.slice(0, 3);
}

const FIRST = ["Amina", "Ravi", "Elena", "Marcus", "Yuki", "Omar", "Sofia", "Darius", "Nadia", "Theo", "Priya", "Kofi"];
const SKIN = ["warm brown", "deep espresso", "olive", "fair with warm undertone", "golden tan", "rich mahogany"];
const EYES = ["dark brown", "amber", "hazel", "steel grey", "deep black", "green"];
const HAIR = ["short cropped black hair", "long wavy chestnut hair", "shoulder-length straight dark hair", "curly natural afro", "silver-streaked tied-back hair", "braided dark hair"];
const FACE = ["oval face with defined cheekbones", "round face with soft features", "angular face with strong jawline", "heart-shaped face with broad forehead"];
const BODY = ["slim athletic build", "medium sturdy build", "tall lean build", "compact strong build"];
const CLOTHING: Record<string, string[]> = {
  "cinematic-documentary": ["weathered field jacket over neutral shirt", "documentary crew vest with utility pockets"],
  historical: ["period-accurate tunic with leather belt and cloak", "embroidered historical robe with sash"],
  "dark-mystery": ["dark trench coat over charcoal sweater", "black coat with scarf and gloves"],
  fantasy: ["travel-worn cloak with leather bracers", "ornate fantasy tunic with belt pouches"],
  animation: ["bright stylized jacket with bold color blocks", "playful animated outfit with cap"],
  realistic: ["casual denim jacket over plain tee", "simple modern shirt and trousers"],
  custom: ["neutral modern outfit in muted tones", "practical layered outfit"]
};

function buildCharacter(
  name: string,
  role: string,
  style: string,
  seed: number,
  styleHint: string
): CharacterProfile {
  const rnd = mulberry(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const age = ["late 20s", "mid 30s", "early 40s", "mid 20s", "late 40s"][Math.floor(rnd() * 5)];
  const faceShape = pick(FACE);
  const skinTone = pick(SKIN);
  const eyeColor = pick(EYES);
  const hairstyle = pick(HAIR);
  const [hairStyleOnly, ...rest] = hairstyle.split(" ");
  void hairStyleOnly;
  void rest;
  const hairColor = hairstyle.includes("black") ? "black" : hairstyle.includes("chestnut") ? "chestnut brown" : hairstyle.includes("silver") ? "dark with silver streaks" : "dark brown";
  const bodyType = pick(BODY);
  const height = ["5'6\"", "5'9\"", "6'0\"", "5'4\"", "5'11\""][Math.floor(rnd() * 5)];
  const clothing = pick(CLOTHING[style] ?? CLOTHING.custom);
  const accessories = pick(["leather satchel", "brass compass pendant", "simple wristwatch", "round spectacles", "woven bracelet", "none — clean silhouette"]);
  const distinctiveFeatures = pick(["small scar above the left eyebrow", "mole on the right cheek", "freckles across the nose", "tattoo band on the forearm", "birthmark near the jawline"]);
  const personality = pick(["calm and observant", "determined and resourceful", "warm and curious", "stoic with dry humor"]);
  const fixedDescription = `${name}, ${age}, ${skinTone} skin, ${eyeColor} eyes, ${hairstyle}, ${faceShape}, highly detailed symmetrical face, ${bodyType}, ${height}, wearing ${clothing} with ${accessories}, distinctive mark: ${distinctiveFeatures}. ${styleHint} style, photorealistic consistent identity.`;
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    name,
    age,
    faceShape,
    facialFeatures: faceShape,
    skinTone,
    eyeColor,
    hairstyle,
    hairColor,
    bodyType,
    height,
    clothing,
    accessories,
    distinctiveFeatures,
    personality,
    role,
    fixedDescription,
    approved: false,
    seed: seed % 100000,
    createdAt: now,
    updatedAt: now
  };
}

const BEATS = [
  { camera: "Slow push-in, eye-level", lighting: "Soft natural daylight, gentle shadows", transition: "Fade in from black" },
  { camera: "Tracking shot following the character", lighting: "Warm golden-hour glow, rim light on hair", transition: "Seamless match-cut on movement" },
  { camera: "Over-the-shoulder, shallow depth of field", lighting: "Moody contrast, practical lights in background", transition: "Whip-pan carrying motion across the cut" },
  { camera: "Wide establishing shot, slow drift", lighting: "Cool ambient tones with warm key light", transition: "Cross-dissolve suggesting time passing" },
  { camera: "Low-angle heroic framing, slow orbit", lighting: "Dramatic side light, deep shadows", transition: "Hard cut on action beat" },
  { camera: "Close-up on hands and face, handheld sway", lighting: "Intimate soft key, dark falloff", transition: "Fade through shadow to next scene" }
];

const LOCATIONS = [
  "the doorway of a weathered house at dawn",
  "a narrow street lined with old lamps",
  "an interior room filled with maps and relics",
  "a windswept overlook above the town",
  "a torch-lit hall of stone and timber",
  "a misty courtyard at blue hour"
];

function summarizePrompt(prompt: string): string {
  const s = prompt.replace(/\s+/g, " ").trim();
  return s.length > 220 ? s.slice(0, 217) + "…" : s;
}

function styleHintFor(style: string, custom?: string): string {
  const map: Record<string, string> = {
    realistic: "ultra-realistic natural photography",
    "cinematic-documentary": "cinematic documentary realism, 35mm film look",
    historical: "historical epic realism, authentic period detail",
    "dark-mystery": "dark mystery thriller, noir shadows, teal-orange grade",
    fantasy: "epic fantasy realism, painterly cinematic light",
    animation: "high-quality stylized animation, clean shapes",
    custom: custom?.trim() || "cinematic realism"
  };
  return map[style] ?? map.custom;
}

export function planStoryboard(input: PlanInput): Storyboard {
  const { prompt, negativePrompt, settings } = input;
  const clean = prompt.trim();
  if (clean.length < 10) throw new Error("Prompt is too short. Describe your story in at least a few words.");
  if (clean.length > 50000) throw new Error("Prompt is too long (max 50000 characters). Shorten it a little.");

  const maxClip = Math.max(2, Math.min(10, input.providerMaxClipSec ?? 5));
  const total = Math.max(4, Math.min(120, Math.round(settings.durationSec)));
  const count = Math.max(1, Math.round(total / maxClip));
  const per: number[] = [];
  let remaining = total;
  for (let i = 0; i < count; i++) {
    const left = count - i;
    const d = Math.round(remaining / left);
    per.push(Math.max(2, Math.min(maxClip, d)));
    remaining -= per[per.length - 1];
  }

  const seedBase = hashString(clean);
  const names = guessNames(clean);
  const roles = guessRoles(clean);
  const hint = styleHintFor(settings.style, settings.customStyle);
  const characters: CharacterProfile[] = [];
  const castSize = Math.max(1, Math.min(3, names.length > 0 ? names.length : roles.length > 0 ? roles.length : 1));
  for (let i = 0; i < castSize; i++) {
    const name = names[i] ?? FIRST[(seedBase + i * 7) % FIRST.length];
    const role = roles[i] ?? (i === 0 ? "Protagonist" : i === 1 ? "Companion" : "Antagonist");
    characters.push(buildCharacter(name, role, settings.style, seedBase + i * 101, hint));
  }

  const aspectNote =
    settings.aspectRatio === "9:16"
      ? "vertical 9:16 composition, subject centered with headroom for captions"
      : settings.aspectRatio === "1:1"
        ? "square 1:1 composition, balanced centered framing"
        : "widescreen 16:9 cinematic composition, rule-of-thirds framing";

  const summary = summarizePrompt(clean);
  const title = (names[0] ?? summary.split(" ").slice(0, 5).join(" ")).slice(0, 60) || "Untitled Story";

  const narrationScript = per
    .map((d, i) => {
      const beat = i === 0 ? "It begins" : i === per.length - 1 ? "And in the end" : "Then";
      return `[Scene ${i + 1} — ${d}s] ${beat}: ${summary} (beat ${i + 1} of ${per.length}).`;
    })
    .join("\n");

  const scenes: ScenePlan[] = per.map((d, i) => {
    const beat = BEATS[(seedBase + i) % BEATS.length];
    const loc = LOCATIONS[(seedBase + i) % LOCATIONS.length];
    const cast = characters.map((c) => c.fixedDescription).join(" ");
    const continuity =
      i === 0
        ? `Opening frame establishes ${loc}; the character enters wearing exactly: ${characters[0]?.clothing ?? "neutral outfit"}.`
        : `Continues directly from scene ${i}: same location logic, same wardrobe (${characters.map((c) => c.clothing).join(" / ")}), no unexplained teleport.`;
    return {
      id: uuidv4(),
      index: i,
      durationSec: d,
      title: `Scene ${i + 1}`,
      visualPrompt:
        `${hint}, ${aspectNote}. ${continuity} ${summary}. ${cast} ` +
        `Environment: ${loc}. Motion: ${settings.motionIntensity ?? "medium"} intensity. ` +
        `Camera: ${settings.cameraMovement ?? beat.camera}. No text overlays, no watermark, no distorted faces, no extra limbs.`,
      camera: settings.cameraMovement ?? beat.camera,
      lighting: beat.lighting,
      transitionIn: i === 0 ? "Fade in from black" : per.length > 1 ? BEATS[(seedBase + i - 1) % BEATS.length].transition : beat.transition,
      transitionOut: i === per.length - 1 ? "Fade to black" : beat.transition,
      characterIds: characters.map((c) => c.id),
      narrationSegment: narrationScript.split("\n")[i] ?? "",
      caption: summary.split(".")[0]?.slice(0, 90) ?? `Scene ${i + 1}`,
      sound: i === 0 ? "soft ambient bed, subtle room tone" : "continuous ambient bed, gentle whoosh on transition",
      negativePrompt: negativePrompt?.trim() || "blurry, distorted face, extra limbs, watermark, logo, text overlay, low quality"
    };
  });

  return {
    title,
    summary,
    narrationScript,
    characters,
    scenes,
    negativePrompt: negativePrompt?.trim() || "blurry, distorted face, extra limbs, watermark, logo, text overlay, low quality"
  };
}

/** Map raw LLM JSON onto the storyboard shape (offline board supplies ids + fallbacks). */
function boardFromLlmJson(
  input: PlanInput,
  offline: Storyboard,
  parsed: Record<string, unknown>
): Storyboard {
  const now = new Date().toISOString();
  const rawChars = Array.isArray(parsed.characters) ? parsed.characters : [];
  const characters: CharacterProfile[] = rawChars.slice(0, 3).map((c: unknown, i: number) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      id: offline.characters[i]?.id ?? uuidv4(),
      name: String(o.name ?? `Character ${i + 1}`).slice(0, 80),
      age: String(o.age ?? offline.characters[i]?.age ?? "mid 30s"),
      faceShape: offline.characters[i]?.faceShape ?? "",
      facialFeatures: offline.characters[i]?.facialFeatures ?? "",
      skinTone: offline.characters[i]?.skinTone ?? "",
      eyeColor: offline.characters[i]?.eyeColor ?? "",
      hairstyle: offline.characters[i]?.hairstyle ?? "",
      hairColor: offline.characters[i]?.hairColor ?? "",
      bodyType: offline.characters[i]?.bodyType ?? "",
      height: offline.characters[i]?.height ?? "",
      clothing: offline.characters[i]?.clothing ?? "",
      accessories: offline.characters[i]?.accessories ?? "",
      distinctiveFeatures: offline.characters[i]?.distinctiveFeatures ?? "",
      personality: offline.characters[i]?.personality ?? "",
      role: String(o.role ?? "Protagonist"),
      fixedDescription: String(o.fixedDescription ?? offline.characters[i]?.fixedDescription ?? "").slice(0, 2000),
      approved: false,
      createdAt: now,
      updatedAt: now
    };
  });
  const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  if (!rawScenes.length) throw new Error("empty llm scenes");
  const charIds = (characters.length ? characters : offline.characters).map((c) => c.id);
  const scenes: ScenePlan[] = rawScenes.map((s: unknown, i: number) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const dur = Number(o.durationSec) || offline.scenes[i]?.durationSec || 5;
    return {
      id: uuidv4(),
      index: i,
      durationSec: Math.max(2, Math.min(10, Math.round(dur))),
      title: String(o.title ?? `Scene ${i + 1}`).slice(0, 120),
      visualPrompt: String(o.visualPrompt ?? offline.scenes[i]?.visualPrompt ?? "").slice(0, 4000),
      camera: String(o.camera ?? ""),
      lighting: String(o.lighting ?? ""),
      transitionIn: String(o.transitionIn ?? ""),
      transitionOut: String(o.transitionOut ?? ""),
      characterIds: charIds,
      narrationSegment: String(o.narrationSegment ?? ""),
      caption: String(o.caption ?? "").slice(0, 300),
      sound: String(o.sound ?? ""),
      negativePrompt: input.negativePrompt
    };
  });
  return {
    title: String(parsed.title ?? offline.title).slice(0, 120),
    summary: String(parsed.summary ?? offline.summary).slice(0, 2000),
    narrationScript: String(parsed.narrationScript ?? offline.narrationScript).slice(0, 200000),
    characters: characters.length ? characters : offline.characters,
    scenes,
    negativePrompt: offline.negativePrompt
  };
}

const PLANNER_SYSTEM =
  "You are ZORO AI's storyboard planner. Return strict JSON with keys: title, summary, narrationScript, characters (array of {name, role, age, fixedDescription}), scenes (array of {title, durationSec, visualPrompt, camera, lighting, transitionIn, transitionOut, narrationSegment, caption, sound}). Keep continuity across scenes.";

function plannerUserMessage(input: PlanInput): string {
  // LLM planners get a trimmed prompt (context limits); the offline planner uses the full text.
  const p = input.prompt.length > 8000 ? input.prompt.slice(0, 8000) + "\n[truncated for planning]" : input.prompt;
  return `Prompt: ${p}\nStyle: ${input.settings.style}\nAspect: ${input.settings.aspectRatio}\nTotal seconds: ${input.settings.durationSec}\nMax clip seconds: ${input.providerMaxClipSec ?? 5}\nNegative: ${input.negativePrompt ?? ""}`;
}

/**
 * Storyboard planning, cheapest-first:
 * 1. configured OpenAI-compatible LLM (user key),
 * 2. FREE Pollinations text API (no key),
 * 3. built-in offline planner (always works).
 */
export async function planWithOptionalLLM(
  input: PlanInput
): Promise<{ board: Storyboard; planner: "llm" | "free" | "offline" }> {
  const key = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_PLANNER_MODEL;
  if (key && base && model) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: PLANNER_SYSTEM },
            { role: "user", content: plannerUserMessage(input) }
          ],
          temperature: 0.7
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text: string = data?.choices?.[0]?.message?.content ?? "";
        const parsed = JSON.parse(text) as Record<string, unknown>;
        return { planner: "llm", board: boardFromLlmJson(input, planStoryboard(input), parsed) };
      }
    } catch {
      // fall through — never fail planning because a planner is down
    }
  }
  if (process.env.ZORO_DISABLE_FREE_PLANNER !== "1") {
    try {
      const { fetchFreePlannerJson } = await import("./free");
      const parsed = await fetchFreePlannerJson(PLANNER_SYSTEM, plannerUserMessage(input));
      return { planner: "free", board: boardFromLlmJson(input, planStoryboard(input), parsed) };
    } catch {
      // fall through to offline
    }
  }
  return { planner: "offline", board: planStoryboard(input) };
}
