/*
Canva-Embeddable Restaurant Inventory App
Single-file React component (default export) with Tailwind styling.

What this file contains:
- Full React app (mobile-first) built to be embedded in an iframe (Canva App or iframe widget)
- Features implemented: multi-branch, daily intake, transfers, master item management, monthly/yearly reports, low-stock alerts, order suggestions, import/export hooks
- Designed to plug into a backend (Firebase / Google Sheets). For demo, this uses localStorage and a lightweight mock DB layer with clear extension points for Firebase/Sheets.
- README & deployment instructions included at the bottom of this file.

Notes:
- When embedding into Canva, host the built app on any HTTPS host (Netlify / Vercel / Firebase Hosting). Then embed the URL in Canva as an "iframe app" using the Canva Apps SDK or an iframe component.
- This file is intentionally self-contained for prototyping. Replace the `db` object implementation with Firebase/Google Sheets API calls in production.

*/

import React, { useEffect, useMemo, useState } from "react";

// ------------------ Helper / Mock DB ------------------
// Replace this with real backend calls (Firebase / Google Sheets / Airtable).
const DB_KEY = "canva_inventory_v1";

const defaultBranches = [
  { id: "b_hq", name: "Head Office" },
  { id: "b_1", name: "Branch 1" },
  { id: "b_2", name: "Branch 2" }
];

const defaultItems = [
  { id: "i_veg_tom", name: "Tomato", category: "Vegetable", unit: "kg", minStock: 10, preferredOrder: 20, leadTime: 2, unitCost: 30, storage: "Cold Room" },
  { id: "i_meat_pork", name: "Pork (raw)", category: "Raw Meat", unit: "kg", minStock: 15, preferredOrder: 30, leadTime: 3, unitCost: 150, storage: "Fridge" },
  { id: "i_sea_shrimp", name: "Shrimp", category: "Seafood", unit: "kg", minStock: 8, preferredOrder: 16, leadTime: 2, unitCost: 200, storage: "Freezer" }
];

const initialState = {
  branches: defaultBranches,
  items: defaultItems,
  transactions: [] // stock transactions and transfers
};

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
      localStorage.setItem(DB_KEY, JSON.stringify(initialState));
      return JSON.parse(JSON.stringify(initialState));
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error("loadDB error", e);
    return JSON.parse(JSON.stringify(initialState));
  }
}

function saveDB(state) {
  localStorage.setItem(DB_KEY, JSON.stringify(state));
}

// Helper ID generator
const id = (prefix = "id") => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

