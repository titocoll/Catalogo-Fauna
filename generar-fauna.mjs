import fs from "fs";

const BASE = "https://fauna.com.uy";
const CATEGORIAS = ["teros", "colibries", "campo", "aves", "marinos"];
const MARCA = "Fauna";
const ARCHIVO = "publicar/fauna.xml";
const DESCRIPCION_GENERICA = "Esculturas sustentables de animales promoviendo";
const PREORDEN = /pre-?\s?orde[nr]/i;

const NAVEGADOR = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "es-UY,es;q=0.9",
};

const esc = (t) => String(t ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const entidades = (t) => String(t || "")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

const limpiar = (html) => entidades(String(html || "")
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const capitalizar = (t) => t.split(" ").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

function numero(t) {
  let s = String(t || "").trim();
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  return Number(s) || 0;
}

async function traer(url) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(url, { headers: NAVEGADOR });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
      console.log(`  ${url} -> intento ${intento} fallo (codigo ${res.status})`);
    } catch (e) {
      console.log(`  ${url} -> intento ${intento} fallo (${e.message})`);
    }
    await pausa(3000 * intento);
  }
  return null;
}

function meta(html, nombre) {
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${nombre}["'][^>]*content=["']([^"']*)["']`, "i"));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${nombre}["']`, "i"));
  return entidades((a || b || [])[1] || "");
}

const absoluta = (u) => !u ? "" : u.startsWith("//") ? "https:" + u : u.startsWith("/") ? BASE + u : u;

function bloqueDesde(html, inicio) {
  const etiqueta = (html.slice(inicio).match(/^<([a-z0-9]+)/i) || [])[1];
  if (!etiqueta) return "";
  const re = new RegExp(`<\\/?${etiqueta}\\b[^>]*>`, "gi");
  re.lastIndex = inicio;
  let profundidad = 0, m;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") {
      profundidad--;
      if (profundidad === 0) return html.slice(inicio, m.index);
    } else if (!m[0].endsWith("/>")) {
      profundidad++;
    }
  }
  return "";
}

function descripcionCompleta(html, resumen) {
  const candidatos = [];
  for (const [, contenido] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const datos = JSON.parse(contenido);
      const todos = [datos, ...(Array.isArray(datos) ? datos : []), ...(datos["@graph"] || [])];
      const producto = todos.find((o) => o && o["@type"] === "Product");
      if (producto?.description) candidatos.push(limpiar(producto.description));
    } catch {}
  }
  for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*(?:class|id)=["'][^"']*descrip[^"']*["'][^>]*>/gi)) {
    candidatos.push(limpiar(bloqueDesde(html, m.index)));
  }
  const prefijo = limpiar(resumen).slice(0, 30).toLowerCase();
  const validos = candidatos
    .filter((t) => t && t.length < 8000)
    .filter((t) => !prefijo || t.toLowerCase().includes(prefijo))
    .sort((a, b) => b.length - a.length);
  return validos[0] || "";
}

