"use strict";
// 麦客达财务记账工作台 —— 共享后端（单一数据源，落盘/持久化）
// 零依赖 Node.js HTTP 服务：托管前端 + 提供 REST API
// 存储策略：设置了 DATABASE_URL 则用 Postgres（Render 上持久化）；否则用本地 JSON 文件兜底
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const STORE = path.join(DATA, "store.json");
const SEEDFILE = path.join(ROOT, "seed.json");
const PORT = parseInt(process.env.PORT || "3000", 10);
const USE_PG = !!process.env.DATABASE_URL;

const SEED = [
  { 科目名称: "工资", 方向: "收入", 说明: "月度薪资" },
  { 科目名称: "餐饮", 方向: "支出", 说明: "就餐" },
  { 科目名称: "交通", 方向: "支出", 说明: "出行" },
  { 科目名称: "住宿", 方向: "支出", 说明: "酒店/租房" },
  { 科目名称: "办公", 方向: "支出", 说明: "耗材" },
  { 科目名称: "通讯", 方向: "支出", 说明: "话费网络" },
  { 科目名称: "营销", 方向: "支出", 说明: "推广" },
  { 科目名称: "其他收入", 方向: "收入", 说明: "" },
  { 科目名称: "其他支出", 方向: "支出", 说明: "" },
];
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---------- 本地 JSON 兜底 ----------
function jsonLoad() { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch (e) { return null; } }
function jsonSave(s) {
  fs.mkdirSync(DATA, { recursive: true });
  const t = STORE + ".tmp";
  fs.writeFileSync(t, JSON.stringify(s, null, 2));
  fs.renameSync(t, STORE); // 原子写，避免半截文件
}

