import { ConfigMapping } from "./config-mapping";

export class ConfigLoader {
  private config: ConfigMapping;

  constructor(config: ConfigMapping) {
    this.config = config;
    this.validateConfig();
  }

  private validateConfig(): void {
    if (!this.config.version) throw new Error('Configuración debe tener versión');
    if (!this.config.settings?.umbralMinimoConfianza) throw new Error('Configuración debe tener umbralMinimoConfianza');
    if (!this.config.vocabulario?.modulos) throw new Error('Configuración debe tener vocabulario.modulos');
    if (!this.config.vocabulario?.acciones) throw new Error('Configuración debe tener vocabulario.acciones');
    if (!this.config.puntuacion?.modulo) throw new Error('Configuración debe tener puntuacion.modulo');
    if (!this.config.puntuacion?.accion) throw new Error('Configuración debe tener puntuacion.accion');
  }

  // --- Accesores ---
  getVersion(): string { return this.config.version; }
  getUmbralMinimoConfianza(): number { return this.config.settings.umbralMinimoConfianza; }
  getCorreccionesOrtograficas(): Record<string, string> { return this.config.normalizacion.correccionesOrtograficas || {}; }
  getPalabrasAEliminar(): string[] { return this.config.normalizacion.eliminarPalabras || []; }
  getPalabrasVacias(): string[] { return this.config.normalizacion.palabrasVacias || []; }
  getModulosConfigurados(): string[] { return Object.keys(this.config.vocabulario.modulos); }
  getPalabrasClaveModulo(modulo: string): string[] { return this.config.vocabulario.modulos[modulo]?.palabrasClave || []; }
  getPalabrasRelacionadasModulo(modulo: string): string[] { return this.config.vocabulario.modulos[modulo]?.palabrasRelacionadas || []; }
  getSinonimosModulo(modulo: string, palabra: string): string[] { return this.config.vocabulario.modulos[modulo]?.sinonimosDirectos?.[palabra] || []; }
  getAccionesConfiguradas(): string[] { return Object.keys(this.config.vocabulario.acciones); }
  getPalabrasClaveAccion(accion: string): string[] { return this.config.vocabulario.acciones[accion]?.palabrasClave || []; }
  getSinonimosAccion(accion: string): string[] { return this.config.vocabulario.acciones[accion]?.sinonimos || []; }
  getExpresionesTipicasAccion(accion: string): string[] { return this.config.vocabulario.acciones[accion]?.expresionesTipicas || []; }
  getPatronesAccion(accion: string): string[] { return this.config.patrones.detectarAccion[accion] || []; }
  getPatronesModulo(modulo: string): string[] { return this.config.patrones.detectarModulo[modulo] || []; }
  getPatronesExtraccion(tipo: string): string[] { return this.config.patrones.extraerParametros[tipo] || []; }
  getPuntuacionModulo() { return this.config.puntuacion.modulo; }
  getPuntuacionAccion() { return this.config.puntuacion.accion; }
  getModuloPorDefecto(): string { return this.config.defaults?.moduloPorDefecto || 'VENTAS'; }
  getAccionPorDefecto(): string { return this.config.defaults?.accionPorDefecto || 'READ'; }

  // --- Normalización ---
  normalizarTexto(texto: string): string {
    if (!texto) return '';
    let normalizado = texto.toLowerCase();

    Object.entries(this.getCorreccionesOrtograficas()).forEach(([error, correccion]) => {
      const regex = new RegExp(`\\b${error}\\b`, 'gi');
      normalizado = normalizado.replace(regex, correccion);
    });

    this.getPalabrasAEliminar().forEach(palabra => {
      const regex = new RegExp(`\\b${palabra}\\b`, 'gi');
      normalizado = normalizado.replace(regex, '').trim();
    });

    this.getPalabrasVacias().forEach(palabra => {
      const regex = new RegExp(`\\s+\\b${palabra}\\b\\s+`, 'gi');
      normalizado = normalizado.replace(regex, ' ').trim();
    });

    return normalizado.replace(/\s+/g, ' ').trim();
  }

  // --- Cálculo de puntuación ---
  calcularPuntuacionModulo(texto: string, modulo: string): number {
    const cfg = this.getPuntuacionModulo();
    const textoLower = texto.toLowerCase();
    let puntuacion = 0;

    this.getPalabrasClaveModulo(modulo).forEach(palabra => {
      const p = palabra.toLowerCase();
      if (textoLower === p) puntuacion += cfg.coincidenciaExacta;
      else if (new RegExp(`\\b${p}\\b`).test(textoLower)) puntuacion += cfg.coincidenciaPalabraCompleta;
      else if (textoLower.includes(p)) puntuacion += cfg.coincidenciaParcial;
    });

    this.getPalabrasRelacionadasModulo(modulo).forEach(palabra => {
      if (new RegExp(`\\b${palabra.toLowerCase()}\\b`).test(textoLower)) puntuacion += cfg.palabraRelacionada;
    });

    this.getPatronesModulo(modulo).forEach(patron => {
      if (new RegExp(patron, 'i').test(textoLower)) puntuacion += cfg.coincidenciaPalabraCompleta;
    });

    return puntuacion;
  }

  calcularPuntuacionAccion(texto: string, accion: string): number {
    const cfg = this.getPuntuacionAccion();
    const textoLower = texto.toLowerCase();
    let puntuacion = 0;

    this.getPalabrasClaveAccion(accion).forEach(palabra => {
      const p = palabra.toLowerCase();
      if (textoLower === p) puntuacion += cfg.coincidenciaExacta;
      else if (new RegExp(`\\b${p}\\b`).test(textoLower)) puntuacion += cfg.coincidenciaPalabraCompleta;
      else if (textoLower.includes(p)) puntuacion += cfg.coincidenciaParcial;
    });

    this.getSinonimosAccion(accion).forEach(s => {
      if (new RegExp(`\\b${s.toLowerCase()}\\b`).test(textoLower)) puntuacion += cfg.coincidenciaPalabraCompleta;
    });

    [...this.getPatronesAccion(accion), ...this.getExpresionesTipicasAccion(accion)].forEach(patron => {
      const regex = new RegExp(patron.replace(/\[algo\]/g, '\\w+'), 'i');
      if (regex.test(textoLower)) puntuacion += cfg.expresionTipica;
    });

    return puntuacion;
  }

  extraerParametro(texto: string, tipo: string): string | null {
    for (const patron of this.getPatronesExtraccion(tipo)) {
      const match = texto.match(new RegExp(patron, 'i'));
      if (match && match[1]) return match[1];
    }
    return null;
  }

  detectarMejorModulo(texto: string, modulosDisponibles: string[]): { modulo: string; puntuacion: number } {
    const resultados = modulosDisponibles.map(m => ({ modulo: m, puntuacion: this.calcularPuntuacionModulo(texto, m) }));
    resultados.sort((a, b) => b.puntuacion - a.puntuacion);
    return resultados[0] || { modulo: this.getModuloPorDefecto(), puntuacion: 0 };
  }

  detectarMejorAccion(texto: string): { accion: string; puntuacion: number } {
    const resultados = this.getAccionesConfiguradas().map(a => ({ accion: a, puntuacion: this.calcularPuntuacionAccion(texto, a) }));
    resultados.sort((a, b) => b.puntuacion - a.puntuacion);
    return resultados[0] || { accion: this.getAccionPorDefecto(), puntuacion: 0 };
  }
}
