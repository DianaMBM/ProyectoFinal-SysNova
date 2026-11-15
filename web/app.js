

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let estado = null;
let temporizador = null;      // ejecución automática de la planificación
let vistaComparada = null;    // resultado de la comparación que se está mirando
let largoGantt = 0;           // para animar solo el bloque nuevo del Gantt

const COLOR_ESTADO = {
  "Nuevo": "var(--e-nuevo)",
  "Listo": "var(--e-listo)",
  "Ejecución": "var(--e-ejecucion)",
  "Bloqueado": "var(--e-bloqueado)",
  "Terminado": "var(--e-terminado)",
};


function colorPid(pid) {
  if (pid <= 0) return "#CBD2DE";
  const tono = (pid * 137.508 + 210) % 360;
  return `hsl(${tono.toFixed(0)} 62% 46%)`;
}

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 2) => (typeof v === "number" ? v.toFixed(d) : "—");
const guion = (v) => (v < 0 ? "—" : v);
const nombreProc = (p) => (p.nombre === p.etiqueta ? p.etiqueta : `${p.etiqueta} ${p.nombre}`);

// comunicación con Java

async function pedirEstado() {
  const r = await fetch("/api/estado");
  estado = await r.json();
  pintar();
}

async function accion(op, datos = {}, { silencio = false } = {}) {
  const cuerpo = new URLSearchParams({ op, ...datos });
  let r;
  try {
    r = await fetch("/api/accion", { method: "POST", body: cuerpo });
  } catch {
    aviso("No hay conexión con el servidor Java. Verifique que ServidorWeb siga abierto.", true);
    detenerAuto();
    return null;
  }
  const json = await r.json();
  estado = json.estado;
  pintar();
  if (!json.ok) aviso(json.error, true);
  else if (json.mensaje && !silencio) aviso(json.mensaje);
  return json.ok ? json : null;
}

function aviso(texto, error = false) {
  const t = document.createElement("div");
  t.className = "toast" + (error ? " error" : "");
  t.textContent = texto;
  $("#avisos").appendChild(t);
  setTimeout(() => t.remove(), error ? 6000 : 3200);
}

// navegación

$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  $$("#nav button").forEach((x) => x.classList.toggle("activo", x === b));
  $$(".seccion").forEach((s) => s.classList.toggle("visible", s.id === b.dataset.seccion));
  window.scrollTo({ top: 0 });
});

//  pintado general

function pintar() {
  if (!estado) return;
  pintarFranja();
  pintarProcesos();
  pintarSelectores();
  pintarPlanificacion();
  pintarMemoria();
  pintarComunicacion();
  pintarMonitoreo();
  pintarExcepciones();
  const b = estado.bitacora;
  $("#ultimoEvento").textContent = b.length ? b[b.length - 1] : "Listo.";
}

function estadoHtml(nombre) {
  return `<span class="estado" style="--c:${COLOR_ESTADO[nombre] || "var(--gris)"}">${esc(nombre)}</span>`;
}

function pidHtml(p) {
  return `<span class="pid" style="--c:${colorPid(p.pid)}">${esc(p.etiqueta ?? "P" + p.pid)}</span>`;
}

function pintarFranja() {
  $("#fReloj").textContent = estado.reloj;
  const enCpu = estado.procesos.find((p) => p.pid === estado.enCpu);
  $("#fCpu").innerHTML = enCpu ? `<span class="pid" style="--c:${colorPid(enCpu.pid)}">${esc(nombreProc(enCpu))}</span>` : "Ociosa";
  const m = estado.memoria;
  $("#fMemBarra").style.width = (m.usadas * 100 / m.total) + "%";
  $("#fMemTexto").textContent = `${m.usadas} / ${m.total} páginas`;

  const cuenta = {};
  estado.procesos.forEach((p) => (cuenta[p.estado] = (cuenta[p.estado] || 0) + 1));
  $("#fEstados").innerHTML = Object.keys(COLOR_ESTADO)
    .map((e) => `<span class="chip" style="--c:${COLOR_ESTADO[e]}">${e} ${cuenta[e] || 0}</span>`)
    .join("");
}

