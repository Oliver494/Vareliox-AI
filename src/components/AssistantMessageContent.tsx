import { Check, Clipboard } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { usePreferences } from "../services/preferences";
import type { MediaGenerationResult } from "../types";

type Segment =
  | { type: "text"; value: string }
  | { type: "code"; value: string; language: string };

function splitCodeBlocks(content: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ type: "text", value: content.slice(cursor, start) });
    segments.push({
      type: "code",
      language: match[1].trim() || "Código",
      value: match[2].replace(/\r?\n$/, ""),
    });
    cursor = start + match[0].length;
  }
  if (cursor < content.length) segments.push({ type: "text", value: content.slice(cursor) });
  return segments;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = usePreferences();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return <section className="assistant-code-block">
    <header><span>{language}</span><button type="button" onClick={() => void copy()} aria-label={t("Copiar código", "Copy code")} title={t("Copiar código", "Copy code")}>{copied ? <Check size={13} /> : <Clipboard size={13} />}<span>{copied ? t("Copiado", "Copied") : t("Copiar", "Copy")}</span></button></header>
    <pre><code>{code}</code></pre>
  </section>;
}

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

function inlineMarkdown(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|(https?:\/\/[^\s<]+))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) parts.push(value.slice(cursor, match.index));
    const key = `inline-${index++}`;
    if (match[2] && match[3]) {
      const url = safeLink(match[3]);
      parts.push(url ? <a key={key} href={url} target="_blank" rel="noreferrer">{match[2]}</a> : match[2]);
    } else if (match[4]) {
      parts.push(<code key={key}>{match[4]}</code>);
    } else if (match[5] || match[6]) {
      parts.push(<strong key={key}>{match[5] ?? match[6]}</strong>);
    } else if (match[7] || match[8]) {
      parts.push(<em key={key}>{match[7] ?? match[8]}</em>);
    } else if (match[9]) {
      const url = safeLink(match[9].replace(/[.,;:!?]+$/, ""));
      const trailing = match[9].slice(url?.length ?? match[9].length);
      parts.push(url ? <a key={key} href={url} target="_blank" rel="noreferrer">{url}</a> : match[9]);
      if (trailing) parts.push(trailing);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

function isBlockStart(line: string) {
  return /^\s{0,3}(?:#{1,6}\s+|[-*+•●▪‣]\s+|\d+[.)]\s+|>\s*|---+\s*$)/.test(line);
}

function MarkdownText({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line.trim()) { cursor += 1; continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={`heading-${cursor}`}>{inlineMarkdown(heading[2])}</Tag>);
      cursor += 1;
      continue;
    }
    if (/^\s{0,3}---+\s*$/.test(line)) { blocks.push(<hr key={`rule-${cursor}`} />); cursor += 1; continue; }
    const unordered = line.match(/^\s{0,3}[-*+•●▪‣]\s+(.+)$/);
    const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const entries: ReactNode[] = [];
      const orderedList = !!ordered;
      while (cursor < lines.length) {
        const item = orderedList ? lines[cursor].match(/^\s{0,3}\d+[.)]\s+(.+)$/) : lines[cursor].match(/^\s{0,3}[-*+•●▪‣]\s+(.+)$/);
        if (!item) break;
        entries.push(<li key={`item-${cursor}`}>{inlineMarkdown(item[1])}</li>);
        cursor += 1;
      }
      blocks.push(orderedList ? <ol key={`list-${cursor}`}>{entries}</ol> : <ul key={`list-${cursor}`}>{entries}</ul>);
      continue;
    }
    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) { blocks.push(<blockquote key={`quote-${cursor}`}>{inlineMarkdown(quote[1])}</blockquote>); cursor += 1; continue; }
    const paragraph: string[] = [line];
    cursor += 1;
    while (cursor < lines.length && lines[cursor].trim() && !isBlockStart(lines[cursor])) {
      paragraph.push(lines[cursor]);
      cursor += 1;
    }
    blocks.push(<p key={`paragraph-${cursor}`}>{inlineMarkdown(paragraph.join("\n"))}</p>);
  }
  return <div className="assistant-markdown">{blocks}</div>;
}

export function AssistantMessageContent({ content, media }: { content: string; media?: MediaGenerationResult }) {
  const { t } = usePreferences();
  function download() {
    if (!media) return;
    const link = document.createElement("a");
    link.href = media.dataUrl;
    link.download = `nova-${media.mediaType}-${Date.now()}.${media.mediaType === "video" ? "mp4" : "png"}`;
    link.click();
  }
  return <div className="assistant-message-content">{splitCodeBlocks(content).map((segment, index) => segment.type === "code"
    ? <CodeBlock key={`code-${index}`} code={segment.value} language={segment.language} />
    : segment.value ? <MarkdownText key={`text-${index}`} content={segment.value} /> : null)}{media && <figure className="assistant-generated-media">{media.mediaType === "image" ? <img src={media.dataUrl} alt={t("Imagen creada", "Created image")} /> : <video src={media.dataUrl} controls loop /> }<button type="button" onClick={download}>{t("Descargar", "Download")}</button></figure>}</div>;
}
