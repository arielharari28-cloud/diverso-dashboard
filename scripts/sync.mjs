// Sincroniza productos y ventas de Tiendanube con Firestore.
// Corre en GitHub Actions. Usa los Secrets:
//   TIENDANUBE_TOKEN, TIENDANUBE_STORE_ID, FIREBASE_SERVICE_ACCOUNT
import admin from "firebase-admin";

const TOKEN = process.env.TIENDANUBE_TOKEN;
const STORE = process.env.TIENDANUBE_STORE_ID;
const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!TOKEN || !STORE || !SA) {
  console.error("Faltan secrets: TIENDANUBE_TOKEN, TIENDANUBE_STORE_ID o FIREBASE_SERVICE_ACCOUNT");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore();

const API = `https://api.tiendanube.com/v1/${STORE}`;
const HEADERS = {
  Authentication: `bearer ${TOKEN}`,
  "User-Agent": "Dashboard Diverso (github.com/arielharari28-cloud/diverso-dashboard)",
  "Content-Type": "application/json",
};
const DIAS_VENTAS = 90; // ventana de pedidos que se analiza
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// La API permite 2 pedidos por segundo: esperamos entre llamadas.
async function getAll(path, params = {}) {
  const out = [];
  for (let page = 1; page < 500; page++) {
    const qs = new URLSearchParams({ ...params, per_page: "200", page: String(page) });
    let res;
    for (let intento = 0; intento < 4; intento++) {
      res = await fetch(`${API}/${path}?${qs}`, { headers: HEADERS });
      if (res.status !== 429) break;
      await sleep(2000 * (intento + 1));
    }
    if (res.status === 404) break; // Tiendanube responde 404 pasada la última página
    if (!res.ok) throw new Error(`${path} página ${page}: HTTP ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < 200) break;
    await sleep(600);
  }
  return out;
}

const txt = (v) => (v && typeof v === "object" ? v.es || Object.values(v)[0] || "" : v || "");
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

async function main() {
  const inicio = Date.now();
  console.log("Leyendo productos…");
  const productos = await getAll("products");
  console.log(`  ${productos.length} productos`);

  const desde = new Date(Date.now() - DIAS_VENTAS * 86400000).toISOString();
  console.log(`Leyendo pedidos desde ${desde.slice(0, 10)}…`);
  const pedidos = await getAll("orders", { created_at_min: desde });
  console.log(`  ${pedidos.length} pedidos`);

  // Ventas por producto: solo pedidos pagos y no cancelados.
  const ahora = Date.now();
  const ventas = {};
  for (const o of pedidos) {
    if (o.status === "cancelled") continue;
    if (o.payment_status && o.payment_status !== "paid") continue;
    const t = new Date(o.created_at).getTime();
    const dias = (ahora - t) / 86400000;
    for (const it of o.products || []) {
      const id = String(it.product_id);
      const q = Number(it.quantity) || 0;
      const fact = q * (Number(it.price) || 0);
      const v = (ventas[id] ||= { u7: 0, u30: 0, u90: 0, f7: 0, f30: 0, f90: 0, ultima: null });
      v.u90 += q; v.f90 += fact;
      if (dias <= 30) { v.u30 += q; v.f30 += fact; }
      if (dias <= 7) { v.u7 += q; v.f7 += fact; }
      if (!v.ultima || o.created_at > v.ultima) v.ultima = o.created_at;
    }
  }

  // Escribimos en lotes de 400 (el máximo de Firestore es 500).
  let batch = db.batch();
  let enLote = 0;
  const flush = async () => { if (enLote) { await batch.commit(); batch = db.batch(); enLote = 0; } };

  const vistos = new Set();
  for (const p of productos) {
    const id = String(p.id);
    vistos.add(id);
    const variantes = p.variants || [];
    const precios = variantes.map((x) => num(x.promotional_price) || num(x.price)).filter((x) => x !== null);
    const preciosLista = variantes.map((x) => num(x.price)).filter((x) => x !== null);
    // stock null en Tiendanube = stock infinito (sin control de stock)
    const infinito = variantes.some((x) => x.stock === null || x.stock_management === false);
    const stock = infinito ? null : variantes.reduce((s, x) => s + (Number(x.stock) || 0), 0);
    const v = ventas[id] || { u7: 0, u30: 0, u90: 0, f7: 0, f30: 0, f90: 0, ultima: null };

    batch.set(db.collection("productos").doc(id), {
      nombre: txt(p.name),
      foto: p.images?.[0]?.src || null,
      url: p.canonical_url || null,
      publicado: p.published !== false,
      creado: p.created_at || null,
      categorias: (p.categories || []).map((c) => txt(c.name)).filter(Boolean),
      precio: precios.length ? Math.min(...precios) : null,
      precioLista: preciosLista.length ? Math.min(...preciosLista) : null,
      variantes: variantes.length,
      stock,
      stockInfinito: infinito,
      ventas: v,
      activo: true,
      actualizado: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (++enLote >= 400) await flush();
  }
  await flush();

  // Productos que ya no están en Tiendanube: se marcan inactivos (no se borran,
  // para no perder la familia y los creativos que se les asignaron).
  const existentes = await db.collection("productos").where("activo", "==", true).select().get();
  for (const d of existentes.docs) {
    if (!vistos.has(d.id)) {
      batch.update(d.ref, { activo: false });
      if (++enLote >= 400) await flush();
    }
  }
  await flush();

  await db.collection("sync").doc("estado").set({
    ultima: admin.firestore.FieldValue.serverTimestamp(),
    productos: productos.length,
    pedidos: pedidos.length,
    diasVentas: DIAS_VENTAS,
    segundos: Math.round((Date.now() - inicio) / 1000),
  });
  console.log(`Listo en ${Math.round((Date.now() - inicio) / 1000)} s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