//  procesos

function pintarProcesos() {
  const filas = estado.procesos.map((p) => `
    <tr data-pid="${p.pid}" class="${p.estado === "Terminado" ? "terminado" : ""}">
      <td>${pidHtml(p)}</td>
      <td>${esc(p.nombre)}</td>
      <td>${p.prioridad}${p.prioridad !== p.prioridadBase ? ` <small class="sutil">(base ${p.prioridadBase})</small>` : ""}</td>
      <td>${p.llegada}</td>
      <td>${p.rafaga}</td>
      <td>${p.es}</td>
      <td>${p.paginas}</td>
      <td>(${p.maxRecursos.join(", ")})</td>
      <td>${estadoHtml(p.estado)}</td>
      <td>${p.tieneMemoria ? "Base " + p.base : "—"}</td>
      <td>${p.estado !== "Terminado" ? `<button class="sec mini" data-terminar="${p.pid}">Terminar</button>` : ""}</td>
    </tr>`).join("");
  $("#tablaProcesos tbody").innerHTML = filas;
  $("#sinProcesos").hidden = estado.procesos.length > 0;
}

$("#tablaProcesos").addEventListener("click", (e) => {
  const terminar = e.target.closest("[data-terminar]");
  if (terminar) {
    accion("terminar", { pid: terminar.dataset.terminar });
    return;
  }
  const fila = e.target.closest("tr[data-pid]");
  if (fila) mostrarPcb(Number(fila.dataset.pid));
});

function mostrarPcb(pid) {
  const p = estado.procesos.find((x) => x.pid === pid);
  if (!p) return;
  $("#pcbTitulo").textContent = `PCB de ${nombreProc(p)}`;
  const datos = [
    ["Estado", estadoHtml(p.estado)],
    ["Motivo de bloqueo", esc(p.motivo) || "—"],
    ["Última causa", esc(p.causa)],
    ["Prioridad actual / base", `${p.prioridad} / ${p.prioridadBase}`],
    ["Llegada", p.llegada],
    ["Ráfaga CPU (restante)", `${p.rafaga} (${p.restante})`],
    ["Ráfaga E/S", p.es],
    ["Páginas", p.paginas],
    ["Memoria", p.tieneMemoria ? `base ${p.base}, hasta ${p.base + p.paginas - 1}` : "sin asignar"],
    ["Recursos máx. (I, D, P)", `(${p.maxRecursos.join(", ")})`],
    ["Recursos asignados", `(${p.asignados.join(", ")})`],
    ["Tiempo en espera", p.espera],
    ["Tiempo bloqueado", p.bloqueado],
    ["Primer despacho", guion(p.inicio)],
    ["Fin", guion(p.fin)],
  ];
  $("#pcbDatos").innerHTML = datos.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("#pcb").showModal();
}

$("#btnEscenario").addEventListener("click", () => {
  if (estado.procesos.length && !confirm("El escenario reemplaza los procesos actuales. ¿Continuar?")) return;
  detenerAuto();
  vistaComparada = null;
  accion("cargar", { escenario: $("#escenario").value });
});

$("#btnAleatorios").addEventListener("click", () => accion("aleatorios", { cantidad: $("#cantAleatorios").value }));

$("#btnVaciar").addEventListener("click", () => {
  if (!confirm("Se eliminarán todos los procesos. ¿Continuar?")) return;
  detenerAuto();
  vistaComparada = null;
  accion("vaciar");
});

$("#archivo").addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  const texto = await archivo.text();
  const tipo = archivo.name.toLowerCase().endsWith(".json") ? "json" : "csv";
  detenerAuto();
  await accion("importar", { tipo, texto });
  e.target.value = "";
});

$("#formCrear").addEventListener("submit", (e) => {
  e.preventDefault();
  accion("crear", Object.fromEntries(new FormData(e.target)));
});

