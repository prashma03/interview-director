export interface MonitoringPolicy {
  enabled: boolean;
  label: string;
  explanation: string;
}

export function monitoringPolicy(focusAssist: boolean): MonitoringPolicy {
  return focusAssist
    ? { enabled: false, label: "Focus Assist", explanation: "Attention monitoring is paused. This accommodation does not affect evidence scoring." }
    : { enabled: true, label: "Standard monitoring", explanation: "Only tab visibility, window focus, and paste events are recorded; they are not proof of misconduct." };
}
