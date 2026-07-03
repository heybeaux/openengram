/**
 * Webhook Relay — Supabase Edge Function
 *
 * Receives webhooks from Railway and GitHub, formats them,
 * and posts to Discord via the Bot API.
 *
 * ## Deploy
 *   supabase secrets set DISCORD_BOT_TOKEN=<bot-token>
 *   supabase secrets set DISCORD_RAILWAY_CHANNEL_ID=1474416306563584060
 *   supabase secrets set DISCORD_CI_CHANNEL_ID=1474067664207872156
 *   supabase functions deploy webhook-relay
 */

const DISCORD_API = "https://discord.com/api/v10";

function env(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

async function postToDiscord(channelId: string, content: string): Promise<Response> {
  const token = env("DISCORD_BOT_TOKEN");
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Discord API error ${res.status}: ${body}`);
    throw new Error(`Discord API ${res.status}`);
  }
  return res;
}

// --- Railway ---

function formatRailway(payload: Record<string, unknown>): string {
  // Railway webhook payloads vary. Try multiple extraction strategies.

  // Strategy 1: Discord embed format (if someone sends pre-formatted)
  if (payload.embeds && Array.isArray(payload.embeds) && payload.embeds.length > 0) {
    const embed = payload.embeds[0] as Record<string, unknown>;
    const title = (embed.title as string) || "Unknown Event";
    const description = (embed.description as string) || "";
    const fields = (embed.fields as Array<{ name: string; value: string }>) || [];
    const fieldMap: Record<string, string> = {};
    for (const f of fields) fieldMap[f.name] = f.value;

    const service = description || "unknown";
    const project = fieldMap["Project"] || "unknown";
    const environment = fieldMap["Environment"] || "unknown";
    const status = fieldMap["Status"] || "unknown";
    const logs = fieldMap["Logs"] || "";

    let msg = `🚨 **${title}** | **${service}**\n**Project:** ${project}\n**Environment:** ${environment}\n**Status:** ${status}`;
    if (logs) msg += `\n**Logs:** ${logs}`;
    return msg;
  }

  // Strategy 2: Raw Railway webhook payload
  // Railway sends: { type, timestamp, project: {name}, service: {name}, environment: {name}, deployment: {id, status, meta}, ... }
  // Also might be nested differently or use different key names
  const p = payload as any;
  
  const type = p.type || p.event || p.eventType || "unknown";
  const projectName = p.project?.name || p.projectName || "unknown";
  const serviceName = p.service?.name || p.serviceName || p.deployment?.serviceName || "";
  const envName = p.environment?.name || p.environmentName || p.deployment?.environment || "unknown";
  const status = p.deployment?.status || p.status || p.deployment?.meta?.status || "unknown";
  const logsUrl = p.deployment?.logsUrl || p.logsUrl || p.deployment?.meta?.logsUrl || "";

  // Map Railway event types to emoji
  const emoji = type.toLowerCase().includes("crash") ? "💥" :
                type.toLowerCase().includes("fail") ? "🔴" :
                type.toLowerCase().includes("oom") ? "💀" :
                type.toLowerCase().includes("success") ? "✅" : "🚨";

  let msg = `${emoji} **Railway: ${type}**`;
  if (serviceName) msg += ` | **${serviceName}**`;
  msg += `\n**Project:** ${projectName}\n**Environment:** ${envName}\n**Status:** ${status}`;
  if (logsUrl) msg += `\n**Logs:** ${logsUrl}`;

  // If we got mostly "unknown", dump a summary of top-level keys for debugging
  if (projectName === "unknown" && serviceName === "" && envName === "unknown") {
    const keys = Object.keys(payload).join(", ");
    msg += `\n\n_Debug: payload keys: ${keys}_`;
    // Also include a truncated JSON dump
    const dump = JSON.stringify(payload).slice(0, 500);
    msg += `\n_Raw: ${dump}_`;
  }

  return msg;
}

// --- GitHub ---

function formatGitHub(payload: Record<string, unknown>): string | null {
  const action = payload.action as string;
  const wr = payload.workflow_run as Record<string, unknown> | undefined;
  if (!wr) return null;

  // Only post on failure
  if (wr.conclusion !== "failure") return null;

  const repo = (payload.repository as Record<string, unknown>)?.full_name || "unknown";
  const repoShort = (repo as string).split("/").pop();
  const branch = wr.head_branch || "unknown";
  const sha = ((wr.head_sha as string) || "").slice(0, 7);
  const name = wr.name || "CI";
  const url = wr.html_url || "";

  return `🔴 **CI Failed** | **${repoShort}** | Branch: \`${branch}\` | Commit: \`${sha}\`\nWorkflow: ${name}\nRun: ${url}`;
}

// --- Handler ---

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", fn: "webhook-relay" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  const source = url.searchParams.get("source");
  if (!source || !["railway", "github"].includes(source)) {
    return new Response(JSON.stringify({ error: "unknown source", hint: "use ?source=railway or ?source=github" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  console.log(`[webhook-relay] source=${source} payload=`, JSON.stringify(payload).slice(0, 2000));

  try {
    if (source === "railway") {
      const msg = formatRailway(payload);
      const channelId = env("DISCORD_RAILWAY_CHANNEL_ID");
      await postToDiscord(channelId, msg);
      return new Response(JSON.stringify({ ok: true, source, posted: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (source === "github") {
      const msg = formatGitHub(payload);
      if (!msg) {
        return new Response(JSON.stringify({ ok: true, source, posted: false, reason: "not a failure" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const channelId = env("DISCORD_CI_CHANNEL_ID");
      await postToDiscord(channelId, msg);
      return new Response(JSON.stringify({ ok: true, source, posted: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error(`[webhook-relay] error:`, err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unhandled" }), { status: 500 });
});
