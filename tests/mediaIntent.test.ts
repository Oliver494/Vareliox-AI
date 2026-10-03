import assert from "node:assert/strict";
import test from "node:test";
import { requestedMediaMode } from "../src/services/mediaIntent.ts";

test("detecta solicitudes explícitas de imagen y vídeo", () => {
  assert.equal(requestedMediaMode("créame una imagen de una ciudad futurista"), "image");
  assert.equal(requestedMediaMode("genera un logo minimalista para Vareliox"), "image");
  assert.equal(requestedMediaMode("anima esta imagen y crea un vídeo corto"), "video");
  assert.equal(requestedMediaMode("create a thumbnail for my project"), "image");
});

test("no activa herramientas multimedia para preguntas ambiguas", () => {
  assert.equal(requestedMediaMode("¿qué modelo de imagen recomiendas?"), null);
  assert.equal(requestedMediaMode("explícame cómo funciona un vídeo"), null);
  assert.equal(requestedMediaMode("haz un resumen de este texto"), null);
});
