import fs from "fs";
import path from "path";

export interface ERPConfigEndpoint {
  intencion: string;
  descripcion: string;
  endpoint: string;
  metodo: string;
  payload: any;
  tipo_salida: string;
  observaciones?: string;
}

export interface ERPConfig {
  erp: string;
  baseUrl: string;
  modulos: Record<string, {
    CREATE: ERPConfigEndpoint[];
    READ: ERPConfigEndpoint[];
    UPDATE: ERPConfigEndpoint[];
    DELETE: ERPConfigEndpoint[];
  }>;
}

export class ERPConfigService {
  private configsDir: string;

  constructor() {
    this.configsDir = path.join(__dirname, "./configs");
  }

  /**
   * Carga la configuración de la empresa desde JSON
   */
  public loadConfig(empresa: string): ERPConfig {
    // Intentar diferentes formatos de nombre de archivo
    const posiblesArchivos = [
      `configuracion_${empresa.toLowerCase()}.json`,
      `configuracion_${empresa}.json`,
      `${empresa.toLowerCase()}.json`,
      `${empresa}.json`
    ];

    for (const nombreArchivo of posiblesArchivos) {
      const filePath = path.join(this.configsDir, nombreArchivo);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw) as ERPConfig;
      }
    }

    throw new Error(`No existe configuración para la empresa ${empresa}`);
  }

  /**
   * Retorna los endpoints según empresa, módulo e intención (CRUD)
   */
  getEndpoints(empresa: string, modulo: string, crud: keyof ERPConfig["modulos"][string]): ERPConfigEndpoint[] {
    const config = this.loadConfig(empresa);

    const moduloConfig = config.modulos[modulo];
    if (!moduloConfig) {
      throw new Error(`Módulo "${modulo}" no encontrado para la empresa ${empresa}`);
    }

    const endpoints = moduloConfig[crud];
    if (!endpoints) {
      throw new Error(`CRUD "${crud}" no encontrado en módulo "${modulo}" para ${empresa}`);
    }

    return endpoints;
  }
}