try {
  const productos = new Map();

  for (const cat of CATEGORIAS) {
    const vistosCat = new Set();
    for (let page = 1; page <= 30; page++) {
      const html = await traer(`${BASE}/${cat}/${page}`);
      if (!html) break;
      const anclas = [...html.matchAll(/<a\b[^>]*href=["']((?:https?:\/\/(?:www\.)?fauna\.com\.uy)?\/p\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      let nuevosCat = 0;
      for (const [, href, interior] of anclas) {
        const url = absoluta(href).split("?")[0];
        if (vistosCat.has(url)) continue;
        vistosCat.add(url);
        nuevosCat++;
        if (productos.has(url)) continue;
        const texto = limpiar(interior);
        const precio = [...texto.matchAll(/(USD|U\$S|\$)\s*([\d.,]+)/g)].pop();
        const preorden = PREORDEN.test(texto);
        const agotado = /out of stock|sin stock|agotado/i.test(texto);
        const img = (interior.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i) || [])[1] || "";
        productos.set(url, {
          url, categoria: capitalizar(cat), preorden,
          enStock: !agotado,
          precio: precio ? numero(precio[2]) : 0,
          moneda: precio ? (precio[1] === "$" ? "UYU" : "USD") : "",
          imagen: absoluta(img),
        });
      }
      console.log(`  ${cat} pagina ${page}: ${nuevosCat} productos en la pagina`);
      if (nuevosCat === 0) break;
      await pausa(700);
    }
  }

  console.log(`  ${productos.size} productos distintos encontrados en las categorias`);
  if (productos.size === 0) throw new Error("No se encontraron productos en las categorias");

  let sinPrecio = 0, sinPagina = 0, guardados = 0, completas = 0, resumidas = 0, enPreorden = 0;
  const titulos = {};
  const ejemplos = [];
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Feed de productos ${esc(MARCA)}</title>
    <link>${BASE}</link>
    <description>Catalogo completo de productos</description>\n`;

  for (const p of productos.values()) {
    if (!(p.precio > 0)) { sinPrecio++; console.log(`  Sin precio: ${p.url}`); continue; }

    const html = await traer(p.url);
    await pausa(700);
    if (!html) sinPagina++;

    const slug = p.url.split("/p/")[1]?.split("/")[0] || "";
    let titulo = html ? meta(html, "og:title").replace(/\s*-\s*Fauna\s*-\s*Tienda Online\s*$/i, "").trim() : "";
    if (!titulo || /Tienda Online/i.test(titulo)) titulo = slug.replace(/-+/g, " ").trim().toUpperCase();

    let imagen = html ? absoluta(meta(html, "og:image")) : "";
    if (!imagen || /metaLogo/i.test(imagen)) imagen = p.imagen;

    let resumen = html ? (meta(html, "og:description") || meta(html, "description")) : "";
    if (resumen.startsWith(DESCRIPCION_GENERICA)) resumen = "";
    let descripcion = html ? descripcionCompleta(html, resumen) : "";
    if (descripcion) {
      completas++;
    } else {
      descripcion = resumen || `${titulo}. Escultura de la categoria ${p.categoria}.`;
      resumidas++;
      console.log(`  Descripcion completa no encontrada (se usa el resumen): ${p.url}`);
    }
    if (p.preorden) enPreorden++;
    descripcion = descripcion.slice(0, 3000);

    titulos[titulo] = (titulos[titulo] || 0) + 1;

    xml += `    <item>
      <g:id>${esc(p.url.split("/").filter(Boolean).slice(-2).join("-"))}</g:id>
      <g:title>${esc(titulo)}</g:title>
      <g:description>${esc(descripcion)}</g:description>
      <g:link>${esc(p.url)}</g:link>
      <g:image_link>${esc(imagen)}</g:image_link>
      <g:availability>${p.enStock ? "in_stock" : "out_of_stock"}</g:availability>
      <g:preorder>${p.preorden ? "si" : "no"}</g:preorder>
      <g:price>${p.precio.toFixed(2)} ${p.moneda}</g:price>
      <g:brand>${MARCA}</g:brand>
      <g:product_type>${esc(p.categoria)}</g:product_type>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
    </item>\n`;
    guardados++;
    if (ejemplos.length < 3) ejemplos.push(`${titulo} | ${p.moneda} ${p.precio} | preorder: ${p.preorden ? "si" : "no"} | descripcion: ${descripcion.length} caracteres`);
  }
  xml += `  </channel>\n</rss>\n`;

  const repetidos = Object.entries(titulos).filter(([, n]) => n > 1);
  console.log(`  Sin precio (no se publican): ${sinPrecio} | Paginas de producto no leidas: ${sinPagina}`);
  console.log(`  Descripciones completas: ${completas} | Solo resumen: ${resumidas}`);
  console.log(`  Productos en pre-order: ${enPreorden}`);
  console.log(`  Nombres repetidos: ${repetidos.map(([t, n]) => `${t} (x${n})`).join(", ") || "ninguno"}`);
  console.log("  Ejemplos para revisar:");
  ejemplos.forEach((e) => console.log(`    ${e}`));

  if (guardados === 0) throw new Error("No se pudo publicar ningun producto");

  fs.mkdirSync("publicar", { recursive: true });
  fs.writeFileSync(ARCHIVO, xml);
  console.log(`fauna.xml: ${guardados} productos guardados (${(Buffer.byteLength(xml) / 1024).toFixed(0)} KB)`);
} catch (e) {
  console.log(`fauna.xml: NO se genero (${e.message}). El link mantiene la version anterior.`);
  process.exitCode = 1;
}