// selectores de proceso compartidos

function pintarSelectores() {
  const vivos = estado.procesos.filter((p) => p.estado !== "Terminado");
  $$(".selProceso").forEach((sel) => {
    const previo = sel.value;
    const lista = sel.id === "excProceso" ? estado.procesos : vivos;
    sel.innerHTML = lista.map((p) => `<option value="${p.pid}">${esc(nombreProc(p))}</option>`).join("");
    if (lista.some((p) => String(p.pid) === previo)) sel.value = previo;
    else if (sel.id === "ipcB" && lista.length > 1) sel.value = lista[1].pid;
  });
}

// planificación

function configPlan() {
  return {
    algoritmo: $("#algoritmo").value,
    quantum: $("#quantum").value,
    aging: $("#aging").value,
    limitar: $("#limitar").checked,
  };
}

let algoritmosListos = false;
function pintarPlanificacion() {
  if (!algoritmosListos) {
    $("#algoritmo").innerHTML = estado.algoritmos.map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join("");
    algoritmosListos = true;
  }
  if (!temporizador && document.activeElement?.closest(".herramientas") == null) {
    $("#algoritmo").value = estado.algoritmo;
    $("#quantum").value = estado.quantum;
    $("#aging").value = estado.aging;
    $("#limitar").checked = estado.limitar;
  }

  const vista = vistaComparada || estado.vista;
  pintarGantt(vista);
  pintarComparacion();
}

function pintarGantt(vista) {
  const cont = $("#gantt");
  if (!vista || !vista.gantt.length) {
    largoGantt = 0;
    cont.innerHTML = `<p class="vacio">Pulse Ejecutar o Paso para ver cómo se reparte la CPU.</p>`;
    $("#ganttTitulo").textContent = vista ? vista.nombre : "Sin simulación";
    $("#metricas").innerHTML = "";
    $("#tablaMetricas tbody").innerHTML = "";
    $("#ganttMensaje").hidden = true;
    return;
  }
  const total = Math.max(vista.gantt[vista.gantt.length - 1].fin, 1);
  const ancho = Math.max(cont.clientWidth - 4, total * 28);
  const px = ancho / total;

  const crecio = !vistaComparada && vista.gantt.length > largoGantt;
  largoGantt = vistaComparada ? largoGantt : vista.gantt.length;
  const bloques = vista.gantt.map((g, i) => {
    const ocioso = g.pid === 0;
    const w = (g.fin - g.inicio) * px;
    const texto = w > 26 ? (ocioso ? "—" : "P" + g.pid) : "";
    const titulo = ocioso ? "CPU ociosa" : `${g.nombre} (P${g.pid})`;
    return `<div class="gantt-bloque${ocioso ? " ocioso" : ""}${crecio && i === vista.gantt.length - 1 ? " ultimo" : ""}"
      style="left:${g.inicio * px}px;width:${w}px;--c:${colorPid(g.pid)}"
      title="${esc(titulo)}: ${g.inicio}–${g.fin}">${texto}</div>`;
  }).join("");

  const paso = total > 60 ? 10 : total > 30 ? 5 : total > 15 ? 2 : 1;
  let marcas = "";
  for (let t = 0; t <= total; t += paso) marcas += `<span style="left:${t * px}px">${t}</span>`;

  cont.innerHTML = `<div class="gantt-pista" style="width:${ancho}px">${bloques}</div>
                    <div class="gantt-eje" style="width:${ancho}px">${marcas}</div>`;
  cont.scrollLeft = cont.scrollWidth;

  $("#ganttTitulo").textContent = vistaComparada
    ? `${vista.nombre} (resultado de la comparación)`
    : `${vista.nombre}${vista.algoritmo === "ROUND_ROBIN" ? ", q = " + vista.quantum : ""}`;
  $("#ganttMensaje").hidden = !vista.mensaje;
  $("#ganttMensaje").textContent = vista.mensaje || "";

  $("#metricas").innerHTML = [
    ["Espera promedio", num(vista.espera)],
    ["Retorno promedio", num(vista.retorno)],
    ["Respuesta promedio", num(vista.respuesta)],
    ["Utilización de CPU", num(vista.cpu, 1) + " %"],
    ["Throughput", num(vista.throughput, 3)],
    ["Terminados", `${vista.completados} / ${vista.procesos.length}`],
  ].map(([k, v]) => `<div class="metrica"><span>${k}</span><strong>${v}</strong></div>`).join("");

  $("#tablaMetricas tbody").innerHTML = vista.procesos.map((p) => `
    <tr><td>${pidHtml(p)}</td><td>${esc(p.nombre)}</td><td>${p.espera}</td><td>${guion(p.retorno)}</td>
    <td>${guion(p.respuesta)}</td><td>${p.bloqueado}</td><td>${guion(p.inicio)}</td><td>${guion(p.fin)}</td></tr>`).join("");
}

