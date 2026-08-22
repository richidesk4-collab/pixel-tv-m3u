const fs = require("fs");
const axios = require("axios");

// ============================================================
// PIXEL TV - GENERADOR M3U
// ============================================================

const PROVIDER_TV_URL = process.env.PROVIDER_TV_URL;
const PROVIDER_VOD_URL = process.env.PROVIDER_VOD_URL;

const proveedores = [
  {
    url: PROVIDER_TV_URL,
    tipo: "TV",
  },
  {
    url: PROVIDER_VOD_URL,
    tipo: "VOD",
  },
].filter((proveedor) => Boolean(proveedor.url));

// ============================================================
// FILTROS
// ============================================================

const filtroExclusiones = [
  // Adultos / +18
  "+18",
  "18+",
  "adult",
  "adultos",
  "xxx",
  "hot",
  "porno",
  "venus",
  "playboy",
  "sextreme",
  "redlight",
  "hustler",
  "penthouse",
  "brazzers",
  "milf",
  "erot",
  "pasion",
  "pasión",
  "pratica",
  "forbiden",
  "comedias +18",
  "eros",

  // Países / regiones
  "bolivia",
  "peru",
  "perú",
  "chile",
  "usa",
  "us |",
  "mexico",
  "méxico",
  "españa",
  "espana",
  "brasil",
  "canada",
  "canadá",
  "colombia",
  "costa rica",
  "curacao",
  "curaçao",
  "cuba",
  "ecuador",
  "guatemala",
  "haiti",
  "haití",
  "honduras",
  "jamaika",
  "jamaica",
  "nicaragua",
  "uruguay",
  "r.dominicana",
  "rep. dominicana",
  "venezuela",
  "germany",
  "italy",
  "israel",
  "marruecos",
  "netherland",
  "netherlands",
  "arabes",
  "árabes",

  // Ligas / contenido específico
  "nbl",
  "liga endesa",
];

// ============================================================
// UTILIDADES
// ============================================================

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function debeExcluir(extinf) {
  const texto = normalizarTexto(extinf);

  return filtroExclusiones.some((filtro) =>
    texto.includes(normalizarTexto(filtro))
  );
}

function extraerNombre(extinf) {
  const partes = extinf.split(",");

  if (partes.length > 1) {
    return partes.slice(1).join(",").trim();
  }

  return extinf.trim();
}

// ============================================================
// DETECTAR CATEGORÍA
// ============================================================

function detectarCategoria(extinf, tipoProveedor) {
  const texto = normalizarTexto(extinf);

  if (tipoProveedor === "TV") {
    if (
      texto.includes("deportes") ||
      texto.includes("sport") ||
      texto.includes("futbol") ||
      texto.includes("fútbol")
    ) {
      return "Deportes";
    }

    if (
      texto.includes("noticia") ||
      texto.includes("news")
    ) {
      return "Noticias";
    }

    if (
      texto.includes("infantil") ||
      texto.includes("kids") ||
      texto.includes("children")
    ) {
      return "Infantil";
    }

    return "TV";
  }

  // VOD
  if (
    texto.includes("serie") ||
    texto.includes("series")
  ) {
    return "Series";
  }

  if (
    texto.includes("pelicula") ||
    texto.includes("películas") ||
    texto.includes("movie") ||
    texto.includes("movies") ||
    texto.includes("cine")
  ) {
    return "Películas";
  }

  return "VOD";
}

// ============================================================
// PARSER M3U
// ============================================================

function parsearM3U(contenido, proveedor, tipoProveedor) {
  const lineas = contenido.split(/\r?\n/);

  const elementos = [];

  let extinfActual = null;

  for (const lineaOriginal of lineas) {
    const linea = lineaOriginal.trim();

    if (!linea) {
      continue;
    }

    if (linea.startsWith("#EXTINF:")) {
      extinfActual = linea;
      continue;
    }

    if (
      extinfActual &&
      (
        linea.startsWith("http://") ||
        linea.startsWith("https://")
      )
    ) {
      const streamUrl = linea;

      if (!debeExcluir(extinfActual)) {
        const nombre = extraerNombre(extinfActual);
        const categoria = detectarCategoria(
          extinfActual,
          tipoProveedor
        );

        elementos.push({
          nombre,
          extinf: extinfActual,
          url: streamUrl,
          proveedor,
          tipo: tipoProveedor,
          categoria,
        });
      }

      extinfActual = null;
    }
  }

  return elementos;
}

