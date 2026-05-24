import { useState, useEffect, useMemo, useRef } from "react";

const ff = "'Noto Sans TC','DM Mono',monospace";

// ─── Supabase ────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://zbnijokwqjpczhmifzia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpibmlqb2t3cWpwY3pobWlmemlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTQxNjYsImV4cCI6MjA5MzQ3MDE2Nn0.vs2B3nIOIfLWadPWm5hrMvEOSAAx1GuqTxPtBMh5spI";

async function sbGet(table) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY }
  });
  return res.json();
}

async function sbUpsert(table, data) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...data, id: Number(data.id) })
  });
  return res.ok;
}

// reconciliation 的 id 固定用 monthKey（yyyymm）轉數字
function monthToId(year, month) {
  return Number(year + month);
}

// ─── 師傅工資計算（對應 ERP 邏輯）────────────────────────────────────────────
const MASTERS = {
  qingyang: { name: "余青陽", areas: { 宜蘭: { install: 2500, reinstall: 4500 }, 基隆: { install: 2200, reinstall: 4000 }, 台北: { install: 2000, reinstall: 4000 }, 新北: { install: 2000, reinstall: 4000 }, 桃園: { install: 2200, reinstall: 4200 } } },
  laiyanming: { name: "賴彥銘", areas: { 新竹: { install: 3200, reinstall: 5200 }, 苗栗: { install: 2700, reinstall: 4700 }, 台中: { install: 2200, reinstall: 4200 }, 南投: { install: 2200, reinstall: 4200 }, 彰化: { install: 2200, reinstall: 4200 }, 雲林: { install: 2700, reinstall: 4700 }, 嘉義: { install: 3200, reinstall: 5200 } } },
  guo: { name: "郭師傅", areas: { 台南: { install: 2500, reinstall: 4500 }, 高雄: { install: 2000, reinstall: 4000 }, 屏東: { install: 2000, reinstall: 4000 } } },
};

function getMasterName(masterId) {
  return MASTERS[masterId] ? MASTERS[masterId].name : masterId || "";
}

function calcWageFromOrder(order) {
  if (!order) return 0;
  const master = MASTERS[order.masterId];
  if (!master) return order.priceAdjust || 0;
  const area = order.area || Object.keys(master.areas)[0];
  const areaData = master.areas[area];
  if (!areaData) return order.priceAdjust || 0;
  const base = order.jobType === "拆裝" ? areaData.reinstall : order.jobType === "純配送" ? 0 : areaData.install;
  const floor = !order.hasElevator && order.floor >= 4 ? (order.floor - 3) * 300 : 0;
  const thr = order.hasThreshold ? 200 : 0;
  const lt = order.masterId === "qingyang" && order.isLType ? 200 : 0;
  const fp = order.masterId === "qingyang" && order.hasFixedPlate ? 200 : 0;
  const adj = order.priceAdjust || 0;
  return base + floor + thr + lt + fp + adj;
}

// ─── 格式化 ──────────────────────────────────────────────────────────────────
function fmt(n) { return "$" + (Number(n) || 0).toLocaleString("zh-TW"); }
function fmtNum(n) { return (Number(n) || 0).toLocaleString("zh-TW"); }

const MONTHS = ["01","02","03","04","05","06","07","08","09","10","11","12"];

