import assert from "node:assert/strict";
import test from "node:test";
import { requestsProjectAction } from "../src/services/actionIntent.ts";

const history = (content: string) => [{ role: "user" as const, content }];

test("reconoce peticiones naturales para crear y editar archivos", () => {
  for (const prompt of [
    "hazme un html de login",
    "créame el archivo",
    "creame un archivo en aprender",
    "construye una página y guarda el código",
    "edítame index.html",
    "pero actualiza el html, no me des el código",
    "pon tú el código en el HTML",
    "guarda esa implementación en index.html",
    "aplica el bloque anterior al archivo",
    "realiza una reconstrucción visual completa en Canvas",
    "mejora la función de renderizado del pájaro",
    "cambia el fondo del juego",
    "arregla el proyecto",
    "elimíname los archivos de la carpeta temp",
    "bórrame cache/old.json",
    "renómbrame config.old a config.json",
    "muéveme el archivo a src",
    "quiero que borres los archivos temporales",
    "necesito que elimines la carpeta cache",
    "puedes renombrar el archivo de configuración",
    "crea un archivo en C:\\abuela",
    "pero haz el archivo aquí en esta ruta C:\\Users\\Usuario\\Downloads",
    "make a login page",
    "fix the current file",
  ]) {
    assert.equal(requestsProjectAction(prompt, []), true, prompt);
  }
});

test("no convierte preguntas o inspecciones en escrituras", () => {
  for (const prompt of [
    "puedes ver esta carpeta?",
    "qué archivos hay en el proyecto",
    "cómo crear un archivo html",
    "explica cómo editar index.html",
    "dame los pasos para poner mi bot de Discord",
    "dame instrucciones para instalar y ejecutar el bot",
    "hazme una guía para configurar el bot",
    "puedes ver esta carpeta C:\\abuela?",
    "hola",
  ]) {
    assert.equal(requestsProjectAction(prompt, []), false, prompt);
  }
});

test("una continuación hereda solamente una tarea de escritura anterior", () => {
  assert.equal(requestsProjectAction("continúa", history("hazme un html")), true);
  assert.equal(requestsProjectAction("hazlo", history("puedes ver el proyecto")), false);
  assert.equal(requestsProjectAction("continúa", [
    { role: "user", content: "actualiza index.html" },
    { role: "assistant", content: "Necesito confirmar el formato" },
    { role: "user", content: "sí" },
  ]), true);
});

test("una guía no hereda una operación anterior", () => {
  assert.equal(requestsProjectAction("dame los pasos para poner mi bot de Discord", history("créame un bot de Discord")), false);
  assert.equal(requestsProjectAction("haz una guía en README.md", history("créame un bot de Discord")), true);
});
