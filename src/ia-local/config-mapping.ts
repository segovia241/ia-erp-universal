export interface ConfigMapping {
  version: string;
  description?: string;
  
  settings: {
    umbralMinimoConfianza: number;
    maxIntentosLocal?: number;
    tiempoEsperaFallback?: number;
    nivelLog?: string;
  };
  
  normalizacion: {
    correccionesOrtograficas: Record<string, string>;
    eliminarPalabras: string[];
    palabrasVacias: string[];
  };
  
  vocabulario: {
    modulos: Record<string, {
      palabrasClave: string[];
      palabrasRelacionadas: string[];
      sinonimosDirectos?: Record<string, string[]>;
    }>;
    acciones: Record<string, {
      palabrasClave: string[];
      sinonimos?: string[];
      expresionesTipicas?: string[];
    }>;
  };
  
  patrones: {
    detectarAccion: Record<string, string[]>;
    detectarModulo: Record<string, string[]>;
    extraerParametros: Record<string, string[]>;
  };
  
  puntuacion: {
    modulo: {
      coincidenciaExacta: number;
      coincidenciaPalabraCompleta: number;
      coincidenciaParcial: number;
      palabraRelacionada: number;
      umbralMinimo: number;
    };
    accion: {
      coincidenciaExacta: number;
      coincidenciaPalabraCompleta: number;
      coincidenciaParcial: number;
      expresionTipica: number;
      umbralMinimo: number;
    };
  };
  
  defaults?: {
    moduloPorDefecto?: string;
    accionPorDefecto?: string;
  };
}
