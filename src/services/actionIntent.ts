import type { ChatMessage } from "../types";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const ACTION_VERB = /\b(?:crea(?:r|me|melo|mela|lo|la)?|haz(?:me|melo|mela|lo|la)?|hacer|realiza(?:r|me|melo|mela|lo|la)?|genera(?:r|me|melo|mela|lo|la)?|construye|desarrolla|mejora(?:r|me|melo|mela|lo|la)?|cambia(?:r|me|melo|mela|lo|la)?|adapta(?:r|me|melo|mela|lo|la)?|transforma(?:r|me|melo|mela|lo|la)?|refactoriza(?:r|me|lo|la)?|dibuja(?:r|me|lo|la)?|edita(?:r|me|melo|mela|lo|la)?|modifica(?:r|me|melo|mela|lo|la)?|implementa(?:r|me|melo|mela|lo|la)?|actualiza(?:r|me|melo|mela|lo|la)?|aplica(?:r|me|melo|mela|lo|la)?|guarda(?:r|me|melo|mela|lo|la)?|escribe|escribeme|escribir|inserta(?:r|me|lo|la)?|integra(?:r|me|lo|la)?|sustituye|sustituir|reemplaza(?:r|me|melo|mela|lo|la)?|pega(?:r|me|lo|la)?|pon(?:me|er)?|anade(?:me|lo|la)?|anadir|agrega(?:r|me|melo|mela|lo|la)?|elimina(?:r|me|melo|mela|lo|la)?|borra(?:r|me|melo|mela|lo|la)?|renombra(?:r|me|melo|mela|lo|la)?|mueve|mueveme|mover|arregla(?:r|me|melo|mela|lo|la)?|corrige|corrigeme|corregir|create|make|generate|build|develop|improve|change|adapt|transform|refactor|draw|edit|update|modify|implement|apply|save|write|insert|replace|paste|put|add|delete|remove|rename|move|fix)\b/u;
const ACTION_SUBJUNCTIVE = /\b(?:crees|hagas|realices|generes|construyas|desarrolles|mejores|cambies|adaptes|transformes|refactorices|dibujes|edites|modifiques|implementes|actualices|apliques|guardes|escribas|insertes|integres|sustituyas|reemplaces|pegues|pongas|anadas|agregues|elimines|borres|renombres|muevas|arregles|corrijas)\b/u;

const READ_ONLY_REQUEST = /\b(?:puedes?|podrias?|puedo|ver|leer|muestra|mostrar|explora|explorar|que hay|tienes acceso|can you see|can you read|show|inspect|explain)\b/u;
const INFORMATIONAL_PREFIX = /^(?:como|que|cual|por que|explica|explicame|dime|how|what|which|why)\b/u;
// A previous request may have created a project, but a follow-up asking for
// instructions must stay a chat answer. In particular, words such as "poner"
// and "instalar" are common inside a how-to request and are not themselves a
// request to write a file.
const GUIDANCE_REQUEST = /\b(?:pasos?|instrucciones?|guia|tutorial|documentacion|documenta(?:cion)?|como (?:hago|se|puedo|poner|instalar|usar|ejecutar|configurar)|dame (?:los )?(?:pasos?|instrucciones?|una guia)|ensename|ayudame a (?:usar|poner|instalar|ejecutar|configurar)|how to|walk ?me through|step by step|instructions?|guide|tutorial|documentation)\b/u;
const EXPLICIT_FILE_TARGET = /\b[\w.-]+\.(?:html?|css|m?js|jsx|tsx?|json|md|txt|py|rs|java|go|yml|yaml|toml)\b|\b(?:archivo|file|readme|documento)\b/u;
const CONTINUATION = /^(?:si|hazlo|continua|sigue|adelante|ok|vale|do it|continue|go ahead)[!.\s]*$/u;

function previousActionRequest(history: Pick<ChatMessage, "role" | "content">[]) {
  return [...history].reverse().some((item) => {
    if (item.role !== "user") return false;
    const value = normalize(item.content);
    if (CONTINUATION.test(value)) return false;
    return (ACTION_VERB.test(value) || ACTION_SUBJUNCTIVE.test(value)) && !INFORMATIONAL_PREFIX.test(value);
  });
}

export function requestsProjectAction(prompt: string, history: Pick<ChatMessage, "role" | "content">[]) {
  const current = normalize(prompt).replace(/[¿?]/g, "").trim();

  // Explanatory questions may mention words such as "crear" without asking
  // Vareliox to modify the workspace.
  if (INFORMATIONAL_PREFIX.test(current)) return false;
  // Do not turn a request for setup steps into archivo.txt merely because it
  // contains an action verb. An explicitly named file remains an operation.
  if (GUIDANCE_REQUEST.test(current) && !EXPLICIT_FILE_TARGET.test(current)) return false;
  if (CONTINUATION.test(current)) {
    return previousActionRequest(history);
  }
  if (ACTION_VERB.test(current) || ACTION_SUBJUNCTIVE.test(current)) return true;
  if (READ_ONLY_REQUEST.test(current)) return false;
  return false;
}
