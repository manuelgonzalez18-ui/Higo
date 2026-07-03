// Imágenes curadas para Higo Shop.
//
// Las tiendas y productos reales usan su propia foto (image_url subido a
// Supabase Storage por el comercio/admin). Cuando una tienda o producto NO
// tiene foto configurada, mostramos una imagen representativa de su categoría
// en vez de un emoji plano, para que el catálogo se vea real y terminado.
//
// Las URLs son de Unsplash (CDN estable; la CSP permite `img-src https:`).
// Si alguna fallara en runtime, el componente degrada al emoji placeholder
// vía onError, así que nunca queda un hueco roto.

const U = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=600&q=70`;

// Pools por categoría de tienda. Varias opciones por categoría para que
// tiendas distintas no se vean idénticas (se elige de forma estable por id).
const STORE_IMAGES = {
  restaurant: [
    U('photo-1517248135467-4c7edcad34c4'), // mesa servida
    U('photo-1555396273-367ea4eb4db5'),    // comida casera
    U('photo-1504674900247-0877df9cc836'),  // plato gourmet
  ],
  pharmacy: [
    U('photo-1587854692152-cbe660dbde88'),  // estantería farmacia
    U('photo-1607619056574-7b8d3ee536b2'),  // mostrador farmacia
  ],
  bakery: [
    U('photo-1509440159596-0249088772ff'),  // panadería
    U('photo-1608198093002-ad4e005484ec'),  // pan artesanal
  ],
  grocery: [
    U('photo-1542838132-92c53300491e'),     // mercado / abastos
    U('photo-1578916171728-46686eac8d58'),  // víveres
  ],
  cafe: [
    U('photo-1495474472287-4d71bcdd2085'),  // café
    U('photo-1521017432531-fbd92d768814'),  // cafetería
  ],
};

// Pools por categoría de producto (etiquetas en español que usa el menú).
// La clave se normaliza (minúsculas, sin acentos) antes de buscar.
const PRODUCT_IMAGES = {
  arepas: U('photo-1626700051175-6818013e1d4f'),
  cachapas: U('photo-1626700051175-6818013e1d4f'),
  especiales: U('photo-1541014741259-de529411b96a'),
  pollos: U('photo-1598103442097-8b74394b95c6'),
  platos: U('photo-1546069901-ba9599a7e63c'),
  ensaladas: U('photo-1512621776951-a57141f2eefd'),
  extras: U('photo-1573080496219-bb080dd4f877'),
  bebidas: U('photo-1600271886742-f049cd451bba'),
  jugos: U('photo-1600271886742-f049cd451bba'),
  panes: U('photo-1509440159596-0249088772ff'),
  dulces: U('photo-1558961363-fa8fdf82db35'),
  medicamentos: U('photo-1584308666744-24d5c474f2ae'),
  vitaminas: U('photo-1550572017-edd951b55104'),
  'cuidado personal': U('photo-1556228578-8c89e6adf883'),
  proteccion: U('photo-1584634731339-252c581abfc5'),
};

const GENERIC_PRODUCT = U('photo-1504674900247-0877df9cc836');

// Hash estable de un string → entero no negativo. Para elegir siempre la
// misma imagen del pool para una misma tienda.
function stableHash(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Imagen de una tienda: su foto propia si existe, si no una imagen curada de
 * su categoría (estable por id). Devuelve null si no hay nada razonable, para
 * que el componente muestre el emoji placeholder.
 */
export function getStoreImage(store) {
  if (!store) return null;
  const own = store.imageUrl || store.image;
  if (own) return own;
  const pool = STORE_IMAGES[store.category];
  if (!pool || pool.length === 0) return null;
  return pool[stableHash(store.id || store.name) % pool.length];
}

/**
 * Imagen de un producto: su foto propia si existe, si no una imagen curada de
 * su categoría de menú, con fallback a una imagen genérica de comida.
 */
export function getProductImage(product) {
  if (!product) return null;
  const own = product.imageUrl || product.image;
  if (own) return own;
  const key = normalizeKey(product.category);
  return PRODUCT_IMAGES[key] || GENERIC_PRODUCT;
}
