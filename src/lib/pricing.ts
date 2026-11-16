/** Rough USD-per-million-token prices used for "est. cost". Keep in sync with integrations/claude-code/hook.mjs. */
const PRICES: [RegExp, number, number][] = [
  [/fable|mythos/, 8, 40],
  [/opus-5-5/, 4, 20],
  [/opus/, 5, 25],
  [/sonnet/, 2, 10],
  [/haiku-5/, 0.1, 0.5],
  [/haiku/, 1, 5],
];

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export function estimateCost(model: string | undefined, u: Usage): number {
  const [, inP, outP] = PRICES.find(([re]) => re.test(model ?? "")) ?? PRICES[1];
  const input = u.input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  return (input * inP + cr * inP * 0.1 + cw * inP * 1.25 + out * outP) / 1e6;
}

export function totalInputTokens(u: Usage): number {
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
}
