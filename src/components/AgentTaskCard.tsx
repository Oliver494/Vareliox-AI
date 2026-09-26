import { Check, ChevronDown, CircleAlert, Clock3, LoaderCircle, Play, ShieldCheck, Square, Terminal } from "lucide-react";
import type { AgentTask, DetectedCommand } from "../types";
import { usePreferences } from "../services/preferences";

type Props = { task: AgentTask; pending?: DetectedCommand | null; busy: boolean; onApprove?: () => void; onApproveTask?: () => void; onReject?: () => void; onStop?: () => void; onResume?: () => void };
export function AgentTaskCard({ task, pending, busy, onApprove, onApproveTask, onReject, onStop, onResume }: Props) {
  const { t } = usePreferences();
  const active = ["analyzing","planning","executing","testing","correcting"].includes(task.state);
  const forceOpen = !!pending || active || task.state === "awaiting_approval" || task.state === "interrupted";
  const label = pending || task.state === "awaiting_approval"
    ? t("Quiere ejecutar un comando", "Wants to run a command")
    : active
      ? t("Ejecutando comandos", "Running commands")
      : task.state === "completed"
        ? t("Ha ejecutado comandos", "Ran commands")
        : task.state === "failed"
          ? t("El comando falló", "Command failed")
          : task.state === "cancelled"
            ? t("Comando cancelado", "Command cancelled")
            : t("Ejecución interrumpida", "Execution interrupted");
  return <section className={`agent-task-card agent-task-card--${task.state}`}>
    <details open={forceOpen || undefined}>
      <summary>
        <span className="agent-task-card__icon">{active ? <LoaderCircle className="spin" size={13} /> : task.state === "completed" ? <Check size={13} /> : ["failed","interrupted"].includes(task.state) ? <CircleAlert size={13} /> : <Terminal size={13} />}</span>
        <strong>{label}</strong>
        {task.durationMs !== undefined && <em><Clock3 size={11} />{(task.durationMs / 1000).toFixed(1)} s</em>}
        <ChevronDown className="agent-task-card__chevron" size={13} />
      </summary>
      <div className="agent-task-card__details">
        {task.command && <code>{task.command}</code>}
        <div className="agent-steps">{task.steps.map((step) => <span key={step.id} className={`is-${step.status}`}>{step.status === "in_progress" ? <LoaderCircle className="spin" size={11} /> : step.status === "completed" ? <Check size={11} /> : step.status === "failed" ? <CircleAlert size={11} /> : <i />}{step.label}</span>)}</div>
        {pending && <div className="agent-approval"><p><ShieldCheck size={13} />{pending.id === "nova-terminal" ? t("Revisa el comando. Se ejecutará con el nivel elegido en Configuración > Terminal.", "Review the command. It will run with the level selected in Settings > Terminal.") : t("Se ejecutará dentro del proyecto y no podrá salir de la carpeta asignada.", "It will run inside the project and cannot leave its assigned folder.")}</p><div><button onClick={onReject} disabled={busy}>{t("Denegar", "Deny")}</button>{onApproveTask && <button onClick={onApproveTask} disabled={busy}>{t("Permitir esta tarea", "Allow for this task")}</button>}<button className="is-primary" onClick={onApprove} disabled={busy}><Play size={12} />{t("Permitir", "Allow")}</button></div></div>}
        {task.output && <div className="agent-task-output"><span>{t("Salida", "Output")}{task.truncated ? t(" · truncada", " · truncated") : ""}</span><pre>{task.output}</pre></div>}
        {task.exitCode !== undefined && <small>{t("Código de salida", "Exit code")}: {task.exitCode ?? "?"}</small>}
        {active && onStop && <footer><button onClick={onStop}><Square size={11} fill="currentColor" />{t("Detener", "Stop")}</button></footer>}
        {task.state === "interrupted" && onResume && <footer><button className="is-primary" onClick={onResume}><Play size={11} />{t("Continuar", "Resume")}</button></footer>}
      </div>
    </details>
  </section>;
}