function pintarComparacion() {
  const comp = estado.comparacion;
  $("#sinComparacion").hidden = comp.length > 0;
  if (!comp.length) { $("#tablaComparacion tbody").innerHTML = ""; return; }
  const minimo = (k) => Math.min(...comp.map((c) => c[k]));
  const maximo = (k) => Math.max(...comp.map((c) => c[k]));
  const mejor = { espera: minimo("espera"), retorno: minimo("retorno"), respuesta: minimo("respuesta"), cpu: maximo("cpu"), throughput: maximo("throughput"), tiempo: minimo("tiempo") };
  const celda = (c, k, txt) => `<td class="${c[k] === mejor[k] ? "mejor" : ""}">${txt}</td>`;
  $("#tablaComparacion tbody").innerHTML = comp.map((c, i) => `
    <tr data-i="${i}" class="${vistaComparada && vistaComparada.algoritmo === c.algoritmo ? "sel" : ""}">
      <td>${esc(c.nombre)}</td>
      ${celda(c, "espera", num(c.espera))}${celda(c, "retorno", num(c.retorno))}${celda(c, "respuesta", num(c.respuesta))}
      ${celda(c, "cpu", num(c.cpu, 1))}${celda(c, "throughput", num(c.throughput, 3))}${celda(c, "tiempo", c.tiempo)}
    </tr>`).join("");
}

$("#tablaComparacion").addEventListener("click", (e) => {
  const fila = e.target.closest("tr[data-i]");
  if (!fila) return;
  detenerAuto();
  vistaComparada = estado.comparacion[Number(fila.dataset.i)];
  pintarPlanificacion();
});

async function unPaso() {
  const r = await accion("paso", configPlan(), { silencio: true });
  if (!r) { detenerAuto(); return; }
  const res = r.extra.resultado;
  if (res !== "AVANZO") {
    detenerAuto();
    aviso(r.mensaje || "La simulación terminó.", res === "ATASCO");
  }
}

function detenerAuto() {
  clearInterval(temporizador);
  temporizador = null;
  $("#btnEjecutar").disabled = false;
  $("#btnPausa").disabled = true;
}

$("#btnEjecutar").addEventListener("click", async () => {
  vistaComparada = null;
  if (!estado.simulando) {
    const ok = await accion("iniciar", configPlan(), { silencio: true });
    if (!ok) return;
  }
  $("#btnEjecutar").disabled = true;
  $("#btnPausa").disabled = false;
  let ocupado = false;
  temporizador = setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    await unPaso();
    ocupado = false;
  }, Number($("#velocidad").value));
});

$("#btnPausa").addEventListener("click", detenerAuto);
$("#btnPaso").addEventListener("click", () => { detenerAuto(); vistaComparada = null; unPaso(); });
$("#btnReiniciar").addEventListener("click", () => { detenerAuto(); vistaComparada = null; accion("reiniciar"); });
$("#btnComparar").addEventListener("click", () => { detenerAuto(); accion("comparar", configPlan()); });
$("#velocidad").addEventListener("change", () => { if (temporizador) { detenerAuto(); $("#btnEjecutar").click(); } });

