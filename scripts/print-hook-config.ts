/**
 * Prints a ready-to-paste `.claude/settings.json` hooks block.
 *   npm run hook-config                 # agent id = project folder name
 *   npm run hook-config -- my-agent-id  # pin an explicit agent id
 */
import { claudeHookSettings } from "../src/lib/hook-config";

const agentId = process.argv[2];
console.log(JSON.stringify(claudeHookSettings({ agentId, url: process.env.AGENT_OPS_URL }), null, 2));