// ─── 主元件 ──────────────────────────────────────────────────────────────────
export default function MonthlyReconciliation() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [loading, setLoading] = useState(true);

  // 原始資料
  const [pendingOrders, setPendingOrders] = useState([]);
  const [scheduleOrders, setScheduleOrders] = useState([]);
  // 廠商成本（本地儲存，key = pendingOrder.id）
  const [costs, setCosts] = useState({});
  // 備註
  const [notes, setNotes] = useState({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      sbGet("pending_orders"),
      sbGet("orders"),
      sbGet("reconciliation"),
    ]).then(([pRows, sRows, rRows]) => {
      setPendingOrders(pRows && pRows.length ? pRows.map(r => r.data) : []);
      setScheduleOrders(sRows && sRows.length ? sRows.map(r => r.data) : []);
      if (rRows && rRows.length) {
        const allCosts = {};
        const allNotes = {};
        rRows.forEach(r => {
          if (r.data && r.data.costs) Object.assign(allCosts, r.data.costs);
          if (r.data && r.data.notes) Object.assign(allNotes, r.data.notes);
        });
        setCosts(allCosts);
        setNotes(allNotes);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveTimer = useRef(null);
  useEffect(() => {
    if (loading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const id = Number(year + month);
      sbUpsert("reconciliation", { id, data: { year, month, costs, notes } });
    }, 800);
  }, [costs, notes]);

  // 當月已出貨的訂單
  const monthKey = year + "-" + month;
  const shipped = useMemo(() => pendingOrders.filter(p => {
    if (!p.shipped) return false;
    const d = p.shippedAt || p.orderDate || "";
    return d.startsWith(monthKey);
  }), [pendingOrders, monthKey]);

  // 對每筆出貨單找對應的排程（用客單名稱或 linkedOrderId）
  function findScheduleWage(p) {
    // 先用 linkedOrderId 找排程
    const linked = scheduleOrders.find(s => {
      const pid = p.linkedOrderId || p.id;
      return s.linkedOrderId === pid || (s.customer && s.customer === (p.cust || p.customer));
    });
    if (linked) return calcWageFromOrder(linked);
    // 找不到就看訂單本身有沒有 master
    return 0;
  }

  function findMasterName(p) {
    const linked = scheduleOrders.find(s => {
      const pid = p.linkedOrderId || p.id;
      return s.linkedOrderId === pid || (s.customer && s.customer === (p.cust || p.customer));
    });
    if (linked) return getMasterName(linked.masterId);
    return p.master || "";
  }

  function findClientName(p) {
    return p.clientName || p.cust || p.customer || "";
  }

  // 計算每筆
  const rows = useMemo(() => shipped.map(p => {
    const wage = findScheduleWage(p);
    const revenue = p.shippedTotal || p.totalAmount || 0;
    const tax = Math.round(revenue - revenue / 1.05);
    const revenueExTax = Math.round(revenue / 1.05);
    const cost = Number(costs[p.id] || 0);
    const gross = revenueExTax - cost - wage;
    return { p, wage, revenue, tax, revenueExTax, cost, gross };
  }), [shipped, scheduleOrders, costs]);

  // 合計
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalTax = rows.reduce((s, r) => s + r.tax, 0);
  const totalRevenueExTax = rows.reduce((s, r) => s + r.revenueExTax, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalWage = rows.reduce((s, r) => s + r.wage, 0);
  const totalGross = rows.reduce((s, r) => s + r.gross, 0);

  // 按師傅分工資
  const wageByMaster = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      const name = findMasterName(r.p);
      m[name] = (m[name] || 0) + r.wage;
    });
    return m;
  }, [rows]);

  function setCost(id, val) {
    setCosts(prev => ({ ...prev, [id]: Number(val) || 0 }));
  }
  function setNote(id, val) {
    setNotes(prev => ({ ...prev, [id]: val }));
  }

  function handlePrint() {
    window.print();
  }

  function handleCopyCSV() {
    const header = "客單名稱\t客戶\t師傅\t出貨日\t發票號碼\t含稅售價\t稅額\t未稅售價\t廠商成本\t師傅工資\t毛利\t備註";
    const lines = rows.map(r => [
      findClientName(r.p),
      r.p.cust || r.p.customer || "",
      findMasterName(r.p),
      r.p.shippedAt || "",
      r.p.invoiceNo || "",
      r.revenue,
      r.tax,
      r.revenueExTax,
      r.cost,
      r.wage,
      r.gross,
      notes[r.p.id] || ""
    ].join("\t"));
    navigator.clipboard.writeText([header, ...lines].join("\n"))
      .then(() => alert("已複製！可貼到 Excel"));
  }

  const profitColor = n => n >= 0 ? "#4ade80" : "#f87171";
  const profitBg = n => n >= 0 ? "#052e16" : "#2d0a0a";

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", color: "#1e293b", fontFamily: ff, padding: 0 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#0f1e3a,#0b1220)", borderBottom: "1px solid #1e3a5f", padding: "20px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📊</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>月結對帳表</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>享浴淋浴拉門 ERP</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <select value={year} onChange={e => setYear(e.target.value)} style={{ background: "#1e3a5f", border: "1px solid #2d5a8e", color: "#e2e8f0", borderRadius: 6, padding: "5px 8px", fontSize: 13, fontFamily: ff }}>
              {["2024","2025","2026"].map(y => <option key={y}>{y}</option>)}
            </select>
            <select value={month} onChange={e => setMonth(e.target.value)} style={{ background: "#1e3a5f", border: "1px solid #2d5a8e", color: "#e2e8f0", borderRadius: 6, padding: "5px 8px", fontSize: 13, fontFamily: ff }}>
              {MONTHS.map(m => <option key={m}>{m}</option>)}
            </select>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>{year}年{month}月</span>
          </div>
        </div>

        {/* 工具列 */}
        <div style={{ display: "flex", gap: 8, paddingBottom: 16 }}>
          <button onClick={handleCopyCSV} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#1d4ed8", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: ff }}>📋 複製 CSV</button>
          <button onClick={handlePrint} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #2d5a8e", background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: ff }}>🖨️ 列印</button>
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {loading && <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>載入中...</div>}

        {!loading && (
          <>
            {/* KPI 卡片 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                { label: "總售價", val: totalRevenue, color: "#3b82f6", icon: "📥" },
                { label: "廠商成本", val: totalCost, color: "#f59e0b", icon: "🏭" },
                { label: "師傅工資", val: totalWage, color: "#8b5cf6", icon: "👷" },
                { label: "毛利", val: totalGross, color: profitColor(totalGross), icon: totalGross >= 0 ? "📈" : "📉" },
              ].map(({ label, val, color, icon }) => (
                <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{fmt(val)}</div>
                </div>
              ))}
            </div>

            {/* 各師傅工資 */}
            {Object.keys(wageByMaster).length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 12, letterSpacing: "0.08em" }}>各師傅工資</div>
                {Object.entries(wageByMaster).map(([name, wage]) => (
                  <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                    <span style={{ color: "#64748b" }}>{name}</span>
                    <span style={{ fontWeight: 600 }}>{fmt(wage)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 明細表 */}
            {rows.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                <div>{year}年{month}月 沒有出貨紀錄</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rows.map(({ p, wage, revenue, tax, revenueExTax, cost, gross }) => (
                  <div key={p.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    {/* 上半：基本資訊 */}
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: 14, marginRight: 10, color: "#1e293b" }}>{findClientName(p)}</span>
                          <span style={{ fontSize: 11, color: "#64748b", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, marginRight: 6 }}>{p.cust || p.customer || ""}</span>
                          {findMasterName(p) && <span style={{ fontSize: 11, color: "#7c3aed", background: "#f3e8ff", padding: "2px 6px", borderRadius: 4 }}>{findMasterName(p)}</span>}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.shippedAt || ""}</div>
                          {p.invoiceNo && <div style={{ fontSize: 11, color: "#64748b" }}>{p.invoiceNo}</div>}
                        </div>
                      </div>
                      {p.product && <div style={{ fontSize: 11, color: "#94a3b8" }}>📦 {p.product}</div>}
                    </div>

                    {/* 下半：金額區 */}
                    <div style={{ padding: "12px 16px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                        {/* 含稅售價 */}
                        <div>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>含稅售價</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#3b82f6" }}>{fmt(revenue)}</div>
                        </div>
                        {/* 稅額 */}
                        <div>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>稅額(5%)</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#f59e0b" }}>{fmt(tax)}</div>
                        </div>
                        {/* 未稅售價 */}
                        <div>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>未稅售價</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#0ea5e9" }}>{fmt(revenueExTax)}</div>
                        </div>
                        {/* 廠商成本 - 手填 */}
                        <div>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>廠商成本</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>$</span>
                            <input
                              type="number"
                              value={costs[p.id] || ""}
                              onChange={e => setCost(p.id, e.target.value)}
                              placeholder="填入"
                              style={{ width: "100%", background: "#f8fafc", border: "1px solid " + (costs[p.id] ? "#f59e0b" : "#e2e8f0"), borderRadius: 6, color: "#1e293b", padding: "4px 6px", fontSize: 13, fontFamily: ff, outline: "none" }}
                            />
                          </div>
                        </div>
                        {/* 師傅工資 */}
                        <div>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>師傅工資</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#8b5cf6" }}>
                            {wage > 0 ? fmt(wage) : <span style={{ color: "#475569", fontSize: 11 }}>未排程</span>}
                          </div>
                        </div>
                        {/* 毛利 */}
                        <div style={{ background: costs[p.id] ? (gross >= 0 ? "#f0fdf4" : "#fef2f2") : "#f8fafc", borderRadius: 8, padding: "4px 8px", border: "1px solid " + (costs[p.id] ? (gross >= 0 ? "#bbf7d0" : "#fecaca") : "#e2e8f0") }}>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>毛利</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: costs[p.id] ? (gross >= 0 ? "#16a34a" : "#dc2626") : "#94a3b8" }}>
                            {costs[p.id] ? fmt(gross) : "—"}
                          </div>
                        </div>
                      </div>

                      {/* 備註 */}
                      <input
                        value={notes[p.id] || ""}
                        onChange={e => setNote(p.id, e.target.value)}
                        placeholder="備註（可空白）"
                        style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid #e2e8f0", color: "#94a3b8", padding: "4px 0", fontSize: 11, fontFamily: ff, outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 底部總計 */}
            {rows.length > 0 && (
              <div style={{ marginTop: 20, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 12, letterSpacing: "0.08em" }}>本月合計</div>
                {[
                  { label: "含稅售價合計", val: totalRevenue, color: "#3b82f6" },
                  { label: "稅額合計(5%)", val: totalTax, color: "#f59e0b" },
                  { label: "未稅售價合計", val: totalRevenueExTax, color: "#0ea5e9" },
                  { label: "廠商成本合計", val: totalCost, color: "#f59e0b", note: totalCost === 0 ? "（尚未填入）" : "" },
                  { label: "師傅工資合計", val: totalWage, color: "#8b5cf6" },
                ].map(({ label, val, color, note }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                    <span style={{ color: "#64748b" }}>{label}{note && <span style={{ fontSize: 10, marginLeft: 6, color: "#94a3b8" }}>{note}</span>}</span>
                    <span style={{ color, fontWeight: 600 }}>{fmt(val)}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
                  <span>本月毛利</span>
                  <span style={{ color: totalGross >= 0 ? "#16a34a" : "#dc2626" }}>{fmt(totalGross)}</span>
                </div>
                {totalCost === 0 && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, textAlign: "right" }}>填入廠商成本後毛利才準確</div>}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          input { border: 1px solid #ccc !important; }
        }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      `}</style>
    </div>
  );
}
