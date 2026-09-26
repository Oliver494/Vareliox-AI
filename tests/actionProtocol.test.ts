import assert from "node:assert/strict";
import test from "node:test";
import { actionRepairPrompt, canUseCodeBlockAsWrite, proposedActions } from "../src/services/actionProtocol.ts";

test("acepta acciones oficiales y bloques sin cierre de modelos locales", () => {
  assert.deepEqual(proposedActions('<nova_actions>{"actions":[{"type":"delete","path":"temp/a.txt"}]}</nova_actions>'), [{ type: "delete", path: "temp/a.txt" }]);
  assert.deepEqual(proposedActions('<nova_actions>{"actions":[{"type":"delete","path":"temp/b.txt"}]}'), [{ type: "delete", path: "temp/b.txt" }]);
});

test("normaliza variantes frecuentes sin ampliar las operaciones permitidas", () => {
  assert.deepEqual(proposedActions('```json\n{"operations":[{"operation":"remove","file":"cache/a.tmp",}, {"action":"move","ruta":"a.txt","destination":"b.txt"}]}\n```'), [
    { type: "delete", path: "cache/a.tmp" },
    { type: "rename", path: "a.txt", newPath: "b.txt" },
  ]);
  assert.deepEqual(proposedActions('{"action":"execute","path":"danger"}'), []);
});

test("extrae JSON válido rodeado de explicación y elimina duplicados", () => {
  assert.deepEqual(proposedActions('Voy a hacerlo. {"changes":[{"type":"mkdir","path":"src/ui"},{"type":"mkdir","path":"src/ui"}]} Listo.'), [{ type: "mkdir", path: "src/ui" }]);
});

test("la reparación conserva la intención destructiva original", () => {
  const prompt = actionRepairPrompt("elimíname los archivos de temp", 1);
  assert.match(prompt, /si pidió eliminar usa delete/);
  assert.match(prompt, /No inventes una operación write/);
  assert.match(prompt, /elimíname los archivos de temp/);
});

test("una respuesta con código no se transforma en escritura durante una eliminación", () => {
  assert.equal(canUseCodeBlockAsWrite("elimíname los archivos de temp"), false);
  assert.equal(canUseCodeBlockAsWrite("renombra index.old"), false);
  assert.equal(canUseCodeBlockAsWrite("crea index.html"), true);
});
