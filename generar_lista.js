const fs = require("fs");
const axios = require("axios");

// ============================================================
// PIXEL TV - GENERADOR Y VERIFICADOR M3U
// ============================================================
//
// Secrets esperados:
//
// PROVIDER_TV_URL  = M3U de TV en vivo
// PROVIDER_VOD_URL = M3U de películas + series
//
// Salidas:
//
// lista_limpia.m3u
// reporte.json
// ============================================================

const PROVIDERS = [
  {
    name: "TV",
    type: "LIVE",
    url: process.env.PROVIDER_TV_URL,
  },
  {
    name: "VOD",
    type: "VOD_SERIES",
    url: process.env.PROVIDER_VOD_URL,
  },
].filter((provider) => Boolean(provider.url));

// ============================================================
// CONFIGURACIÓN
// ============================================================

const DOWNLOAD_TIMEOUT = 120000;
const VERIFY_TIMEOUT = 8000;

// Cantidad máxima de verificaciones simultáneas.
// Se mantiene moderada para evitar saturar proveedores.
const VERIFY_CONCURRENCY = 20;

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

function debeExcluir(texto) {
  const normalizado = normalizarTexto(texto);

  return filtroExclusiones.some((filtro) =>
    normalizado.includes(normalizarTexto(filtro))
  );
}

function extraerNombre(extinf) {
  const partes = extinf.split(",");

  if (partes.length > 1) {
    return partes.slice(1).join(",").trim();
  }

  return extinf.trim();
}

function extraerAtributo(extinf, atributo) {
  const regex = new RegExp(
    `${atributo}="([^"]*)"`,
    "i"
  );

  const match = extinf.match(regex);

  return match ? match[1].trim() : "";
}

function detectarTipo(extinf, url, proveedorTipo) {
  const texto = normalizarTexto(
    `${extinf} ${url}`
  );

  // Si el proveedor es exclusivamente TV,
  // todo se considera LIVE.
  if (proveedorTipo === "LIVE") {
    return "LIVE";
  }

  // Intentamos identificar series/episodios.
  const indicadoresSeries = [
    "series",
    "serie",
    "season",
    "temporada",
    "episode",
    "episodio",
    "episod",
    "s01",
    "s02",
    "s03",
    "s04",
    "s05",
    "s06",
    "s07",
    "s08",
    "s09",
    "s10",
  ];

  if (
    indicadoresSeries.some((indicador) =>
      texto.includes(indicador)
    )
  ) {
    return "SERIES";
  }

  // También reconocemos estructuras habituales
  // de URLs IPTV para series.
  if (texto.includes("/series/")) {
    return "SERIES";
  }

  // Si no podemos determinar que es una serie,
  // queda como película/VOD.
  return "MOVIE";
}

// ============================================================
// PARSER M3U
// ============================================================

function parsearM3U(contenido, proveedor) {
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
      (linea.startsWith("http://") ||
        linea.startsWith("https://"))
    ) {
      const streamUrl = linea;

      const nombre = extraerNombre(extinfActual);

      const grupo = extraerAtributo(
        extinfActual,
        "group-title"
      );

      const tvgId = extraerAtributo(
        extinfActual,
        "tvg-id"
      );

      const tvgName = extraerAtributo(
        extinfActual,
        "tvg-name"
      );

      const tvgLogo = extraerAtributo(
        extinfActual,
        "tvg-logo"
      );

      const textoFiltro = [
        extinfActual,
        nombre,
        grupo,
        tvgName,
        streamUrl,
      ].join(" ");

      if (!debeExcluir(textoFiltro)) {
        const tipo = detectarTipo(
          extinfActual,
          streamUrl,
          proveedor.type
        );

        elementos.push({
          nombre,
          extinf: extinfActual,
          url: streamUrl,
          proveedor: proveedor.name,
          tipo,
          grupo,
          tvgId,
          tvgName,
          tvgLogo,
        });
      }

      extinfActual = null;
    }
  }

  return elementos;
}

// ============================================================
// VALIDACIÓN DE RESPUESTA DEL PROVEEDOR
// ============================================================

function validarPayloadM3U(contenido) {
  const limpio = String(contenido || "")
    .replace(/^\uFEFF/, "")
    .trimStart();

  if (!limpio) {
    throw new Error(
      "El proveedor devolvió una respuesta vacía."
    );
  }

  const inicio = limpio
    .slice(0, 500)
    .toLowerCase();

  if (
    inicio.startsWith("<!doctype html") ||
    inicio.startsWith("<html") ||
    inicio.startsWith("{") ||
    inicio.startsWith("[") ||
    inicio.includes("<script") ||
    inicio.includes("require(") ||
    inicio.includes("const axios") ||
    inicio.includes("const fs")
  ) {
    throw new Error(
      "La respuesta no parece ser una lista M3U válida."
    );
  }

  if (!limpio.includes("#EXTINF:")) {
    throw new Error(
      "La respuesta no contiene entradas #EXTINF."
    );
  }

  return limpio;
}

