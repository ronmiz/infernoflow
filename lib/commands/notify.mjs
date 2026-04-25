/**
 * infernoflow notify
 *
 * Post capability drift summaries to Slack or Discord.
 * Runs automatically after significant capability changes (via git hook or CI).
 * Can also be triggered manually.
 *
 * Usage:
 *   infernoflow notify                    Auto-detect channel from config
 *   infernoflow notify --slack <url>      Post to Slack webhook URL
 *   infernoflow notify --discord <url>    Post to Discord webhook URL
 *   infernoflow notify --dry-run          Print message without sending
 *   infernoflow notify --json             Machine-readable: { ok, platform, message }
 *   infernoflow notify --on-change        Only notify if capabilities actually changed
 *
 * Config (inferno/notify.json):
 *   { "slack": "https://hooks.slack.com/...", "discord": "https://discord.com/api/webhooks/..." }
 *
 * Or set env vars:
 *   INFERNOFLOW_SLACK_WEBHOOK
 *   INFERNOFLOW_DISCORD_WEBHOOK
 */

import * as fs    from "node:fs";
import * as path  from "node:path";
import * as https from "node:https";
import * as http  from "node:http";
import { spawnSync } from "node:child_process";
import { done, warn, info, bold, cyan, gray, green, red, yellow } from "../ui/output.mjs";

// ── Config ────────────────────────────────────────────────────────────────────

function loadNotifyConfig(infernoDir, args) {
  const configPath = path.join(infernoDir, "notify.json");
  const fileConfig = fs.existsSync(configPath)
    ? (() => { try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; } })()
    : {};

  const slackIdx   = args.indexOf("--slack");
  const discordIdx = args.indexOf("--discord");

  return {
    slack:   slackIdx   !== -1 ? args[slackIdx + 1]   : process.env.INFERNOFLOW_SLACK_WEBHOOK   || fileConfig.slack,
    discord: discordIdx !== -1 ? args[discordIdx + 1] : process.env.INFERNOFLOW_DISCORD_WEBHOOK || fileConfig.discord,
  };
}

// ── Data loading ──────────────────────────────────────────────────────────────

function runJson(cmd, cwd) {
  try {
    const result = spawnSync(process.execPath, [
      path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "..", "bin", "infernoflow.mjs"),
      ...cmd.split(" ").slice(1),
    ], { cwd, encoding: "utf8", timeout: 20_000 });
    const out = result.stdout?.trim();
    if (out) return JSON.parse(out);
  } catch {}
  return null;
}

function buildSummary(checkResult, diffResult, contract) {
  const status  = checkResult?.status || "unknown";
  const caps    = (contract?.capabilities || []).length;
  const version = contract?.policyVersion || "?";
  const project = contract?.policyId || "project";
  const added   = diffResult?.added   || [];
  const removed = diffResult?.removed || [];
  const changed = diffResult?.changed || [];

  return { status, caps, version, project, added, removed, changed };
}

// ── Slack message builder ─────────────────────────────────────────────────────

function buildSlackMessage(summary) {
  const { status, caps, version, project, added, removed, changed } = summary;
  const statusEmoji = status === "ok" ? "✅" : status === "warning" ? "⚠️" : "❌";
  const hasChanges  = added.length || removed.length || changed.length;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `🔥 infernoflow — ${project} v${version}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Status*\n${statusEmoji} ${status.toUpperCase()}` },
        { type: "mrkdwn", text: `*Capabilities*\n${caps} tracked` },
      ],
    },
  ];

  if (hasChanges) {
    const lines = [];
    if (added.length)   lines.push(`✅ *${added.length}* added: ${added.slice(0, 3).join(", ")}${added.length > 3 ? ` +${added.length - 3} more` : ""}`);
    if (removed.length) lines.push(`❌ *${removed.length}* removed: ${removed.slice(0, 3).join(", ")}${removed.length > 3 ? ` +${removed.length - 3} more` : ""}`);
    if (changed.length) lines.push(`📝 *${changed.length}* changed`);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `<https://github.com/ronmiz/infernoflow|infernoflow> · ${new Date().toLocaleString()}` }],
  });

  return { blocks };
}

// ── Discord message builder ───────────────────────────────────────────────────