// ---------- Postgres 存储 ----------
let pg = null, pgc = null;
async function pgInit() {
  pg = require("pg");
  pgc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pgc.connect();
  await pgc.query(`CREATE TABLE IF NOT EXISTS subjects(_id TEXT PRIMARY KEY,"科目名称" TEXT,"方向" TEXT,"说明" TEXT,created_at BIGINT)`);
  await pgc.query(`CREATE TABLE IF NOT EXISTS ledger(_id TEXT PRIMARY KEY,"日期" TEXT,"摘要" TEXT,"科目" TEXT,"收支类型" TEXT,"金额" NUMERIC,"账户" TEXT,"经手人" TEXT,created_at BIGINT)`);
  // 首次启动：把 seed.json（44 科目 + 历史凭证）灌入空库，保证历史不丢
  const cnt = await pgc.query('SELECT COUNT(*)::int AS c FROM subjects');
  if (cnt.rows[0].c === 0 && fs.existsSync(SEEDFILE)) {
    const seed = JSON.parse(fs.readFileSync(SEEDFILE, "utf8"));
    for (const s of seed.subjects) {
      await pgc.query('INSERT INTO subjects(_id,"科目名称","方向","说明",created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [s._id || uid("s"), s.科目名称, s.方向, s.说明 || "", s.createdAt || Date.now()]);
    }
    for (const r of seed.ledger) {
      await pgc.query('INSERT INTO ledger(_id,"日期","摘要","科目","收支类型","金额","账户","经手人",created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
        [r._id || uid("l"), r.日期, r.摘要 || "", r.科目, r.收支类型 || "支出", r.金额 || 0, r.账户 || "", r.经手人 || "", r.createdAt || Date.now()]);
    }
    console.log("已从 seed.json 灌入", seed.subjects.length, "个科目 /", seed.ledger.length, "笔凭证");
  }
}
async function pgState() {
  const s = await pgc.query('SELECT * FROM subjects ORDER BY created_at ASC');
  const l = await pgc.query('SELECT * FROM ledger ORDER BY created_at ASC');
  return {
    subjects: s.rows.map(r => ({ _id: r._id, 科目名称: r["科目名称"], 方向: r["方向"], 说明: r["说明"], createdAt: r.created_at })),
    ledger: l.rows.map(r => ({ _id: r._id, 日期: r["日期"], 摘要: r["摘要"], 科目: r["科目"], 收支类型: r["收支类型"], 金额: Number(r["金额"]), 账户: r["账户"], 经手人: r["经手人"], createdAt: r.created_at })),
    updatedAt: Date.now(),
  };
}
async function pgAddLedger(b) {
  const rec = { _id: uid("l"), createdAt: Date.now(), 日期: b.日期 || "", 摘要: b.摘要 || "", 科目: b.科目 || "", 收支类型: b.收支类型 || "支出", 金额: Number(b.金额) || 0, 账户: b.账户 || "", 经手人: b.经手人 || "" };
  await pgc.query('INSERT INTO ledger(_id,"日期","摘要","科目","收支类型","金额","账户","经手人",created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [rec._id, rec.日期, rec.摘要, rec.科目, rec.收支类型, rec.金额, rec.账户, rec.经手人, rec.createdAt]);
  return rec;
}
async function pgDelLedger(id) {
  const r = await pgc.query('DELETE FROM ledger WHERE _id=$1', [id]);
  return r.rowCount > 0;
}
async function pgAddSubject(b) {
  const name = (b.科目名称 || "").trim();
  const exist = await pgc.query('SELECT 1 FROM subjects WHERE "科目名称"=$1', [name]);
  if (exist.rows.length) return { conflict: true };
  const s = { _id: uid("s"), 科目名称: name, 方向: b.方向 || "支出", 说明: b.说明 || "", createdAt: Date.now() };
  await pgc.query('INSERT INTO subjects(_id,"科目名称","方向","说明",created_at) VALUES($1,$2,$3,$4,$5)', [s._id, s.科目名称, s.方向, s.说明, s.createdAt]);
  return { rec: s };
}
async function pgDelSubject(id) {
  const r = await pgc.query('DELETE FROM subjects WHERE _id=$1', [id]);
  return r.rowCount > 0;
}
async function pgClear(target) {
  if (target === "all" || target === "ledger") await pgc.query('DELETE FROM ledger');
  if (target === "all" || target === "subjects") await pgc.query('DELETE FROM subjects');
}

// ---------- 本地 JSON 状态 ----------
let jsonState = null;
function ensureJson() {
  if (jsonState) return;
  jsonState = jsonLoad();
  if (!jsonState || !Array.isArray(jsonState.subjects) || !Array.isArray(jsonState.ledger)) {
    jsonState = {
      subjects: SEED.map(s => ({ _id: uid("s"), 科目名称: s.科目名称, 方向: s.方向, 说明: s.说明, createdAt: Date.now() })),
      ledger: [], updatedAt: Date.now(),
    };
    jsonSave(jsonState);
  }
}

// ---------- 统一数据接口 ----------
async function getState() {
  if (USE_PG) return pgState();
  ensureJson(); return Object.assign({}, jsonState, { updatedAt: Date.now() });
}
async function addLedger(b) {
  if (USE_PG) return pgAddLedger(b);
  ensureJson();
  const rec = { _id: uid("l"), createdAt: Date.now(), 日期: b.日期 || "", 摘要: b.摘要 || "", 科目: b.科目 || "", 收支类型: b.收支类型 || "支出", 金额: Number(b.金额) || 0, 账户: b.账户 || "", 经手人: b.经手人 || "" };
  if (!rec.科目 || !rec.日期) throw { code: 400, msg: "科目与日期必填" };
  jsonState.ledger.push(rec); jsonSave(jsonState); return rec;
}
async function delLedger(id) {
  if (USE_PG) return pgDelLedger(id);
  ensureJson(); const before = jsonState.ledger.length;
  jsonState.ledger = jsonState.ledger.filter(r => r._id !== id);
  if (jsonState.ledger.length === before) return false; jsonSave(jsonState); return true;
}
async function addSubject(b) {
  if (USE_PG) { const r = await pgAddSubject(b); if (r.conflict) return { conflict: true }; return { rec: r.rec }; }
  ensureJson(); const name = (b.科目名称 || "").trim();
  if (!name) throw { code: 400, msg: "科目名称必填" };
  if (jsonState.subjects.some(s => s.科目名称 === name)) throw { code: 409, msg: "科目已存在" };
  const s = { _id: uid("s"), 科目名称: name, 方向: b.方向 || "支出", 说明: b.说明 || "", createdAt: Date.now() };
  jsonState.subjects.push(s); jsonSave(jsonState); return { rec: s };
}
async function delSubject(id) {
  if (USE_PG) return pgDelSubject(id);
  ensureJson(); const before = jsonState.subjects.length;
  jsonState.subjects = jsonState.subjects.filter(x => x._id !== id);
  if (jsonState.subjects.length === before) return false; jsonSave(jsonState); return true;
}
async function clearAll(target) {
  if (USE_PG) return pgClear(target);
  ensureJson();
  if (target === "all" || target === "ledger") jsonState.ledger = [];
  if (target === "all" || target === "subjects") jsonState.subjects = [];
  jsonSave(jsonState); return { ok: true };
}

// ---------- 工具 ----------
const MIME = { html: "text/html; charset=utf-8", js: "application/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", ico: "image/x-icon" };
function sendJSON(res, code, obj, extra) {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extra || {}));
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ""; req.on("data", d => (b += d));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

// ---------- 服务 ----------
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = (req.url || "/").split("?")[0];
  try {
    if (url.startsWith("/api/")) {
      if (url === "/api/state" && req.method === "GET") return sendJSON(res, 200, await getState());
      if (url === "/api/ledger" && req.method === "POST") {
        const b = await readBody(req);
        try { return sendJSON(res, 200, await addLedger(b)); }
        catch (e) { return sendJSON(res, e.code || 500, { error: e.msg || String(e) }); }
      }
      if (url.startsWith("/api/ledger/") && req.method === "DELETE") {
        const ok = await delLedger(url.split("/")[3]);
        return ok ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: "not found" });
      }
      if (url === "/api/subjects" && req.method === "POST") {
        const b = await readBody(req);
        const r = await addSubject(b);
        if (r.conflict) return sendJSON(res, 409, { error: "科目已存在" });
        return sendJSON(res, 200, r.rec);
      }
      if (url.startsWith("/api/subjects/") && req.method === "DELETE") {
        const ok = await delSubject(url.split("/")[3]);
        return ok ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: "not found" });
      }
      if (url === "/api/clear" && req.method === "POST") {
        const b = await readBody(req);
        return sendJSON(res, 200, await clearAll(b.target || "all"));
      }
      return sendJSON(res, 404, { error: "not found" });
    }
    // 静态前端
    let rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
    let fp = path.join(PUBLIC, rel);
    if (!fp.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
    fs.readFile(fp, (err, data) => {
      if (err) {
        fs.readFile(path.join(PUBLIC, "index.html"), (e2, d2) => {
          if (e2) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("not found"); }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(d2);
        });
        return;
      }
      const ext = path.extname(fp).slice(1).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" }); res.end(data);
    });
  } catch (e) {
    sendJSON(res, 500, { error: String((e && e.message) || e) });
  }
});

(async function boot() {
  if (USE_PG) {
    try { await pgInit(); console.log("存储后端: Postgres (DATABASE_URL 已连接)"); }
    catch (e) { console.error("Postgres 连接失败，无法启动:", e.message); process.exit(1); }
  } else {
    ensureJson(); console.log("存储后端: 本地 JSON 文件 (data/store.json)");
  }
  server.listen(PORT, () => console.log("麦客达记账后端已启动: http://localhost:" + PORT));
})();
