// Bunny — envia notificações de vencimentos (todo dia de manhã) e o "teste" do app.
import { createClient } from "npm:@supabase/supabase-js@2.48.1";
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
const APP_URL = "https://isabruapp.isabru-app.workers.dev/app/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---------- datas no fuso de São Paulo ----------
function todaySP(): Date {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const clamp = (y: number, m: number, day: number) => { const f = new Date(Date.UTC(y, m, 1)); return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), Math.min(day, daysIn(f.getUTCFullYear(), f.getUTCMonth())))); };
const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
function nextOcc(dateStr: string, repeat: string, t: Date): Date {
  const base = parse(dateStr);
  if (repeat === "none" || base >= t) return base;
  if (repeat === "weekly") return addDays(base, Math.ceil((t.getTime() - base.getTime()) / (7 * 864e5)) * 7);
  for (let i = 1; i < 1200; i++) {
    const d = repeat === "monthly" ? clamp(base.getUTCFullYear(), base.getUTCMonth() + i, base.getUTCDate()) : clamp(base.getUTCFullYear() + i, base.getUTCMonth(), base.getUTCDate());
    if (d >= t) return d;
  }
  return base;
}
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Msg = { key: string; title: string; body: string; url: string };

async function buildMessages(): Promise<Record<string, Msg[]>> {
  const t = todaySP();
  const tomorrow = addDays(t, 1);
  const ms = iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)));
  const me = iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)));
  const [{ data: recs }, { data: txs }, { data: rems }, { data: chores }] = await Promise.all([
    admin.from("recurring").select("*").eq("active", true),
    admin.from("transactions").select("recurring_id,household_id").gte("date", ms).lte("date", me).not("recurring_id", "is", null),
    admin.from("reminders").select("*"),
    admin.from("chores").select("*").eq("done", false),
  ]);
  const paid = new Set((txs || []).map((x) => x.recurring_id));
  const out: Record<string, Msg[]> = {};
  const push = (h: string, m: Msg) => (out[h] ||= []).push(m);

  for (const r of recs || []) {
    if (paid.has(r.id)) continue;
    const due = clamp(t.getUTCFullYear(), t.getUTCMonth(), r.day);
    const isToday = iso(due) === iso(t), isTomorrow = iso(due) === iso(tomorrow);
    if (!isToday && !isTomorrow) continue;
    const verb = r.kind === "income" ? "Cai hoje" : "Vence hoje";
    push(r.household_id, {
      key: `rec:${r.id}:${iso(due)}:${isToday ? "d0" : "d1"}`,
      title: isToday ? `${verb}: ${r.name}` : `Amanhã: ${r.name}`,
      body: `${brl(r.amount)}${r.kind === "income" ? " de entrada" : " pra pagar"}${isToday ? "" : " amanhã"}. Toque pra marcar como ${r.kind === "income" ? "recebido" : "pago"}.`,
      url: APP_URL + "#/fixos",
    });
  }
  for (const r of rems || []) {
    const d = nextOcc(r.date, r.repeat, t);
    const isToday = iso(d) === iso(t), isTomorrow = iso(d) === iso(tomorrow);
    if (!isToday && !isTomorrow) continue;
    push(r.household_id, {
      key: `rem:${r.id}:${iso(d)}:${isToday ? "d0" : "d1"}`,
      title: isToday ? `Hoje: ${r.title}` : `Amanhã: ${r.title}`,
      body: r.notes || "Lembrete da casa",
      url: APP_URL + "#/lembretes",
    });
  }
  for (const c of chores || []) {
    if (!c.due || c.due !== iso(t)) continue;
    push(c.household_id, { key: `chore:${c.id}:${c.due}`, title: `Tarefa de hoje: ${c.title}`, body: "Toque pra marcar como feita.", url: APP_URL + "#/tarefas" });
  }
  return out;
}

async function sendTo(subs: any[], msg: Msg) {
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 60 * 60 * 12 });
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("push falhou", e?.statusCode, e?.body);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { data: cfg, error } = await admin.rpc("bunny_push_config");
  if (error || !cfg?.private) return json({ error: "config" }, 500);
  webpush.setVapidDetails("mailto:bunny@isabru.app", cfg.public, cfg.private);
  const body = await req.json().catch(() => ({}));

  // Teste: usuário logado pede uma notificação pros próprios aparelhos
  if (body.action === "test") {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "auth" }, 401);
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", u.user.id);
    const sent = await sendTo(subs || [], { key: "test", title: "Bunny 🐰", body: "Notificações ligadas! Vou te avisar dos vencimentos.", url: APP_URL });
    return json({ sent });
  }

  // Rotina diária: só com a chave do agendador
  if (req.headers.get("x-cron-key") !== cfg.cron) return json({ error: "forbidden" }, 403);
  const byHouse = await buildMessages();
  let total = 0;
  for (const [hid, msgs] of Object.entries(byHouse)) {
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("household_id", hid);
    if (!subs?.length) continue;
    for (const m of msgs) {
      const key = `${hid}:${m.key}`;
      const { error: dup } = await admin.from("push_log").insert({ key });
      if (dup) continue; // já avisado
      total += await sendTo(subs, m);
    }
  }
  return json({ ok: true, sent: total });
});
