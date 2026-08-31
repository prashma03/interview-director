export type IntegrityEventType = "tab-hidden" | "window-blur" | "paste";
export interface IntegrityEvent { type: IntegrityEventType; at: number; detail: string; }

export function integrityLabel(type: IntegrityEventType): string {
  if (type === "tab-hidden") return "Interview tab hidden";
  if (type === "window-blur") return "Interview window lost focus";
  return "Text pasted into answer";
}

export function summarizeIntegrity(events: IntegrityEvent[]) {
  const hidden = events.filter((event) => event.type === "tab-hidden").length;
  const blur = events.filter((event) => event.type === "window-blur").length;
  const paste = events.filter((event) => event.type === "paste").length;
  return {
    hidden, blur, paste,
    reviewRecommended: hidden >= 2 || paste >= 1,
    statement: events.length === 0 ? "No attention changes were observed." : "Attention signals were observed. They are context for human review, not proof of outside assistance.",
  };
}
