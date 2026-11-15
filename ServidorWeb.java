import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.awt.Desktop;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Interfaz web del simulador.
 * Levanta un servidor HTTP local (sin librerías externas) que sirve la carpeta "web"
 * y expone el objeto Sistema mediante una API JSON en /api/estado y /api/accion.
 * Uso: java ServidorWeb [puerto]   (por defecto 8080)
 */
public final class ServidorWeb {
    private final Sistema sistema = new Sistema();
    private final Path carpetaWeb;

    private ServidorWeb(Path carpetaWeb) {
        this.carpetaWeb = carpetaWeb;
        sistema.cargarReferencia();
    }

    public static void main(String[] args) throws IOException {
        int puerto = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        Path web = Paths.get("web").toAbsolutePath();
        if (!Files.isDirectory(web)) {
            System.err.println("No se encontró la carpeta 'web'. Ejecute desde la raíz del proyecto.");
            return;
        }
        ServidorWeb app = new ServidorWeb(web);
        HttpServer servidor = HttpServer.create(new InetSocketAddress("127.0.0.1", puerto), 0);
        servidor.createContext("/api/estado", ex -> app.responder(ex, app.estadoJson(), 200));
        servidor.createContext("/api/accion", app::accion);
        servidor.createContext("/", app::estatico);
        servidor.setExecutor(null); // un solo hilo: el Sistema no es thread-safe
        servidor.start();
        String url = "http://localhost:" + puerto + "/";
        System.out.println("SysNova web disponible en " + url);
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(new URI(url));
            }
        } catch (Exception ignorado) {
            // Si no se puede abrir el navegador, el usuario entra con la URL impresa.
        }
    }

    // ------------------------------------------------------------------ archivos estáticos

    private void estatico(HttpExchange ex) throws IOException {
        String ruta = ex.getRequestURI().getPath();
        if (ruta.equals("/")) ruta = "/index.html";
        Path archivo = carpetaWeb.resolve(ruta.substring(1)).normalize();
        if (!archivo.startsWith(carpetaWeb) || !Files.isRegularFile(archivo)) {
            enviar(ex, 404, "text/plain; charset=utf-8", "No encontrado".getBytes(StandardCharsets.UTF_8));
            return;
        }
        enviar(ex, 200, tipo(archivo.toString()), Files.readAllBytes(archivo));
    }

    private static String tipo(String nombre) {
        if (nombre.endsWith(".html")) return "text/html; charset=utf-8";
        if (nombre.endsWith(".css")) return "text/css; charset=utf-8";
        if (nombre.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (nombre.endsWith(".svg")) return "image/svg+xml";
        if (nombre.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    // ------------------------------------------------------------------ acciones

    private void accion(HttpExchange ex) throws IOException {
        Map<String, String> p = parametros(ex);
        String op = p.getOrDefault("op", "");
        Json extra = new Json();
        String mensaje;
        try {
            mensaje = ejecutar(op, p, extra);
        } catch (IllegalArgumentException | IllegalStateException e) {
            responder(ex, "{\"ok\":false,\"error\":" + Json.texto(e.getMessage()) + ",\"estado\":" + estadoJson() + "}", 200);
            return;
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.toString() : e.getMessage();
            responder(ex, "{\"ok\":false,\"error\":" + Json.texto(msg) + ",\"estado\":" + estadoJson() + "}", 200);
            return;
        }
        responder(ex, "{\"ok\":true,\"mensaje\":" + Json.texto(mensaje)
                + ",\"extra\":" + extra.cerrar() + ",\"estado\":" + estadoJson() + "}", 200);
    }

    private String ejecutar(String op, Map<String, String> p, Json extra) throws Exception {
        switch (op) {
            case "cargar": {
                switch (p.getOrDefault("escenario", "referencia")) {
                    case "es": sistema.cargarConEntradaSalida(); return "Carga con E/S lista.";
                    case "memoria": sistema.cargarMemoriaYRecursos(); return "Escenario de memoria y recursos listo.";
                    case "fragmentacion": return sistema.demostrarFragmentacion();
                    default: sistema.cargarReferencia(); return "Carga clásica P1–P4 lista.";
                }
            }
            case "crear": {
                Proceso nuevo = sistema.crear(p.get("nombre"), entero(p, "prioridad"), entero(p, "llegada"),
                        entero(p, "rafaga"), entero(p, "paginas"), entero(p, "es"),
                        new int[]{entero(p, "imp"), entero(p, "disco"), entero(p, "puerto")});
                return "Se creó " + nuevo.getEtiqueta() + " " + nuevo.getNombre() + ".";
            }
            case "aleatorios": {
                int n = entero(p, "cantidad");
                sistema.crearAleatorios(n);
                return "Se generaron " + n + " procesos aleatorios.";
            }
            case "importar": {
                String texto = p.getOrDefault("texto", "");
                List<DatosProceso> datos = "json".equals(p.get("tipo"))
                        ? CargadorProcesos.desdeJson(texto) : CargadorProcesos.desdeCsv(texto);
                int n = sistema.cargar(datos, true);
                return "Se cargaron " + n + " procesos desde el archivo.";
            }
            case "terminar": {
                Proceso pr = proceso(p, "pid");
                sistema.terminar(pr);
                return pr.getEtiqueta() + " terminado.";
            }
            case "vaciar": sistema.vaciar(); return "Procesos eliminados.";
            case "config": aplicarConfig(p); return "Configuración aplicada.";
            case "iniciar": aplicarConfig(p); sistema.iniciarSimulacion(); return "Simulación iniciada.";
            case "paso": {
                if (p.containsKey("algoritmo") && !sistema.tieneSimulacion()) aplicarConfig(p);
                PasoSimulacion r = sistema.paso();
                extra.campo("resultado", r.name());
                return r == PasoSimulacion.FIN ? "La simulación terminó."
                        : r == PasoSimulacion.ATASCO ? "La simulación está atascada." : "";
            }
            case "reiniciar": sistema.detenerSimulacion(); return "Simulación reiniciada.";
            case "comparar": aplicarConfig(p); sistema.comparar(); return "Se compararon los 5 algoritmos.";
            case "memoria": sistema.fijarMemoria(entero(p, "paginas")); return "Tamaño de memoria aplicado.";
            case "algmem": sistema.setAlgoritmoMemoria(AlgoritmoMemoria.valueOf(p.get("algoritmo"))); return "Algoritmo de memoria cambiado.";
            case "recursos":
                sistema.fijarRecursos(entero(p, "imp"), entero(p, "disco"), entero(p, "puerto"));
                return "Recursos aplicados.";
            case "asignar": {
                Proceso pr = proceso(p, "pid");
                return sistema.asignarMemoria(pr) ? pr.getEtiqueta() + " recibió memoria."
                        : pr.getEtiqueta() + " no obtuvo memoria (no hay hueco contiguo).";
            }
            case "liberar": {
                Proceso pr = proceso(p, "pid");
                sistema.liberarMemoria(pr);
                return "Memoria de " + pr.getEtiqueta() + " liberada.";
            }
            case "semaforo": {
                sistema.crearSemaforo(p.getOrDefault("nombre", ""), entero(p, "valor"));
                return "Semáforo creado.";
            }
            case "wait": sistema.esperarSemaforo(proceso(p, "pid"), p.get("nombre")); return "Wait ejecutado.";
            case "signal": sistema.senalarSemaforo(p.get("nombre")); return "Signal ejecutado.";
            case "enviar": sistema.enviar(proceso(p, "a"), proceso(p, "b"), p.get("texto")); return "Mensaje enviado.";
            case "recibir": sistema.recibir(proceso(p, "pid")); return "Receive ejecutado.";
            case "demoipc": sistema.demostracionIpc(proceso(p, "a"), proceso(p, "b")); return "Demostración IPC terminada.";
            case "dividir":
                return sistema.ejecutarDivision(proceso(p, "pid"), entero(p, "dividendo"), entero(p, "divisor"),
                        "true".equals(p.get("recuperar")));
            case "acceder":
                return sistema.ejecutarAcceso(proceso(p, "pid"), entero(p, "pagina"), "true".equals(p.get("recuperar")));
            case "accesovalido": {
                Proceso pr = proceso(p, "pid");
                if (!pr.tieneMemoria()) sistema.asignarMemoria(pr);
                return sistema.ejecutarAcceso(pr, 0, true);
            }
            case "contador": {
                DemoProductorConsumidor.Informe inf = DemoProductorConsumidor.contador(
                        "true".equals(p.get("sinc")), rango(entero(p, "hilos"), 2, 8), rango(entero(p, "rep"), 10, 200));
                extra.campo("esperado", inf.esperado).campo("obtenido", inf.obtenido)
                        .campo("conclusion", inf.conclusion).campo("sinc", inf.sincronizado);
                return "";
            }
            case "buffer": {
                List<int[]> cuadros = new ArrayList<>();
                DemoProductorConsumidor.Informe inf = DemoProductorConsumidor.buffer(
                        "true".equals(p.get("sinc")), rango(entero(p, "cap"), 2, 12), rango(entero(p, "prod"), 1, 4),
                        rango(entero(p, "cons"), 1, 4), rango(entero(p, "items"), 4, 40),
                        copia -> { synchronized (cuadros) { if (cuadros.size() < 400) cuadros.add(copia.clone()); } });
                StringBuilder sb = new StringBuilder("[");
                synchronized (cuadros) {
                    for (int i = 0; i < cuadros.size(); i++) {
                        if (i > 0) sb.append(',');
                        sb.append(Json.enteros(cuadros.get(i)));
                    }
                }
                sb.append(']');
                extra.campo("producidos", inf.producidos).campo("consumidos", inf.consumidos)
                        .campo("anomalias", inf.anomalias).campo("conclusion", inf.conclusion)
                        .campo("sinc", inf.sincronizado).crudo("final", Json.enteros(inf.bufferFinal))
                        .crudo("cuadros", sb.toString()).crudo("eventos", Json.textos(inf.eventos));
                return "";
            }
            default:
                throw new IllegalArgumentException("Acción desconocida: " + op);
        }
    }

    private void aplicarConfig(Map<String, String> p) {
        if (p.containsKey("algoritmo")) sistema.setAlgoritmo(AlgoritmoCPU.valueOf(p.get("algoritmo")));
        if (p.containsKey("quantum")) sistema.setQuantum(entero(p, "quantum"));
        if (p.containsKey("aging")) sistema.setIntervaloAging(entero(p, "aging"));
        if (p.containsKey("limitar")) sistema.setLimitarMemoriaRecursos("true".equals(p.get("limitar")));
    }

    private Proceso proceso(Map<String, String> p, String clave) {
        String valor = p.get(clave);
        if (valor == null || valor.isBlank()) throw new IllegalArgumentException("Seleccione un proceso.");
        int pid = Integer.parseInt(valor.trim());
        for (Proceso pr : sistema.getProcesos()) {
            if (pr.getPid() == pid) return pr;
        }
        throw new IllegalArgumentException("No existe el proceso P" + pid + ".");
    }

    private static int entero(Map<String, String> p, String clave) {
        String valor = p.get(clave);
        if (valor == null || valor.isBlank()) throw new IllegalArgumentException("Falta el campo «" + clave + "».");
        try {
            return Integer.parseInt(valor.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("«" + valor + "» no es un número entero.");
        }
    }

    private static int rango(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    // ------------------------------------------------------------------ estado en JSON

    private String estadoJson() {
        Json j = new Json();
        j.campo("reloj", sistema.getReloj())
         .campo("algoritmo", sistema.getAlgoritmo().name())
         .campo("quantum", sistema.getQuantum())
         .campo("aging", sistema.getIntervaloAging())
         .campo("limitar", sistema.isLimitarMemoriaRecursos())
         .campo("simulando", sistema.tieneSimulacion());
        Proceso enCpu = sistema.procesoEnEjecucion();
        j.campo("enCpu", enCpu == null ? -1 : enCpu.getPid());

        StringBuilder algs = new StringBuilder("[");
        for (AlgoritmoCPU a : AlgoritmoCPU.values()) {
            if (algs.length() > 1) algs.append(',');
            algs.append(new Json().campo("id", a.name()).campo("nombre", a.getEtiqueta()).cerrar());
        }
        j.crudo("algoritmos", algs.append(']').toString());

        j.crudo("procesos", procesosJson(sistema.getProcesos()));

        GestorMemoria m = sistema.getMemoria();
        StringBuilder bloques = new StringBuilder("[");
        for (BloqueMemoria b : m.getBloques()) {
            if (bloques.length() > 1) bloques.append(',');
            bloques.append(new Json().campo("inicio", b.getInicio()).campo("tamano", b.getTamano())
                    .campo("pid", b.getPid()).campo("nombre", b.getNombre()).cerrar());
        }
        bloques.append(']');
        j.crudo("memoria", new Json().campo("total", m.getTotalPaginas()).campo("usadas", m.paginasUsadas())
                .campo("libres", m.paginasLibres()).campo("huecos", m.numeroHuecos())
                .campo("huecoMayor", m.huecoMayor()).campo("fragmentacion", m.fragmentacionExterna())
                .campo("algoritmo", m.getAlgoritmo().name()).campo("kbPorPagina", Sistema.KB_POR_PAGINA)
                .crudo("bloques", bloques.toString()).cerrar());

        GestorRecursos r = sistema.getRecursos();
        StringBuilder rec = new StringBuilder("[");
        for (int i = 0; i < r.tipos(); i++) {
            if (i > 0) rec.append(',');
            rec.append(new Json().campo("nombre", GestorRecursos.NOMBRES[i]).campo("total", r.getTotal(i))
                    .campo("disponible", r.getDisponible(i)).cerrar());
        }
        j.crudo("recursos", rec.append(']').toString());

        ResultadoPlanificacion vista = sistema.getVista();
        j.crudo("vista", vista == null ? "null" : resultadoJson(vista, true));
        StringBuilder comp = new StringBuilder("[");
        for (ResultadoPlanificacion res : sistema.getComparacion()) {
            if (comp.length() > 1) comp.append(',');
            comp.append(resultadoJson(res, true));
        }
        j.crudo("comparacion", comp.append(']').toString());

        StringBuilder sem = new StringBuilder("[");
        for (SemaforoSO s : sistema.getIpc().getSemaforos()) {
            if (sem.length() > 1) sem.append(',');
            sem.append(new Json().campo("nombre", s.getNombre()).campo("valor", s.getValor())
                    .campo("inicial", s.getValorInicial()).campo("enEspera", s.getEnEspera())
                    .campo("cola", s.procesosEnEspera()).cerrar());
        }
        j.crudo("semaforos", sem.append(']').toString());

        StringBuilder buz = new StringBuilder("[");
        for (Proceso pr : sistema.getProcesos()) {
            if (buz.length() > 1) buz.append(',');
            buz.append(new Json().campo("pid", pr.getPid())
                    .campo("pendientes", sistema.getIpc().mensajesPendientes(pr.getPid()))
                    .campo("ultimo", pr.getUltimoMensaje()).cerrar());
        }
        j.crudo("buzones", buz.append(']').toString());

        List<Transicion> trans = sistema.getTransiciones();
        StringBuilder tr = new StringBuilder("[");
        for (int i = Math.max(0, trans.size() - 300); i < trans.size(); i++) {
            Transicion t = trans.get(i);
            if (tr.length() > 1) tr.append(',');
            tr.append(new Json().campo("tiempo", t.getTiempo()).campo("pid", t.getPid())
                    .campo("proceso", t.getProceso()).campo("desde", t.getDesdeTexto())
                    .campo("hacia", t.getHaciaTexto()).campo("causa", t.getCausa()).cerrar());
        }
        j.crudo("transiciones", tr.append(']').toString());

        List<String> bit = sistema.getBitacora();
        j.crudo("bitacora", Json.textos(bit.subList(Math.max(0, bit.size() - 120), bit.size())));

        StringBuilder exc = new StringBuilder("[");
        for (RegistroExcepcion e : sistema.getExcepciones()) {
            if (exc.length() > 1) exc.append(',');
            exc.append(new Json().campo("tiempo", e.getTiempo()).campo("pid", e.getPid())
                    .campo("proceso", e.getProceso()).campo("tipo", e.getTipo())
                    .campo("mensaje", e.getMensaje()).campo("manejo", e.getManejo()).cerrar());
        }
        j.crudo("excepciones", exc.append(']').toString());
        return j.cerrar();
    }

    private String procesosJson(List<Proceso> lista) {
        StringBuilder sb = new StringBuilder("[");
        for (Proceso p : lista) {
            if (sb.length() > 1) sb.append(',');
            sb.append(new Json().campo("pid", p.getPid()).campo("etiqueta", p.getEtiqueta())
                    .campo("nombre", p.getNombre()).campo("prioridad", p.getPrioridad())
                    .campo("prioridadBase", p.getPrioridadBase()).campo("llegada", p.getLlegada())
                    .campo("rafaga", p.getRafaga()).campo("restante", p.getRestante())
                    .campo("paginas", p.getPaginas()).campo("es", p.getRafagaES())
                    .crudo("maxRecursos", Json.enteros(p.getMaxRecursos()))
                    .crudo("asignados", Json.enteros(p.getRecursosAsignados()))
                    .campo("estado", p.getEstado().getEtiqueta()).campo("motivo", p.getMotivo().getEtiqueta())
                    .campo("causa", p.getUltimaCausa()).campo("espera", p.getTiempoEspera())
                    .campo("bloqueado", p.getTiempoBloqueado()).campo("retorno", p.getRetorno())
                    .campo("respuesta", p.getRespuesta()).campo("inicio", p.getInicioCpu())
                    .campo("fin", p.getFin()).campo("tieneMemoria", p.tieneMemoria())
                    .campo("base", p.getBaseMemoria()).cerrar());
        }
        return sb.append(']').toString();
    }

    private String resultadoJson(ResultadoPlanificacion r, boolean detalle) {
        Json j = new Json().campo("algoritmo", r.getAlgoritmo().name())
                .campo("nombre", r.getAlgoritmo().getEtiqueta()).campo("quantum", r.getQuantum())
                .campo("espera", r.getEsperaPromedio()).campo("retorno", r.getRetornoPromedio())
                .campo("respuesta", r.getRespuestaPromedio()).campo("cpu", r.getUtilizacionCpu())
                .campo("throughput", r.getThroughput()).campo("tiempo", r.getTiempoTotal())
                .campo("completados", r.getCompletados()).campo("mensaje", r.getMensaje());
        if (detalle) {
            StringBuilder g = new StringBuilder("[");
            for (EntradaGantt e : r.getGantt()) {
                if (g.length() > 1) g.append(',');
                g.append(new Json().campo("pid", e.getPid()).campo("nombre", e.getNombre())
                        .campo("inicio", e.getInicio()).campo("fin", e.getFin()).cerrar());
            }
            j.crudo("gantt", g.append(']').toString());
            j.crudo("procesos", procesosJson(r.getProcesos()));
        }
        return j.cerrar();
    }

    // ------------------------------------------------------------------ HTTP auxiliar

    private Map<String, String> parametros(HttpExchange ex) throws IOException {
        Map<String, String> mapa = new HashMap<>();
        String query = ex.getRequestURI().getRawQuery();
        if (query != null) leerFormulario(query, mapa);
        try (InputStream in = ex.getRequestBody()) {
            String cuerpo = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            if (!cuerpo.isEmpty()) leerFormulario(cuerpo, mapa);
        }
        return mapa;
    }

    private static void leerFormulario(String texto, Map<String, String> mapa) {
        for (String par : texto.split("&")) {
            if (par.isEmpty()) continue;
            int igual = par.indexOf('=');
            String k = igual < 0 ? par : par.substring(0, igual);
            String v = igual < 0 ? "" : par.substring(igual + 1);
            mapa.put(URLDecoder.decode(k, StandardCharsets.UTF_8), URLDecoder.decode(v, StandardCharsets.UTF_8));
        }
    }

    private void responder(HttpExchange ex, String json, int codigo) throws IOException {
        enviar(ex, codigo, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
    }

    private static void enviar(HttpExchange ex, int codigo, String tipo, byte[] datos) throws IOException {
        ex.getResponseHeaders().set("Content-Type", tipo);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(codigo, datos.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(datos);
        }
    }

    /** Constructor mínimo de objetos JSON, para no depender de librerías. */
    static final class Json {
        private final StringBuilder sb = new StringBuilder("{");

        Json campo(String k, String v) { return crudo(k, texto(v)); }
        Json campo(String k, int v) { return crudo(k, Integer.toString(v)); }
        Json campo(String k, boolean v) { return crudo(k, Boolean.toString(v)); }
        Json campo(String k, double v) {
            return crudo(k, Double.isFinite(v) ? Double.toString(v) : "0");
        }

        Json crudo(String k, String valorJson) {
            if (sb.length() > 1) sb.append(',');
            sb.append(texto(k)).append(':').append(valorJson);
            return this;
        }

        String cerrar() { return sb + "}"; }

        static String texto(String s) {
            if (s == null) return "null";
            StringBuilder o = new StringBuilder("\"");
            for (char c : s.toCharArray()) {
                switch (c) {
                    case '"': o.append("\\\""); break;
                    case '\\': o.append("\\\\"); break;
                    case '\n': o.append("\\n"); break;
                    case '\r': o.append("\\r"); break;
                    case '\t': o.append("\\t"); break;
                    default:
                        if (c < 0x20) o.append(String.format("\\u%04x", (int) c));
                        else o.append(c);
                }
            }
            return o.append('"').toString();
        }

        static String enteros(int[] valores) {
            StringBuilder o = new StringBuilder("[");
            for (int i = 0; i < valores.length; i++) {
                if (i > 0) o.append(',');
                o.append(valores[i]);
            }
            return o.append(']').toString();
        }

        static String textos(List<String> lista) {
            StringBuilder o = new StringBuilder("[");
            for (int i = 0; i < lista.size(); i++) {
                if (i > 0) o.append(',');
                o.append(texto(lista.get(i)));
            }
            return o.append(']').toString();
        }
    }
}
