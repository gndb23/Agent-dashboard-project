export function slug(s: string): string;
export function usageFromTranscript(file: string): { tokens_in: number; tokens_out: number; cost_usd: number } | null;
export function findAgentFile(dir: string | undefined): { agent_id: string; url?: string; file: string } | null;
export function parseArgs(argv: string[]): { agentId?: string; url?: string };
export function toEvent(
  hook: Record<string, unknown>,
  env?: Record<string, string | undefined>,
  lookup?: (dir: string) => { agent_id: string; url?: string } | null,
): Record<string, any> | null;
