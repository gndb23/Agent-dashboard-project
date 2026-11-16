export function slug(s: string): string;
export function usageFromTranscript(file: string): { tokens_in: number; tokens_out: number; cost_usd: number } | null;
export function toEvent(hook: Record<string, unknown>, env?: Record<string, string | undefined>): Record<string, any> | null;
