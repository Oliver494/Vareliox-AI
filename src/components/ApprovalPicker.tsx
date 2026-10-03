import { Check, ChevronDown, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../services/preferences";
import type { Conversation } from "../types";

type ApprovalMode = Conversation["approvalMode"];
type Props = { value: ApprovalMode; onChange: (mode: ApprovalMode) => void };

export function ApprovalPicker({ value, onChange }: Props) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); button.current?.focus(); }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    const frame = requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const options = [
    { id: "ask", label: t("Solicitar aprobación", "Ask for approval"), Icon: ShieldQuestion },
    { id: "auto", label: t("Aprobar por mí", "Approve for me"), Icon: ShieldCheck },
    { id: "full", label: t("Acceso completo", "Full access"), Icon: ShieldAlert },
  ] as const;
  const current = options.find((option) => option.id === value) ?? options[0];
  const CurrentIcon = current.Icon;

  return <div className={`approval-picker approval-picker--${value}`} ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={button} type="button" className="approval-picker__trigger" aria-haspopup="menu" aria-expanded={open} aria-label={t("Permisos de la conversación", "Conversation permissions")} onClick={() => setOpen((shown) => !shown)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
      <CurrentIcon size={16} aria-hidden="true" /><span>{current.label}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div ref={menu} className="approval-picker__menu" role="menu" aria-label={t("Permisos de la conversación", "Conversation permissions")} onKeyDown={(event) => {
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      {options.map(({ id, label, Icon }) => <button key={id} type="button" role="menuitemradio" aria-checked={value === id} className={`approval-picker__option approval-picker__option--${id}${value === id ? " is-selected" : ""}`} onClick={() => { onChange(id); setOpen(false); button.current?.focus(); }}><Icon size={17} aria-hidden="true" /><span>{label}</span>{value === id && <Check size={15} aria-hidden="true" />}</button>)}
    </div>}
  </div>;
}