// memoria

function pintarMemoria() {
  const m = estado.memoria;
  $("#kbPagina").textContent = m.kbPorPagina;
  if (document.activeElement !== $("#paginasTotales")) $("#paginasTotales").value = m.total;
  $("#algMemoria").value = m.algoritmo;

  let celdas = "";
  for (const b of m.bloques) {
    for (let i = 0; i < b.tamano; i++) {
      const pag = b.inicio + i;
      if (b.pid < 0) {
        celdas += `<div class="pagina" title="Página ${pag}: libre"></div>`;
      } else {
        celdas += `<div class="pagina ocupada${i === 0 ? " inicio" : ""}" style="--c:${colorPid(b.pid)}"
          title="Página ${pag}: P${b.pid} ${esc(b.nombre)}">${i === 0 ? "P" + b.pid : ""}</div>`;
      }
    }
  }
  $("#mapaMemoria").innerHTML = celdas;
  $("#statsMemoria").innerHTML = `
    <span>Usadas <b>${m.usadas}</b> de ${m.total} (${m.usadas * m.kbPorPagina} KB)</span>
    <span>Libres <b>${m.libres}</b></span>
    <span>Huecos <b>${m.huecos}</b></span>
    <span>Hueco mayor <b>${m.huecoMayor}</b></span>
    <span>Fragmentación externa <b>${m.fragmentacion}</b> páginas</span>`;

  $("#recursosBarras").innerHTML = estado.recursos.map((r) => {
    const usados = r.total - r.disponible;
    return `<div class="recurso"><div class="cab"><span>${r.nombre}</span><span>${usados} en uso de ${r.total}</span></div>
      <div class="barra"><i style="width:${r.total ? usados * 100 / r.total : 0}%"></i></div></div>`;
  }).join("");
  const [imp, disco, puerto] = estado.recursos;
  if (!document.activeElement?.closest("#memoria .panel")) {
    $("#rImp").value = imp.total; $("#rDisco").value = disco.total; $("#rPuerto").value = puerto.total;
  }
}

$("#btnPaginas").addEventListener("click", () => accion("memoria", { paginas: $("#paginasTotales").value }));
$("#algMemoria").addEventListener("change", (e) => accion("algmem", { algoritmo: e.target.value }));
$("#btnFragmentacion").addEventListener("click", () => {
  if (estado.procesos.length && !confirm("La demostración reemplaza los procesos actuales. ¿Continuar?")) return;
  detenerAuto();
  accion("cargar", { escenario: "fragmentacion" });
});
$("#btnAsignar").addEventListener("click", () => accion("asignar", { pid: $("#memProceso").value }));
$("#btnLiberar").addEventListener("click", () => accion("liberar", { pid: $("#memProceso").value }));
$("#btnRecursos").addEventListener("click", () =>
  accion("recursos", { imp: $("#rImp").value, disco: $("#rDisco").value, puerto: $("#rPuerto").value }));

// ------------------------------------------------------------------ comunicación

function pintarComunicacion() {
  const sem = estado.semaforos;
  const previo = $("#semSel").value;
  $("#semSel").innerHTML = sem.map((s) => `<option>${esc(s.nombre)}</option>`).join("");
  if (sem.some((s) => s.nombre === previo)) $("#semSel").value = previo;

  $("#listaSemaforos").innerHTML = sem.length
    ? sem.map((s) => `<div class="semaforo">
        <strong>${esc(s.nombre)}</strong>
        <div class="valor${s.valor === 0 ? " cero" : ""}">${s.valor}</div>
        <small>Inicial ${s.inicial}</small>
        <small>En espera: ${esc(s.cola)}</small></div>`).join("")
    : `<p class="vacio">No hay semáforos. Cree uno o use la demostración IPC.</p>`;

  $("#tablaBuzones tbody").innerHTML = estado.procesos.map((p) => {
    const b = estado.buzones.find((x) => x.pid === p.pid) || {};
    return `<tr><td><span class="pid" style="--c:${colorPid(p.pid)}">${esc(nombreProc(p))}</span></td><td>${estadoHtml(p.estado)}</td>
      <td>${b.pendientes ?? 0}</td><td>${esc(b.ultimo) || "—"}</td></tr>`;
  }).join("");
}

