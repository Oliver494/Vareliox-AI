import type { MediaMode } from "../types";

export function requestedMediaMode(prompt: string): MediaMode | null {
  const normalized = prompt.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const explicitAction = /\b(crea|crear|creame|genera|generar|generame|haz|hacer|disena|dibuja|produce|animate|anima|create|generate|draw|make)\b/;
  if (!explicitAction.test(normalized)) return null;
  if (/\b(video|animacion|animar|clip|motion)\b/.test(normalized)) return "video";
  if (/\b(imagen|ilustracion|foto|fotografia|logo|poster|portada|image|illustration|picture|photo|thumbnail)\b/.test(normalized)) return "image";
  return null;
}