// ============================================================
// DESCARGAR PROVEEDOR
// ============================================================

async function descargarLista(url, proveedor, tipoProveedor) {
  console.log("");
  console.log("==========================================");
  console.log(`PROVEEDOR ${proveedor} - ${tipoProveedor}`);
  console.log("==========================================");

  console.log("Descargando lista...");

  const inicio = Date.now();

  const response = await axios.get(url, {
    timeout: 120000,
    responseType: "text",
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  const tiempo = Date.now() - inicio;

  console.log(`HTTP STATUS: ${response.status}`);
  console.log(`TIEMPO: ${tiempo} ms`);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `El proveedor respondió HTTP ${response.status}`
    );
  }

  const contenido = String(response.data || "");

  if (!contenido.trim()) {
    throw new Error(
      "El proveedor devolvió una respuesta vacía."
    );
  }

  const inicioContenido = contenido
    .replace(/^\uFEFF/, "")
    .trimStart()
    .slice(0, 500)
    .toLowerCase();

  // ==========================================================
  // DETECTAR RESPUESTAS INCORRECTAS
  // ==========================================================

  if (
    inicioContenido.startsWith("<!doctype html") ||
    inicioContenido.startsWith("<html") ||
    inicioContenido.startsWith("{") ||
    inicioContenido.startsWith("[") ||
    inicioContenido.includes("<script") ||
    inicioContenido.includes("require(") ||
    inicioContenido.includes("const axios") ||
    inicioContenido.includes("const fs")
  ) {
    throw new Error(
      "La respuesta del proveedor no parece ser una lista M3U válida."
    );
  }

  if (!contenido.includes("#EXTINF:")) {
    throw new Error(
      "La respuesta no contiene entradas #EXTINF."
    );
  }

  const elementos = parsearM3U(
    contenido,
    proveedor,
    tipoProveedor
  );

  console.log(
    `Elementos válidos después del filtro: ${elementos.length}`
  );

  return elementos;
}

// ============================================================
// GENERAR M3U
// ============================================================

function generarM3U(elementos) {
  const salida = [];

  salida.push("#EXTM3U");

  for (const elemento of elementos) {
    let extinf = elemento.extinf;

    // Agregar información útil sin romper el EXTINF original.
    if (!extinf.includes('group-title="')) {
      extinf = extinf.replace(
        "#EXTINF:",
        `#EXTINF: group-title="${elemento.categoria}",`
      );
    }

    salida.push(extinf);
    salida.push(elemento.url);
  }

  return salida.join("\n") + "\n";
}

// ============================================================
// VALIDAR M3U FINAL
// ============================================================

function validarM3U(contenido) {
  const texto = contenido.trim();

  if (!texto.startsWith("#EXTM3U")) {
    throw new Error(
      "VALIDACIÓN FALLIDA: el archivo no comienza con #EXTM3U."
    );
  }

  if (!texto.includes("#EXTINF:")) {
    throw new Error(
      "VALIDACIÓN FALLIDA: no existen entradas #EXTINF."
    );
  }

  const lineas = texto.split(/\r?\n/);

  let extinfPendiente = false;
  let entradas = 0;

  for (const linea of lineas) {
    const actual = linea.trim();

    if (!actual) {
      continue;
    }

    if (actual.startsWith("#EXTINF:")) {
      extinfPendiente = true;
      continue;
    }

    if (
      extinfPendiente &&
      (
        actual.startsWith("http://") ||
        actual.startsWith("https://")
      )
    ) {
      entradas++;
      extinfPendiente = false;
    }
  }

  if (extinfPendiente) {
    throw new Error(
      "VALIDACIÓN FALLIDA: existe un #EXTINF sin URL."
    );
  }

  if (entradas === 0) {
    throw new Error(
      "VALIDACIÓN FALLIDA: no se encontraron streams válidos."
    );
  }

  return entradas;
}

// ============================================================
// PROCESO PRINCIPAL
// ============================================================