function buildDiscordMessage(summary) {
  const { status, caps, version, project, added, removed, changed } = summary;
  const color  = status === "ok" ? 0x4ade80 : status === "warning" ? 0xf97316 : 0xf87171;
  const hasChanges = added.length || removed.length || changed.length;

  const fields = [
    { name: "Status",       value: status.toUpperCase(), inline: true },
    { name: "Capabilities", value: String(caps),         inline: true },
    { name: "Version",      value: `v${version}`,        inline: true },
  ];

  if (added.length)   fields.push({ name: "✅ Added",   value: added.slice(0,5).join(", ") + (added.length > 5 ? ` +${added.length-5}` : ""),   inline: false });
  if (removed.length) fields.push({ name: "❌ Removed", value: removed.slice(0,5).join(", ") + (removed.length > 5 ? ` +${removed.length-5}` : ""), inline: false });

  return {
    embeds: [{
      title:       `🔥 infernoflow — ${project}`,
      description: hasChanges ? "Capability changes detected" : "Contract healthy",
      color,
      fields,
      footer:      { text: "infernoflow · " + new Date().toLocaleString() },
      url:         "https://github.com/ronmiz/infernoflow",
    }],
  };
}

// ── HTTP post ─────────────────────────────────────────────────────────────────

function postWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib     = isHttps ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ""),
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "User-Agent": "infernoflow-cli" },
    }, (res) => {
      let data = "";
      res.on("data", d => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function notifyCommand(rawArgs) {
  const args       = rawArgs.slice(1);
  const jsonMode   = args.includes("--json");
  const dryRun     = args.includes("--dry-run");
  const onlyChange = args.includes("--on-change");
  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  if (!fs.existsSync(infernoDir)) {
    const msg = "inferno/ not found. Run: infernoflow init";
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); } else { warn(msg); }
    process.exit(1);
  }

  const config = loadNotifyConfig(infernoDir, args);

  if (!config.slack && !config.discord) {
    const msg = "No webhook configured. Use --slack <url>, --discord <url>, or set INFERNOFLOW_SLACK_WEBHOOK / INFERNOFLOW_DISCORD_WEBHOOK.";
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); } else { warn(msg); }
    if (!jsonMode) {
      console.log();
      console.log(`  ${gray("To configure permanently, create inferno/notify.json:")}`);
      console.log(`  ${cyan('{ "slack": "https://hooks.slack.com/...", "discord": "https://discord.com/api/webhooks/..." }')}`);
      console.log();
    }
    process.exit(1);
  }

  // Load data
  const contract    = (() => {
    for (const f of ["contract.json", "capabilities.json"]) {
      const p = path.join(infernoDir, f);
      if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch {} }
    }
    return {};
  })();
  const checkResult = runJson("check --json", cwd);
  const diffResult  = runJson("diff --json", cwd);
  const summary     = buildSummary(checkResult, diffResult, contract);

  // --on-change: skip if nothing changed
  if (onlyChange && !summary.added.length && !summary.removed.length && !summary.changed.length) {
    if (jsonMode) { console.log(JSON.stringify({ ok: true, skipped: true, reason: "no capability changes" })); }
    else { info("No capability changes — skipping notification."); }
    return;
  }

  const results = [];

  // Slack
  if (config.slack) {
    const payload = buildSlackMessage(summary);
    if (dryRun) {
      if (!jsonMode) { info("Slack payload (dry run):"); console.log(JSON.stringify(payload, null, 2)); }
      results.push({ platform: "slack", ok: true, dryRun: true });
    } else {
      try {
        const resp = await postWebhook(config.slack, payload);
        const ok   = resp.status >= 200 && resp.status < 300;
        if (!jsonMode) { ok ? done("Slack notification sent") : warn(`Slack returned ${resp.status}`); }
        results.push({ platform: "slack", ok, status: resp.status });
      } catch (err) {
        if (!jsonMode) warn(`Slack failed: ${err.message}`);
        results.push({ platform: "slack", ok: false, error: err.message });
      }
    }
  }

  // Discord
  if (config.discord) {
    const payload = buildDiscordMessage(summary);
    if (dryRun) {
      if (!jsonMode) { info("Discord payload (dry run):"); console.log(JSON.stringify(payload, null, 2)); }
      results.push({ platform: "discord", ok: true, dryRun: true });
    } else {
      try {
        const resp = await postWebhook(config.discord, payload);
        const ok   = resp.status >= 200 && resp.status < 300;
        if (!jsonMode) { ok ? done("Discord notification sent") : warn(`Discord returned ${resp.status}`); }
        results.push({ platform: "discord", ok, status: resp.status });
      } catch (err) {
        if (!jsonMode) warn(`Discord failed: ${err.message}`);
        results.push({ platform: "discord", ok: false, error: err.message });
      }
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ ok: results.every(r => r.ok), results, summary }));
  }
}