// ============================================================
// DESCARGAR PROVEEDOR
// ============================================================

async function descargarLista(proveedor) {
  console.log("\n==========================================");
  console.log(`PROVEEDOR: ${proveedor.name}`);
  console.log(`TIPO: ${proveedor.type}`);
  console.log("==========================================");

  console.log("Descargando lista...");

  const inicio = Date.now();

  const response = await axios.get(proveedor.url, {
    timeout: DOWNLOAD_TIMEOUT,
    responseType: "text",
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  const tiempo = Date.now() - inicio;

  console.log(`HTTP STATUS: ${response.status}`);
  console.log(`TIEMPO: ${tiempo} ms`);

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new Error(
      `El proveedor respondió HTTP ${response.status}`
    );
  }

  const contenido = validarPayloadM3U(
    response.data
  );

  const elementos = parsearM3U(
    contenido,
    proveedor
  );

  console.log(
    `Elementos válidos después del filtro: ${elementos.length}`
  );

  return elementos;
}

// ============================================================
// SANITIZAR URL PARA LOGS
// ============================================================

function urlSegura(url) {
  try {
    const parsed = new URL(url);

    const parametrosSensibles = [
      "password",
      "pass",
      "pwd",
      "token",
      "auth",
      "username",
      "user",
    ];

    for (const parametro of parametrosSensibles) {
      if (parsed.searchParams.has(parametro)) {
        parsed.searchParams.set(
          parametro,
          "***"
        );
      }
    }

    return parsed.toString();
  } catch {
    return "***";
  }
}

// ============================================================
// VERIFICACIÓN DE STREAM
// ============================================================
//
// Objetivo:
// comprobar rápidamente si la URL responde.
//
// NO descargamos películas ni episodios completos.
//
// Estados:
//
// ONLINE
// OFFLINE
// UNKNOWN
// ============================================================

async function verificarStream(elemento) {
  const headers = {
    "User-Agent":
      "PixelTV-M3U-Checker/1.0",
    Accept: "*/*",
    Range: "bytes=0-1024",
  };

  try {
    let response;

    try {
      response = await axios.get(
        elemento.url,
        {
          timeout: VERIFY_TIMEOUT,
          responseType: "stream",
          headers,
          maxContentLength: 2048,
          maxBodyLength: 2048,
          validateStatus: () => true,
        }
      );
    } catch (getError) {
      // Algunos servidores rechazan GET/Range.
      // Intentamos HEAD como segunda comprobación.
      response = await axios.head(
        elemento.url,
        {
          timeout: VERIFY_TIMEOUT,
          headers: {
            "User-Agent":
              "PixelTV-M3U-Checker/1.0",
          },
          validateStatus: () => true,
        }
      );
    }

    const status = response.status;

    // Cerramos inmediatamente cualquier stream HTTP.
    if (
      response.data &&
      typeof response.data.destroy === "function"
    ) {
      response.data.destroy();
    }

    if (
      status >= 200 &&
      status < 300
    ) {
      return {
        estado: "ONLINE",
        httpStatus: status,
      };
    }

    // 206 Partial Content también es una respuesta
    // perfectamente válida para streaming.
    if (status === 206) {
      return {
        estado: "ONLINE",
        httpStatus: status,
      };
    }

    // Algunos servidores IPTV requieren autorización,
    // por lo que no podemos afirmar que el contenido
    // esté muerto solamente por un 401/403.
    if (
      status === 401 ||
      status === 403 ||
      status === 405 ||
      status === 429
    ) {
      return {
        estado: "UNKNOWN",
        httpStatus: status,
      };
    }

    if (
      status === 404 ||
      status === 410
    ) {
      return {
        estado: "OFFLINE",
        httpStatus: status,
      };
    }

    if (status >= 500) {
      return {
        estado: "UNKNOWN",
        httpStatus: status,
      };
    }

    return {
      estado: "UNKNOWN",
      httpStatus: status,
    };
  } catch (error) {
    const code = error.code || "";

    if (
      code === "ECONNABORTED" ||
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED"
    ) {
      return {
        estado: "OFFLINE",
        httpStatus: null,
        error: code,
      };
    }

    return {
      estado: "UNKNOWN",
      httpStatus: null,
      error: code || "NETWORK_ERROR",
    };
  }
}

// ============================================================
// VERIFICACIÓN EN PARALELO CON CONCURRENCIA LIMITADA
// ============================================================

async function verificarTodos(elementos) {
  console.log("\n==========================================");
  console.log("VERIFICACIÓN DE STREAMS");
  console.log("==========================================");

  console.log(
    `Streams a comprobar: ${elementos.length}`
  );

  console.log(
    `Concurrencia: ${VERIFY_CONCURRENCY}`
  );

  let completados = 0;

  const resultados = new Array(
    elementos.length
  );

  async function worker() {
    while (true) {
      const indice = siguienteIndice++;

      if (indice >= elementos.length) {
        return;
      }

      const elemento = elementos[indice];

      const resultado =
        await verificarStream(elemento);

      resultados[indice] = {
        ...elemento,
        estado: resultado.estado,
        httpStatus: resultado.httpStatus || null,
        error: resultado.error || null,
      };

      completados++;

      if (
        completados % 50 === 0 ||
        completados === elementos.length
      ) {
        console.log(
          `Verificados: ${completados}/${elementos.length}`
        );
      }
    }
  }

  let siguienteIndice = 0;

  const cantidadWorkers = Math.min(
    VERIFY_CONCURRENCY,
    elementos.length
  );

  const workers = [];

  for (
    let i = 0;
    i < cantidadWorkers;
    i++
  ) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return resultados;
}

// ============================================================
// ELIMINAR DUPLICADOS
// ============================================================

function eliminarDuplicados(elementos) {
  const mapa = new Map();

  for (const elemento of elementos) {
    const clave = [
      normalizarTexto(elemento.nombre),
      normalizarTexto(elemento.url),
    ].join("|");

    if (!mapa.has(clave)) {
      mapa.set(clave, elemento);
    }
  }

  return Array.from(mapa.values());
}

// ============================================================
// GENERAR M3U
// ============================================================

function generarM3U(elementos) {
  const salida = [];

  salida.push("#EXTM3U");

  for (const elemento of elementos) {
    salida.push(elemento.extinf);
    salida.push(elemento.url);
  }

  return (
    salida.join("\n") + "\n"
  );
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

  const lineas =
    texto.split(/\r?\n/);

  let extinfPendiente = false;
  let entradas = 0;

  for (const linea of lineas) {
    const actual = linea.trim();

    if (!actual) {
      continue;
    }

    if (
      actual.startsWith("#EXTINF:")
    ) {
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
// ESTADÍSTICAS
// ============================================================

function crearEstadisticas(elementos) {
  const estadisticas = {
    generadoEn: new Date().toISOString(),

    total: elementos.length,

    live: {
      total: 0,
      online: 0,
      offline: 0,
      unknown: 0,
    },

    movies: {
      total: 0,
      online: 0,
      offline: 0,
      unknown: 0,
    },

    series: {
      total: 0,
      online: 0,
      offline: 0,
      unknown: 0,
    },

    proveedores: {},
  };

  for (const elemento of elementos) {
    let categoria;

    if (elemento.tipo === "LIVE") {
      categoria = estadisticas.live;
    } else if (
      elemento.tipo === "MOVIE"
    ) {
      categoria = estadisticas.movies;
    } else {
      categoria = estadisticas.series;
    }

    categoria.total++;

    if (elemento.estado === "ONLINE") {
      categoria.online++;
    } else if (
      elemento.estado === "OFFLINE"
    ) {
      categoria.offline++;
    } else {
      categoria.unknown++;
    }

    if (
      !estadisticas.proveedores[
        elemento.proveedor
      ]
    ) {
      estadisticas.proveedores[
        elemento.proveedor
      ] = {
        total: 0,
        online: 0,
        offline: 0,
        unknown: 0,
      };
    }

    const proveedor =
      estadisticas.proveedores[
        elemento.proveedor
      ];

    proveedor.total++;

    if (
      elemento.estado === "ONLINE"
    ) {
      proveedor.online++;
    } else if (
      elemento.estado === "OFFLINE"
    ) {
      proveedor.offline++;
    } else {
      proveedor.unknown++;
    }
  }

  return estadisticas;
}

// ============================================================
// PROCESO PRINCIPAL
// ============================================================

async function main() {
  console.log(
    "=========================================="
  );

  console.log(
    "       PIXEL TV - GENERADOR M3U"
  );

  console.log(
    "=========================================="
  );

  if (PROVIDERS.length === 0) {
    throw new Error(
      "No hay proveedores configurados. Revisa PROVIDER_TV_URL y PROVIDER_VOD_URL."
    );
  }

  console.log(
    `Proveedores configurados: ${PROVIDERS.length}`
  );

  const todosLosElementos = [];

  // ==========================================================
  // DESCARGAR PROVEEDORES
  // ==========================================================

  for (const proveedor of PROVIDERS) {
    try {
      const elementos =
        await descargarLista(proveedor);

      todosLosElementos.push(
        ...elementos
      );
    } catch (error) {
      console.error(
        `ERROR ${proveedor.name}: ${error.message}`
      );
    }
  }

  if (
    todosLosElementos.length === 0
  ) {
    throw new Error(
      "No se obtuvo ningún elemento válido de los proveedores."
    );
  }

  console.log("\n==========================================");
  console.log("ELEMENTOS ANTES DE DUPLICADOS");
  console.log("==========================================");

  console.log(
    `Total: ${todosLosElementos.length}`
  );

  // ==========================================================
  // DUPLICADOS
  // ==========================================================

  const elementosUnicos =
    eliminarDuplicados(
      todosLosElementos
    );

  console.log(
    `Duplicados eliminados: ${
      todosLosElementos.length -
      elementosUnicos.length
    }`
  );

  console.log(
    `Elementos únicos: ${elementosUnicos.length}`
  );

  // ==========================================================
  // VERIFICACIÓN
  // ==========================================================

  const verificados =
    await verificarTodos(
      elementosUnicos
    );

  // ==========================================================
  // ESTADÍSTICAS
  // ==========================================================

  const estadisticas =
    crearEstadisticas(
      verificados
    );

  console.log("\n==========================================");
  console.log("RESULTADOS DE VERIFICACIÓN");
  console.log("==========================================");

  console.log(
    `LIVE  → Total: ${estadisticas.live.total} | Online: ${estadisticas.live.online} | Offline: ${estadisticas.live.offline} | Unknown: ${estadisticas.live.unknown}`
  );

  console.log(
    `MOVIE → Total: ${estadisticas.movies.total} | Online: ${estadisticas.movies.online} | Offline: ${estadisticas.movies.offline} | Unknown: ${estadisticas.movies.unknown}`
  );

  console.log(
    `SERIES → Total: ${estadisticas.series.total} | Online: ${estadisticas.series.online} | Offline: ${estadisticas.series.offline} | Unknown: ${estadisticas.series.unknown}`
  );

  // ==========================================================
  // CONSERVAR ONLINE + UNKNOWN
  // ==========================================================
  //
  // NO eliminamos automáticamente 401/403/429.
  // Algunos proveedores bloquean verificadores externos
  // aunque la reproducción real en la app funcione.
  //
  // Eliminamos solamente OFFLINE.
  // ==========================================================

  const elementosFinales =
    verificados.filter(
      (elemento) =>
        elemento.estado !== "OFFLINE"
    );

  if (
    elementosFinales.length === 0
  ) {
    throw new Error(
      "La verificación dejó 0 elementos. No se reemplazará la lista anterior."
    );
  }

  // ==========================================================
  // GENERAR M3U
  // ==========================================================

  const contenidoM3U =
    generarM3U(
      elementosFinales
    );

  // ==========================================================
  // VALIDAR
  // ==========================================================

  const cantidadFinal =
    validarM3U(
      contenidoM3U
    );

  // ==========================================================
  // GUARDAR LISTA
  // ==========================================================

  fs.writeFileSync(
    "lista_limpia.m3u",
    contenidoM3U,
    "utf8"
  );

  // ==========================================================
  // REPORTE
  // ==========================================================

  const reporte = {
    ...estadisticas,

    listaFinal: {
      elementos: elementosFinales.length,
      entradasM3U: cantidadFinal,
    },

    eliminadosOffline:
      verificados.length -
      elementosFinales.length,
  };

  fs.writeFileSync(
    "reporte.json",
    JSON.stringify(
      reporte,
      null,
      2
    ),
    "utf8"
  );

  // ==========================================================
  // FINAL
  // ==========================================================

  console.log(
    "\n=========================================="
  );

  console.log(
    "          PROCESO COMPLETADO"
  );

  console.log(
    "=========================================="
  );

  console.log(
    `Elementos originales: ${todosLosElementos.length}`
  );

  console.log(
    `Elementos únicos: ${elementosUnicos.length}`
  );

  console.log(
    `Offline eliminados: ${
      verificados.length -
      elementosFinales.length
    }`
  );

  console.log(
    `Elementos finales: ${elementosFinales.length}`
  );

  console.log(
    `Entradas M3U validadas: ${cantidadFinal}`
  );

  console.log(
    "Archivo generado: lista_limpia.m3u"
  );

  console.log(
    "Reporte generado: reporte.json"
  );

  console.log(
    "=========================================="
  );
}

// ============================================================
// ERROR FATAL
// ============================================================

main().catch((error) => {
  console.error(
    "\n=========================================="
  );

  console.error(
    "ERROR FATAL"
  );

  console.error(
    "=========================================="
  );

  console.error(
    error.message
  );

  process.exit(1);
});