async function main() {
  console.log("==========================================");
  console.log("       PIXEL TV - GENERADOR M3U");
  console.log("==========================================");

  console.log(
    `Proveedor TV configurado: ${PROVIDER_TV_URL ? "SI" : "NO"}`
  );

  console.log(
    `Proveedor VOD configurado: ${PROVIDER_VOD_URL ? "SI" : "NO"}`
  );

  if (proveedores.length === 0) {
    throw new Error(
      "No hay proveedores configurados. Verificá PROVIDER_TV_URL y PROVIDER_VOD_URL en GitHub Secrets."
    );
  }

  const todosLosElementos = [];

  // ==========================================================
  // DESCARGAR PROVEEDORES
  // ==========================================================

  for (let i = 0; i < proveedores.length; i++) {
    const proveedor = proveedores[i];

    try {
      const elementos = await descargarLista(
        proveedor.url,
        i + 1,
        proveedor.tipo
      );

      todosLosElementos.push(...elementos);
    } catch (error) {
      console.error(
        `ERROR PROVEEDOR ${i + 1} (${proveedor.tipo}):`,
        error.message
      );
    }
  }

  // ==========================================================
  // COMPROBAR QUE SE OBTUVO CONTENIDO
  // ==========================================================

  if (todosLosElementos.length === 0) {
    throw new Error(
      "Los proveedores respondieron, pero no se obtuvo ningún elemento válido."
    );
  }

  // ==========================================================
  // ELIMINAR DUPLICADOS
  // ==========================================================

  const canalesUnicos = new Map();

  for (const elemento of todosLosElementos) {
    const clave =
      normalizarTexto(elemento.nombre) +
      "|" +
      normalizarTexto(elemento.categoria);

    if (!canalesUnicos.has(clave)) {
      canalesUnicos.set(clave, elemento);
    }
  }

  const elementosFinales =
    Array.from(canalesUnicos.values());

  // ==========================================================
  // ESTADÍSTICAS POR TIPO
  // ==========================================================

  const cantidadTV =
    elementosFinales.filter(
      (elemento) => elemento.tipo === "TV"
    ).length;

  const cantidadVOD =
    elementosFinales.filter(
      (elemento) => elemento.tipo === "VOD"
    ).length;

  const cantidadPeliculas =
    elementosFinales.filter(
      (elemento) => elemento.categoria === "Películas"
    ).length;

  const cantidadSeries =
    elementosFinales.filter(
      (elemento) => elemento.categoria === "Series"
    ).length;

  // ==========================================================
  // GENERAR
  // ==========================================================

  const contenidoM3U =
    generarM3U(elementosFinales);

  // ==========================================================
  // VALIDAR
  // ==========================================================

  const cantidadFinal =
    validarM3U(contenidoM3U);

  // ==========================================================
  // GUARDAR
  // ==========================================================

  fs.writeFileSync(
    "lista_limpia.m3u",
    contenidoM3U,
    "utf8"
  );

  // ==========================================================
  // ESTADÍSTICAS
  // ==========================================================

  const duplicadosEliminados =
    todosLosElementos.length -
    elementosFinales.length;

  console.log("");
  console.log("==========================================");
  console.log("          PROCESO COMPLETADO");
  console.log("==========================================");

  console.log(
    `Elementos procesados: ${todosLosElementos.length}`
  );

  console.log(
    `Duplicados eliminados: ${duplicadosEliminados}`
  );

  console.log(
    `Elementos finales: ${elementosFinales.length}`
  );

  console.log(
    `TV: ${cantidadTV}`
  );

  console.log(
    `VOD: ${cantidadVOD}`
  );

  console.log(
    `Películas: ${cantidadPeliculas}`
  );

  console.log(
    `Series: ${cantidadSeries}`
  );

  console.log(
    `Entradas M3U validadas: ${cantidadFinal}`
  );

  console.log(
    "Archivo generado: lista_limpia.m3u"
  );

  console.log("==========================================");
}

// ============================================================
// ERROR FATAL
// ============================================================

main().catch((error) => {
  console.error("");
  console.error("==========================================");
  console.error("ERROR FATAL");
  console.error("==========================================");
  console.error(error.message);

  process.exit(1);
});