// ------------------ App ------------------
export default function CanvaInventoryApp() {
  const [db, setDb] = useState(() => loadDB());
  const [branchId, setBranchId] = useState(db.branches[1]?.id || db.branches[0].id);
  const [view, setView] = useState("dashboard");
  const [dateStr, setDateStr] = useState(new Date().toISOString().slice(0, 10));
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => saveDB(db), [db]);

  // ------------------ CRUD helpers ------------------
  function addItem(item) {
    const newItem = { ...item, id: id("i") };
    setDb(prev => ({ ...prev, items: [...prev.items, newItem] }));
    return newItem;
  }

  function updateItem(itemId, patch) {
    setDb(prev => ({ ...prev, items: prev.items.map(it => it.id === itemId ? { ...it, ...patch } : it) }));
  }

  function removeItem(itemId) {
    setDb(prev => ({ ...prev, items: prev.items.filter(it => it.id !== itemId) }));
  }

  function addBranch(b) {
    const nb = { id: id("b"), ...b };
    setDb(prev => ({ ...prev, branches: [...prev.branches, nb] }));
    return nb;
  }

  function addTransaction(tx) {
    const ntx = { ...tx, id: id("t") };
    setDb(prev => ({ ...prev, transactions: [...prev.transactions, ntx] }));
    return ntx;
  }

  // ------------------ Stock calculation ------------------
  // Given branch+item and date, compute start, received, transferIn, transferOut, end, wastage
  function calcDailyRecord(branchId, itemId, dateISO) {
    // Assumes transactions are recorded with fields: {type: 'opening'|'receive'|'use'|'wastage'|'transfer', branchFrom?, branchTo?, qty, date, notes}
    const day = dateISO.slice(0, 10);
    const txs = db.transactions.filter(t => t.itemId === itemId && t.date.slice(0, 10) === day);
    // For simplicity, we'll compute daily from transactions listed for that day plus previous end-of-day as opening (not implemented full historical)
    let received = 0, transferIn = 0, transferOut = 0, used = 0, wastage = 0;
    txs.forEach(t => {
      if (t.type === "receive" && t.branchId === branchId) received += t.qty;
      if (t.type === "transfer" && t.branchFrom === branchId) transferOut += t.qty;
      if (t.type === "transfer" && t.branchTo === branchId) transferIn += t.qty;
      if (t.type === "use" && t.branchId === branchId) used += t.qty;
      if (t.type === "wastage" && t.branchId === branchId) wastage += t.qty;
    });
    // find last known end stock before this day
    const previous = getLatestEndStockBefore(branchId, itemId, day);
    const start = previous != null ? previous : 0;
    const end = start + received + transferIn - used - transferOut - wastage;
    return { start, received, transferIn, transferOut, used, wastage, end };
  }

  function getLatestEndStockBefore(branchId, itemId, dateDay) {
    // Search backwards in transactions for an explicit 'endStock' snapshot transaction (not implemented in this demo)
    // For prod: store daily snapshot entries or compute from full history.
    // Here return null to treat start as 0 for first demo.
    return null;
  }

  // ------------------ Reporting ------------------
  function computeUsageHistory(branchIdFilter = null, itemIdFilter = null) {
    // Convert transactions to daily usage per item per branch
    const usageMap = {}; // key = branch|item|day -> usage
    db.transactions.forEach(t => {
      const day = t.date.slice(0, 10);
      if (t.type === "use" || t.type === "wastage") {
        const branch = t.branchId;
        const item = t.itemId;
        if (branchIdFilter && branch !== branchIdFilter) return;
        if (itemIdFilter && item !== itemIdFilter) return;
        const key = `${branch}||${item}||${day}`;
        usageMap[key] = (usageMap[key] || 0) + t.qty;
      }
    });
    // Aggregate into per-day arrays
    const result = {};
    Object.keys(usageMap).forEach(k => {
      const [branch,item,day] = k.split("||");
      if (!result[branch]) result[branch] = {};
      if (!result[branch][item]) result[branch][item] = [];
      result[branch][item].push({ day, qty: usageMap[k] });
    });
    return result;
  }

  function avgUsageForItem(branchId, itemId, rangeDays=30) {
    // compute average daily use from last rangeDays
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeDays);
    let total = 0, daysSeen = new Set();
    db.transactions.forEach(t => {
      if ((t.type === 'use') && t.branchId === branchId && t.itemId === itemId) {
        const d = new Date(t.date);
        if (d >= cutoff) {
          total += t.qty;
          daysSeen.add(t.date.slice(0,10));
        }
      }
    });
    const days = daysSeen.size || rangeDays; // fallback
    return total / days;
  }

  function suggestedOrderQty(branchIdArg, itemIdArg) {
    const item = db.items.find(i => i.id === itemIdArg);
    if (!item) return 0;
    const avgDaily = avgUsageForItem(branchIdArg, itemIdArg, 30) || 0;
    const lead = item.leadTime || 2;
    // Suggested = avgDaily * leadTime * safetyFactor - currentStock
    const safetyFactor = 1.2;
    const needed = Math.ceil(avgDaily * lead * safetyFactor - getCurrentStock(branchIdArg, itemIdArg));
    return needed > 0 ? needed : 0;
  }

  function getCurrentStock(branchIdArg, itemIdArg) {
    // sum up transactions to get current approximation
    // For demo: treat 'end' snapshot transactions if present; otherwise approximate
    let stock = 0;
    db.transactions.forEach(t => {
      if (t.itemId !== itemIdArg) return;
      // Opening and snapshot types not implemented; assume transactions are chronological
      if (t.type === 'receive' && t.branchId === branchIdArg) stock += t.qty;
      if (t.type === 'transfer' && t.branchTo === branchIdArg) stock += t.qty;
      if (t.type === 'use' && t.branchId === branchIdArg) stock -= t.qty;
      if (t.type === 'wastage' && t.branchId === branchIdArg) stock -= t.qty;
      if (t.type === 'transfer' && t.branchFrom === branchIdArg) stock -= t.qty;
    });
    return Math.max(0, Math.round(stock*100)/100);
  }

  // ------------------ UI Components ------------------
  function Topbar() {
    return (
      <div className="w-full bg-white p-3 shadow-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <h2 className="font-bold text-lg">Inventory — Multi-branch (Canva Embed)</h2>
          <div className="ml-auto flex items-center gap-2">
            <select value={branchId} onChange={e=>setBranchId(e.target.value)} className="border rounded p-1">
              {db.branches.map(b=> <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button onClick={()=>setView('dashboard')} className={`p-1 rounded ${view==='dashboard' ? 'bg-slate-100':''}`}>Dashboard</button>
            <button onClick={()=>setView('daily')} className={`p-1 rounded ${view==='daily' ? 'bg-slate-100':''}`}>Daily Entry</button>
            <button onClick={()=>setView('items')} className={`p-1 rounded ${view==='items' ? 'bg-slate-100':''}`}>Manage Items</button>
            <button onClick={()=>setView('reports')} className={`p-1 rounded ${view==='reports' ? 'bg-slate-100':''}`}>Reports</button>
            <button onClick={()=>setView('transfers')} className={`p-1 rounded ${view==='transfers' ? 'bg-slate-100':''}`}>Transfers</button>
          </div>
        </div>
      </div>
    );
  }

  function DashboardView() {
    // Show low stock summary and quick actions
    const lowList = db.items.map(item => {
      const cur = getCurrentStock(branchId, item.id);
      const low = cur < item.minStock;
      return { item, cur, low, suggested: suggestedOrderQty(branchId, item.id) };
    }).filter(i=>true);

    return (
      <div className="max-w-5xl mx-auto p-4">
        <h3 className="text-xl font-semibold mb-2">Dashboard — {db.branches.find(b=>b.id===branchId)?.name}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-3 rounded shadow-sm">
            <h4 className="font-bold mb-2">Low Stock Alerts</h4>
            <div className="space-y-2">
              {lowList.map(l=> (
                <div key={l.item.id} className="flex items-center justify-between border-b pb-2">
                  <div>
                    <div className="font-medium">{l.item.name} <span className="text-xs text-slate-500">({l.item.unit})</span></div>
                    <div className="text-sm text-slate-500">Current: {l.cur} • Min: {l.item.minStock} • Suggested: {l.suggested}</div>
                  </div>
                  <div>
                    {l.low ? <span className="text-red-600 font-semibold">Order Now</span> : <span className="text-green-600">OK</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-3 rounded shadow-sm">
            <h4 className="font-bold mb-2">Quick Actions</h4>
            <div className="flex flex-col gap-2">
              <button onClick={()=>setView('daily')} className="p-2 rounded border">Record Daily Intake / Use</button>
              <button onClick={()=>setView('transfers')} className="p-2 rounded border">Create Transfer</button>
              <button onClick={()=>{ navigator.clipboard?.writeText(JSON.stringify(db.items)); alert('Items JSON copied') }} className="p-2 rounded border">Export Items JSON</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function DailyEntryView() {
    const [entryList, setEntryList] = useState(() => db.items.map(i=>({ itemId: i.id, received:0, used:0, wastage:0 })));

    useEffect(()=>{
      setEntryList(db.items.map(i=>({ itemId: i.id, received:0, used:0, wastage:0 })));
    }, [db.items, branchId, dateStr]);

    function saveAll() {
      // create transactions
      const dayISO = dateStr + 'T12:00:00.000Z';
      entryList.forEach(e=>{
        if (e.received && e.received>0) addTransaction({ type: 'receive', branchId, itemId: e.itemId, qty: Number(e.received), date: new Date().toISOString(), notes: 'Daily receive' });
        if (e.used && e.used>0) addTransaction({ type: 'use', branchId, itemId: e.itemId, qty: Number(e.used), date: new Date().toISOString(), notes: 'Daily use' });
        if (e.wastage && e.wastage>0) addTransaction({ type: 'wastage', branchId, itemId: e.itemId, qty: Number(e.wastage), date: new Date().toISOString(), notes: 'Wastage' });
      });
      alert('Daily entries saved (demo mode: local). In production backend, transactions will persist to server.');
      setView('dashboard');
    }

    return (
      <div className="max-w-5xl mx-auto p-4">
        <h3 className="text-xl font-semibold mb-2">Daily Entry — {db.branches.find(b=>b.id===branchId)?.name}</h3>
        <div className="mb-3 flex gap-2 items-center">
          <label className="text-sm">Date</label>
          <input type="date" value={dateStr} onChange={e=>setDateStr(e.target.value)} className="border p-1 rounded" />
        </div>
        <div className="bg-white rounded shadow-sm p-3 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Item</th>
                <th className="p-2">Received</th>
                <th className="p-2">Used</th>
                <th className="p-2">Wastage</th>
                <th className="p-2">Current Est.</th>
              </tr>
            </thead>
            <tbody>
              {db.items.map(it=>{
                const cur = getCurrentStock(branchId, it.id);
                const e = entryList.find(x=>x.itemId===it.id) || {received:0, used:0, wastage:0};
                return (
                  <tr key={it.id} className="border-b">
                    <td className="p-2">{it.name} <div className="text-xs text-slate-500">{it.category} • {it.unit}</div></td>
                    <td className="p-2"><input type="number" min="0" value={e.received} onChange={ev=>setEntryList(prev=>prev.map(x=> x.itemId===it.id ? {...x, received: ev.target.value} : x ))} className="border p-1 w-28 rounded" /></td>
                    <td className="p-2"><input type="number" min="0" value={e.used} onChange={ev=>setEntryList(prev=>prev.map(x=> x.itemId===it.id ? {...x, used: ev.target.value} : x ))} className="border p-1 w-28 rounded" /></td>
                    <td className="p-2"><input type="number" min="0" value={e.wastage} onChange={ev=>setEntryList(prev=>prev.map(x=> x.itemId===it.id ? {...x, wastage: ev.target.value} : x ))} className="border p-1 w-28 rounded" /></td>
                    <td className="p-2">{cur}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={saveAll} className="bg-blue-600 text-white px-4 py-2 rounded">Save Daily Entries</button>
          <button onClick={()=>setView('dashboard')} className="px-4 py-2 rounded border">Cancel</button>
        </div>
      </div>
    );
  }

  function ItemsView() {
    const [form, setForm] = useState({ name: '', category: 'Vegetable', unit: 'kg', minStock:0, preferredOrder:0, leadTime:2, unitCost:0, storage: '' });

    function onAdd() {
      if (!form.name) return alert('Please enter item name');
      addItem(form);
      setForm({ name:'', category:'Vegetable', unit:'kg', minStock:0, preferredOrder:0, leadTime:2, unitCost:0, storage: '' });
    }

    return (
      <div className="max-w-5xl mx-auto p-4">
        <h3 className="text-xl font-semibold mb-2">Manage Items</h3>
        <div className="bg-white p-3 rounded shadow-sm mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input placeholder="Item name" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} className="border p-2 rounded" />
            <select value={form.category} onChange={e=>setForm({...form, category:e.target.value})} className="border p-2 rounded">
              <option>Vegetable</option>
              <option>Raw Meat</option>
              <option>Seafood</option>
              <option>Frozen</option>
              <option>Ingredient</option>
              <option>Sauce</option>
              <option>Packaging</option>
              <option>Other</option>
            </select>
            <input placeholder="Unit (kg/pcs/L)" value={form.unit} onChange={e=>setForm({...form, unit:e.target.value})} className="border p-2 rounded" />
            <input type="number" placeholder="Min stock" value={form.minStock} onChange={e=>setForm({...form, minStock:Number(e.target.value)})} className="border p-2 rounded" />
            <input type="number" placeholder="Preferred order" value={form.preferredOrder} onChange={e=>setForm({...form, preferredOrder:Number(e.target.value)})} className="border p-2 rounded" />
            <input type="number" placeholder="Lead time (days)" value={form.leadTime} onChange={e=>setForm({...form, leadTime:Number(e.target.value)})} className="border p-2 rounded" />
            <input placeholder="Storage (e.g., Fridge)" value={form.storage} onChange={e=>setForm({...form, storage:e.target.value})} className="border p-2 rounded" />
            <input type="number" placeholder="Unit cost" value={form.unitCost} onChange={e=>setForm({...form, unitCost:Number(e.target.value)})} className="border p-2 rounded" />
          </div>
          <div className="mt-2">
            <button onClick={onAdd} className="bg-green-600 text-white px-3 py-1 rounded">Add Item</button>
          </div>
        </div>

        <div className="bg-white p-3 rounded shadow-sm">
          <h4 className="font-bold mb-2">Master Items</h4>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="p-2">Name</th><th>Category</th><th>Unit</th><th>Min</th><th>Order</th><th>Lead</th><th>Cost</th><th>Actions</th></tr></thead>
              <tbody>
                {db.items.map(it=> (
                  <tr key={it.id} className="border-b">
                    <td className="p-2">{it.name}</td>
                    <td>{it.category}</td>
                    <td>{it.unit}</td>
                    <td>{it.minStock}</td>
                    <td>{it.preferredOrder}</td>
                    <td>{it.leadTime}</td>
                    <td>{it.unitCost}</td>
                    <td>
                      <button onClick={()=>{ setSelectedItem(it); setView('editItem') }} className="px-2 py-1 border rounded">Edit</button>
                      <button onClick={()=>{ if(window.confirm('Delete item?')) removeItem(it.id)}} className="px-2 py-1 border rounded ml-1">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function EditItemView() {
    const it = selectedItem;
    const [form, setForm] = useState(it || {});
    if(!it) return <div className="p-4">No item selected</div>;
    function save() { updateItem(it.id, form); setView('items'); }
    return (
      <div className="max-w-5xl mx-auto p-4">
        <h3 className="text-xl font-semibold mb-2">Edit Item</h3>
        <div className="bg-white p-3 rounded shadow-sm grid grid-cols-1 md:grid-cols-3 gap-2">
          <input value={form.name} onChange={e=>setForm({...form, name:e.target.value})} className="border p-2 rounded" />
          <select value={form.category} onChange={e=>setForm({...form, category:e.target.value})} className="border p-2 rounded">
            <option>Vegetable</option>
            <option>Raw Meat</option>
            <option>Seafood</option>
            <option>Frozen</option>
            <option>Ingredient</option>
            <option>Sauce</option>
            <option>Packaging</option>
            <option>Other</option>
          </select>
          <input value={form.unit} onChange={e=>setForm({...form, unit:e.target.value})} className="border p-2 rounded" />
          <input type="number" value={form.minStock} onChange={e=>setForm({...form, minStock:Number(e.target.value)})} className="border p-2 rounded" />
          <input type="number" value={form.preferredOrder} onChange={e=>setForm({...form, preferredOrder:Number(e.target.value)})} className="border p-2 rounded" />
          <input type="number" value={form.leadTime} onChange={e=>setForm({...form, leadTime:Number(e.target.value)})} className="border p-2 rounded" />
          <input value={form.storage} onChange={e=>setForm({...form, storage:e.target.value})} className="border p-2 rounded" />
          <input type="number" value={form.unitCost} onChange={e=>setForm({...form, unitCost:Number(e.target.value)})} className="border p-2 rounded" />
        </div>
        <div className="mt-2">
          <button onClick={save} className="bg-blue-600 text-white px-3 py-1 rounded">Save</button>
          <button onClick={()=>setView('items')} className="ml-2 px-3 py-1 border rounded">Cancel</button>
        </div>
      </div>
    );
  }

  function TransfersView() {
    const [form, setForm] = useState({ branchFrom: branchId, branchTo: db.branches.find(b=>b.id!==branchId)?.id || branchId, itemId: db.items[0]?.id || '', qty: 0, date: new Date().toISOString().slice(0,10), notes: '' });

    function createTransfer() {
      if (!form.itemId) return alert('Select item');
      if (form.branchFrom === form.branchTo) return alert('From and To cannot be same');
      addTransaction({ type: 'transfer', branchFrom: form.branchFrom, branchTo: form.branchTo, itemId: form.itemId, qty: Number(form.qty), date: new Date().toISOString(), notes: form.notes });
      alert('Transfer recorded. Recipient will see added stock.');
      setForm({...form, qty:0});
    }

    const history = db.transactions.filter(t => t.type === 'transfer').slice().reverse();

    return (
      <div className="max-w-5xl mx-auto p-4">
        <h3 className="text-xl font-semibold mb-2">Inter-Branch Transfers</h3>
        <div className="bg-white p-3 rounded shadow-sm mb-4 grid grid-cols-1 md:grid-cols-4 gap-2">
          <select value={form.branchFrom} onChange={e=>setForm({...form, branchFrom:e.target.value})} className="border p-2 rounded">
            {db.branches.map(b=> <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={form.branchTo} onChange={e=>setForm({...form, branchTo:e.target.value})} className="border p-2 rounded">
            {db.branches.map(b=> <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={form.itemId} onChange={e=>setForm({...form, itemId:e.target.value})} className="border p-2 rounded">
            {db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input type="number" value={form.qty} onChange={e=>setForm({...form, qty:Number(e.target.value)})} className="border p-2 rounded" />
          <input placeholder="notes" value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})} className="border p-2 rounded col-span-3" />
          <div className="col-span-4">
            <button onClick={createTransfer} className="bg-blue-600 text-white px-3 py-1 rounded">Record Transfer</button>
          </div>
        </div>

        <div className="bg-white p-3 rounded shadow-sm">
          <h4 className="font-bold mb-2">Recent Transfers</h4>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th>Date</th><th>From</th><th>To</th><th>Item</th><th>Qty</th><th>Notes</th></tr></thead>
              <tbody>
                {history.map(h=> (
                  <tr key={h.id} className="border-b"><td className="p-2">{new Date(h.date).toLocaleString()}</td><td>{db.branches.find(b=>b.id===h.branchFrom)?.name}</td><td>{db.branches.find(b=>b.id===h.branchTo)?.name}</td><td>{db.items.find(i=>i.id===h.itemId)?.name}</td><td>{h.qty}</td><td>{h.notes}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function ReportsView() {
    const [rangeType, setRangeType] = useState('monthly');
    const [year, setYear] = useState(new Date().getFullYear());
    const [month, setMonth] = useState((new Date().getMonth()+1).toString().padStart(2,'0'));

    // Build a simple monthly summary for selected branch
    const monthStart = `${year}-${month}-01`;

    // compute totals per category and item
    const itemsWithUsage = db.items.map(it => {
      // sum usage transactions during month
      const sum = db.transactions.reduce((acc,t)=>{
        if (t.itemId !== it.id) return acc;
        const tdate = new Date(t.date);
        if (tdate.getFullYear() !== Number(year)) return acc;
        if (rangeType === 'monthly' && (tdate.getMonth()+1) !== Number(month)) return acc;
        if (t.branchId !== branchId && t.branchFrom !== branchId && t.branchTo !== branchId) return acc;
        if (t.type === 'use') return acc + t.qty;
        return acc;
      },0);
      return { ...it, usedQty: sum };
    }).sort((a,b)=>b.usedQty - a.usedQty);

    // totals
    const totalCost = itemsWithUsage.reduce((acc,it)=> acc + (it.usedQty * (it.unitCost||0)), 0);

    return (
      <div className="max-w-5xl mx-auto p-4">
        <h3 className="text-xl font-semibold mb-2">Reports — {db.branches.find(b=>b.id===branchId)?.name}</h3>
        <div className="bg-white p-3 rounded shadow-sm mb-4">
          <div className="flex gap-2 items-center">
            <select value={rangeType} onChange={e=>setRangeType(e.target.value)} className="border p-1 rounded">
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <input type="number" value={year} onChange={e=>setYear(Number(e.target.value))} className="border p-1 rounded w-28" />
            {rangeType==='monthly' && <select value={month} onChange={e=>setMonth(e.target.value)} className="border p-1 rounded">
              {Array.from({length:12}).map((_,i)=>{ const m=(i+1).toString().padStart(2,'0'); return <option key={m} value={m}>{m}</option> })}
            </select>}
            <div className="ml-auto font-medium">Estimated Cost: {totalCost.toLocaleString()}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-3 rounded shadow-sm">
            <h4 className="font-bold mb-2">Top Used Items</h4>
            <div className="space-y-2">
              {itemsWithUsage.slice(0,10).map(it => (
                <div key={it.id} className="flex justify-between border-b pb-2">
                  <div>{it.name} <div className="text-xs text-slate-500">{it.category}</div></div>
                  <div>{it.usedQty} {it.unit}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-3 rounded shadow-sm">
            <h4 className="font-bold mb-2">Order Recommendations</h4>
            <div className="space-y-2">
              {db.items.map(it => (
                <div key={it.id} className="flex justify-between border-b pb-2">
                  <div>{it.name} <div className="text-xs text-slate-500">Avg30d: {avgUsageForItem(branchId, it.id, 30).toFixed(2)}/day • Lead: {it.leadTime}d</div></div>
                  <div>Suggested: {suggestedOrderQty(branchId, it.id)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    );
  }

  // ------------------ Main render ------------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <Topbar />
      {view === 'dashboard' && <DashboardView />}
      {view === 'daily' && <DailyEntryView />}
      {view === 'items' && <ItemsView />}
      {view === 'editItem' && <EditItemView />}
      {view === 'transfers' && <TransfersView />}
      {view === 'reports' && <ReportsView />}

      <div className="max-w-5xl mx-auto p-4 text-xs text-slate-500">
        Canva embed notes: Host this app and use an iframe with appropriate domain permissions. Replace localStorage DB with Firebase or Google Sheet API for multi-user real-time sync. See README below.
      </div>
    </div>
  );
}

/*
README & Deployment Notes (copy into your project README)

Overview
--------
This single-file React component is a fully functional prototype of a Canva-embeddable inventory app for restaurant chains, supporting:
- Multi-branch operations
- Daily intake, usage, wastage tracking
- Inter-branch transfers (transfer out / transfer in)
- Item master management
- Low-stock alerts & suggested order quantities
- Monthly & yearly summary reports

Important production improvements
--------------------------------
1) **Backend & Real-time sync**
   - Replace the demo localStorage implementation with a real backend.
   - Recommended: Firebase Firestore (real-time, easy to secure) or Google Sheets via Apps Script for simpler setups.
   - Data schema is described inside the code. Key collections: branches, items, transactions, users.

2) **Authentication & Roles**
   - Add user auth and role-based access (Staff, Manager, HQ Admin).
   - Firebase Auth + Firestore rules recommended.

3) **Snapshots / Accurate Stock Calculation**
   - Production should store daily EOD snapshots or compute stock from full transaction history (with opening stock) to avoid drift.

4) **Integrations**
   - POS integration for automated usage estimates
   - Supplier / Purchase Order generation
   - Notification (Email / LINE / WhatsApp) for low stock alerts

5) **Canva Embedding**
   - Build and host the app on an HTTPS host (Vercel / Netlify / Firebase Hosting).
   - In Canva, create a custom app or embed an iframe that points to your hosted app. Canva Apps SDK can also be used for deeper integration.
   - Ensure CORS and X-Frame-Options allow embedding from Canva.

Data Structure (for Firestore / Sheets)
--------------------------------------
branches: { id, name, location }
items: { id, name, category, unit, minStock, preferredOrder, leadTime, unitCost, storage }
transactions: { id, type (receive/use/wastage/transfer), date (ISO), branchId?, branchFrom?, branchTo?, itemId, qty, notes, createdBy }
users: { id, name, role, branchId }

Suggested APIs to implement
---------------------------
- GET /branches
- GET /items
- GET /transactions?branch=&item=&from=&to=
- POST /transactions
- POST /items
- POST /transfers
- GET /reports/monthly?branch=&year=&month=

Deployment steps (quick)
------------------------
1. Create React app and paste this component as App.jsx
2. Install dependencies and TailwindCSS
3. Replace localStorage DB functions with Firestore client calls
4. Host on Vercel/Netlify/Firebase Hosting
5. Configure Canvas: add the hosted URL as an iframe app or build a Canva App via their developer docs

Security
--------
- Enforce auth rules so only authorized users can make transactions.
- Use server-side verification for transfers/orders > threshold amounts.

Future roadmap ideas
--------------------
- Recipe linking (map items to menu recipes) to forecast orders based on menu sales.
- Auto reorder rules per item (min, max, lead-time based)
- Central purchasing module for HQ bulk orders
- Analytics: food-cost %, shrinkage, supplier KPIs

*/