const parAB = () => ({ a: $("#ipcA").value, b: $("#ipcB").value });
$("#btnDemoIpc").addEventListener("click", () => { detenerAuto(); accion("demoipc", parAB()); });
$("#btnCrearSem").addEventListener("click", () => accion("semaforo", { nombre: $("#semNombre").value, valor: $("#semValor").value }));
$("#btnWait").addEventListener("click", () => accion("wait", { pid: $("#ipcA").value, nombre: $("#semSel").value }));
$("#btnSignal").addEventListener("click", () => accion("signal", { nombre: $("#semSel").value }));
$("#btnEnviar").addEventListener("click", () => accion("enviar", { ...parAB(), texto: $("#msgTexto").value }));
$("#btnRecibir").addEventListener("click", () => accion("recibir", { pid: $("#ipcB").value }));

//  sincronización

$$("[data-contador]").forEach((b) => b.addEventListener("click", async () => {
  const sinc = b.dataset.contador;
  $("#resContador").innerHTML = `<p class="vacio">Ejecutando ${$("#cHilos").value} hilos…</p>`;
  const r = await accion("contador", { sinc, hilos: $("#cHilos").value, rep: $("#cRep").value }, { silencio: true });
  if (!r) return;
  const x = r.extra;
  const perdidos = Math.max(0, x.esperado - x.obtenido);
  $("#resContador").className = "resultado " + (perdidos ? "mal" : "bien");
  $("#resContador").innerHTML = `
    <div class="cifras"><div><b>${x.esperado}</b><span>Esperado</span></div>
    <div><b>${x.obtenido}</b><span>Obtenido</span></div><div><b>${perdidos}</b><span>Perdidos</span></div></div>
    <p>${esc(x.conclusion)}</p>`;
}));

let animBuffer = null;
function pintarCeldas(datos) {
  $("#celdasBuffer").innerHTML = datos.map((v) =>
    `<div class="celda${v ? " llena" : ""}">${v || "·"}</div>`).join("");
}
pintarCeldas(new Array(5).fill(0));
$("#bCap").addEventListener("change", (e) => pintarCeldas(new Array(Number(e.target.value)).fill(0)));

