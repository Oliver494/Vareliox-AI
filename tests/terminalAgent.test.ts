import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTerminalAction, packageInstallActionForPrompt, systemInfoActionForPrompt, terminalActionLabel } from "../src/services/terminalAgent.ts";

test("storage questions use the native cross-platform system probe", () => {
  assert.deepEqual(systemInfoActionForPrompt("mira cuantos gb de almacenamiento tengo"), {
    program: "nova-system-info",
    args: [],
    purpose: "Consultar información real del sistema y del almacenamiento",
  });
  assert.equal(systemInfoActionForPrompt("explica qué es un NVMe"), null);
});

test("local RAM, CPU, GPU and operating-system questions use the same reliable probe", () => {
  for (const prompt of [
    "¿Cuánta RAM tengo en mi PC?",
    "qué CPU tiene este equipo",
    "dime cuál es mi tarjeta gráfica",
    "what operating system is this computer using?",
    "cuantos GB de almaceniamiento tengo",
  ]) {
    assert.equal(systemInfoActionForPrompt(prompt)?.program, "nova-system-info", prompt);
  }
});

test("general explanations do not execute the user's terminal", () => {
  for (const prompt of ["¿Qué es la RAM?", "explica cómo funciona una GPU", "diferencias entre SSD y NVMe"]) {
    assert.equal(systemInfoActionForPrompt(prompt), null, prompt);
  }
});

test("obsolete Windows storage commands are replaced", () => {
  const action = normalizeTerminalAction("¿Cuánto espacio libre tiene mi PC?", {
    command: "wmic logicaldisk get caption,size,freespace /value",
    purpose: "Consultar discos",
  });
  assert.equal(action.program, "nova-system-info");
  assert.equal(action.command, undefined);
});

test("ordinary project commands remain unchanged", () => {
  const original = { program: "git", args: ["status", "--short"], purpose: "Comprobar cambios" };
  assert.deepEqual(normalizeTerminalAction("comprueba mi proyecto", original), original);
  assert.equal(terminalActionLabel(original), "git status --short");
});

test("detecta una instalación npm aunque el usuario escriba instala con un error", () => {
  assert.deepEqual(packageInstallActionForPrompt("inicia un Node.js e intala la librería lodash"), {
    program: "npm",
    args: ["install", "lodash"],
    purpose: "Instalar lodash en el proyecto Node.js",
  });
});
