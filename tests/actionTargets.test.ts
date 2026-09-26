import assert from "node:assert/strict";
import test from "node:test";
import { ensureNodeProjectActions, normalizeCreatedFolderContents, requestedFilesystemPath, resolveRequestedActionTarget, resolveRequestedTerminalTarget } from "../src/services/actionTargets.ts";
import { proposedActions } from "../src/services/actionProtocol.ts";
import { packageInstallActionForPrompt } from "../src/services/terminalAgent.ts";

const actions = [
  { type: "mkdir" as const, path: "test-agente" },
  { type: "write" as const, path: "test-agente/info.txt", content: "Hola Mundo" },
];

test("detecta rutas absolutas de Windows y Linux", () => {
  assert.equal(requestedFilesystemPath("crea algo en C:\\Users\\Usuario\\Downloads"), "C:\\Users\\Usuario\\Downloads");
  assert.equal(requestedFilesystemPath("crea algo en C:\\Users\\Usuario\\Downloads que se llame test-agent2 y luego instala lodash"), "C:\\Users\\Usuario\\Downloads");
  assert.equal(requestedFilesystemPath("create it in '/home/kali/My Project'"), "/home/kali/My Project");
});

test("convierte una ruta de Windows a la unidad autorizada sin escribir en el proyecto", () => {
  const result = resolveRequestedActionTarget(
    "hazlo en C:\\Users\\Usuario\\Downloads",
    actions,
    "C:\\Github\\vareliox",
    [{ id: "computer-c", path: "C:\\", name: "Unidad C:", access: "write" }],
  );
  assert.equal(result.unauthorizedPath, null);
  assert.deepEqual(result.actions, [
    { type: "mkdir", path: "Users/Usuario/Downloads/test-agente", rootId: "computer-c" },
    { type: "write", path: "Users/Usuario/Downloads/test-agente/info.txt", content: "Hola Mundo", rootId: "computer-c" },
  ]);
});

test("usa una carpeta adicional como raíz y evita prefijos duplicados", () => {
  const result = resolveRequestedActionTarget(
    "hazlo en C:\\Users\\Usuario\\Downloads",
    actions,
    "C:\\Github\\vareliox",
    [{ id: "downloads", path: "C:\\Users\\Usuario\\Downloads", name: "Downloads", access: "write" }],
  );
  assert.deepEqual(result.actions, [
    { type: "mkdir", path: "test-agente", rootId: "downloads" },
    { type: "write", path: "test-agente/info.txt", content: "Hola Mundo", rootId: "downloads" },
  ]);
});

test("bloquea una ruta externa que no fue autorizada", () => {
  const result = resolveRequestedActionTarget("crea algo en D:\\Privado", actions, "C:\\Github\\vareliox", []);
  assert.equal(result.unauthorizedPath, "D:\\Privado");
  assert.deepEqual(result.actions, []);
});

test("coloca un archivo simple dentro de la única carpeta cuando el usuario lo pidió", () => {
  const malformed = [
    { type: "mkdir" as const, path: "test-agente" },
    { type: "write" as const, path: "info.txt", content: "Hola Mundo" },
  ];
  assert.deepEqual(normalizeCreatedFolderContents(malformed, "hazlo en C:\\Users\\Usuario\\Downloads", [
    { role: "user", content: "crea una carpeta test-agente, entra en ella y crea info.txt" },
  ]), actions);
});

test("trata una ruta absoluta de archivo como destino exacto", () => {
  const result = resolveRequestedActionTarget(
    "actualiza C:\\Users\\Usuario\\Downloads\\info.txt",
    [{ type: "write", path: "info.txt", content: "nuevo" }],
    "C:\\Github\\vareliox",
    [{ id: "computer-c", path: "C:\\", name: "Unidad C:", access: "write" }],
  );
  assert.deepEqual(result.actions, [
    { type: "write", path: "Users/Usuario/Downloads/info.txt", content: "nuevo", rootId: "computer-c" },
  ]);
});

test("repara un proyecto Node y prepara npm dentro de la carpeta creada", () => {
  const planned = ensureNodeProjectActions(
    "crea test-agent2, inicia un Node.js e intala la librería lodash",
    [
      { type: "mkdir", path: "test-agent2" },
      { type: "write", path: "package.json", content: "{}" },
      { type: "mkdir", path: "node_modules/lodash" },
    ],
  );
  assert.equal(planned.some((item) => item.path.includes("node_modules")), false);
  const nested = normalizeCreatedFolderContents(planned, "entra en ella", []);
  const files = resolveRequestedActionTarget(
    "hazlo en C:\\Users\\Usuario\\Downloads",
    nested,
    "C:\\Github\\vareliox",
    [{ id: "computer-c", path: "C:\\", name: "Unidad C:", access: "write" }],
  ).actions;
  const terminal = resolveRequestedTerminalTarget(
    "hazlo en C:\\Users\\Usuario\\Downloads",
    { program: "npm", args: ["install", "lodash"] },
    "C:\\Github\\vareliox",
    [{ id: "computer-c", path: "C:\\", name: "Unidad C:", access: "write" }],
    files,
  );
  assert.equal(terminal.unauthorizedPath, null);
  assert.deepEqual(terminal.action, { program: "npm", args: ["install", "lodash"], rootId: "computer-c", cwd: "Users/Usuario/Downloads/test-agent2" });
});

test("procesa la respuesta real de Gemini para la tarea completa sin duplicar la ruta", () => {
  const prompt = "creame otra carpeta hay en C:\\Users\\Usuario\\Downloads que se llame test-agent2 y debe tener esto inicia hay un Node.js e intala la libreria lodash";
  const geminiResponse = `Hola, voy a crear la carpeta e inicializar Node.js.
<nova_actions>{"actions":[
  {"type":"mkdir","rootId":"computer-c","path":"Users/Usuario/Downloads/test-agent2"},
  {"type":"write","rootId":"computer-c","path":"Users/Usuario/Downloads/test-agent2/package.json","content":"{\\n  \\"name\\": \\"test-agent2\\",\\n  \\"version\\": \\"1.0.0\\"\\n}"}
]}</nova_actions>`;
  const repaired = ensureNodeProjectActions(prompt, proposedActions(geminiResponse));
  const files = resolveRequestedActionTarget(
    prompt,
    repaired,
    "C:\\aprender",
    [{ id: "computer-c", path: "C:\\", name: "Unidad C:", access: "write" }],
  );
  assert.equal(files.unauthorizedPath, null);
  assert.deepEqual(files.actions.map((item) => item.path), [
    "Users/Usuario/Downloads/test-agent2",
    "Users/Usuario/Downloads/test-agent2/package.json",
  ]);
  const install = packageInstallActionForPrompt(prompt);
  assert.ok(install);
  const terminal = resolveRequestedTerminalTarget(
    prompt,
    install,
    "C:\\aprender",
    [{ id: "computer-c", path: "C:\\", name: "Unidad C:", access: "write" }],
    files.actions,
  );
  assert.deepEqual(terminal.action, {
    program: "npm",
    args: ["install", "lodash"],
    purpose: "Instalar lodash en el proyecto Node.js",
    rootId: "computer-c",
    cwd: "Users/Usuario/Downloads/test-agent2",
  });
});