$$("[data-buffer]").forEach((b) => b.addEventListener("click", async () => {
  clearInterval(animBuffer);
  $$("[data-buffer]").forEach((x) => (x.disabled = true));
  $("#resBuffer").className = "resultado";
  $("#resBuffer").innerHTML = `<p class="vacio">Ejecutando productores y consumidores…</p>`;
  const r = await accion("buffer", {
    sinc: b.dataset.buffer, cap: $("#bCap").value, prod: $("#bProd").value,
    cons: $("#bCons").value, items: $("#bItems").value,
  }, { silencio: true });
  if (!r) { $$("[data-buffer]").forEach((x) => (x.disabled = false)); return; }
  const x = r.extra;
  // Reproduce los estados del buffer que registró Java, para ver cómo se llena y se vacía.
  const cuadros = x.cuadros.length ? x.cuadros : [x.final];
  const salto = Math.max(1, Math.ceil(cuadros.length / 120));
  let i = 0;
  const fin = () => {
    clearInterval(animBuffer);
    pintarCeldas(x.final);
    $$("[data-buffer]").forEach((y) => (y.disabled = false));
    $("#resBuffer").className = "resultado " + (x.anomalias ? "mal" : "bien");
    $("#resBuffer").innerHTML = `
      <div class="cifras"><div><b>${x.producidos}</b><span>Producidos</span></div>
      <div><b>${x.consumidos}</b><span>Consumidos</span></div><div><b>${x.anomalias}</b><span>Anomalías</span></div></div>
      <p>${esc(x.conclusion)}</p>`;
    $("#eventosBuffer").textContent = x.eventos.join("\n");
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { fin(); return; }
  animBuffer = setInterval(() => {
    if (i >= cuadros.length) { fin(); return; }
    pintarCeldas(cuadros[i]);
    i += salto;
  }, 35);
}));

// ------------------------------------------------------------------ monitoreo

function pintarMonitoreo() {
  $("#tablaMonitoreo tbody").innerHTML = estado.procesos.map((p) => `
    <tr class="${p.pid === estado.enCpu ? "sel" : ""}">
      <td>${pidHtml(p)}</td><td>${esc(p.nombre)}</td><td>${estadoHtml(p.estado)}</td><td>${esc(p.motivo) || "—"}</td>
      <td>${p.prioridad}</td><td>${p.restante}</td><td>${p.espera}</td><td>${p.paginas}</td><td>${guion(p.base)}</td>
    </tr>`).join("");

  $("#tablaTransiciones tbody").innerHTML = estado.transiciones.slice().reverse().map((t) => `
    <tr><td>${t.tiempo}</td><td><span class="pid" style="--c:${colorPid(t.pid)}">P${t.pid}</span>${t.proceso === "P" + t.pid ? "" : " " + esc(t.proceso)}</td>
    <td>${t.desde === "—" ? "—" : estadoHtml(t.desde)}</td><td>${estadoHtml(t.hacia)}</td><td>${esc(t.causa)}</td></tr>`).join("");

  $("#bitacora").innerHTML = estado.bitacora.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join("");
}

// excepciones

function pintarExcepciones() {
  const ex = estado.excepciones;
  $("#sinExcepciones").hidden = ex.length > 0;
  $("#tablaExcepciones tbody").innerHTML = ex.slice().reverse().map((e) => `
    <tr><td>${e.tiempo}</td><td><span class="pid" style="--c:${colorPid(e.pid)}">P${e.pid}</span>${e.proceso === "P" + e.pid ? "" : " " + esc(e.proceso)}</td>
    <td>${esc(e.tipo)}</td><td>${esc(e.manejo)}</td><td style="white-space:normal">${esc(e.mensaje)}</td></tr>`).join("");
}

function resultadoExcepcion(r) {
  if (!r) return;
  $("#resExcepcion").hidden = false;
  $("#resExcepcion").innerHTML = `<p>${esc(r.mensaje)}</p>`;
}

$("#btnDividir").addEventListener("click", async () => resultadoExcepcion(await accion("dividir", {
  pid: $("#excProceso").value, dividendo: $("#dividendo").value, divisor: $("#divisor").value, recuperar: $("#recDiv").checked,
}, { silencio: true })));

$("#btnAcceder").addEventListener("click", async () => resultadoExcepcion(await accion("acceder", {
  pid: $("#excProceso").value, pagina: $("#paginaLogica").value, recuperar: $("#recAcc").checked,
}, { silencio: true })));

$("#btnAccesoValido").addEventListener("click", async () => {
  $("#paginaLogica").value = 0;
  $("#recAcc").checked = false;
  resultadoExcepcion(await accion("accesovalido", { pid: $("#excProceso").value }, { silencio: true }));
});

$("#btnPaginaInvalida").addEventListener("click", () => {
  const p = estado.procesos.find((x) => String(x.pid) === $("#excProceso").value);
  if (!p) { aviso("Seleccione un proceso.", true); return; }
  $("#paginaLogica").value = p.paginas + 3;
  aviso(`La página ${p.paginas + 3} está fuera del espacio de ${p.etiqueta} (válidas: 0 a ${p.paginas - 1}). Pulse «Acceder a memoria».`);
});

// ------------------------------------------------------------------ inicio

window.addEventListener("resize", () => estado && pintarGantt(vistaComparada || estado.vista));
pedirEstado().catch(() => aviso("No se pudo conectar con ServidorWeb. Ejecútelo y recargue la página.", true));