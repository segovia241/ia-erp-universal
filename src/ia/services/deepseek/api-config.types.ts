// src/erp/configs/api-config.types.ts
import { 
  Endpoint, 
  Modulo, 
  ConfiguracionAPI,
  Parametro,
  EstructuraParametro,
  PropiedadEstructura 
} from "./../../../erp/configs/api-config";

// Tipos re-exportados para usar en deepseek-raw.service
export type {
  Endpoint,
  Modulo,
  ConfiguracionAPI,
  Parametro,
  EstructuraParametro,
  PropiedadEstructura
};

// Tipo para acciones CRUD
export type AccionCRUD = "leer" | "crear" | "actualizar" | "eliminar";

// Helper type para acceder a los endpoints por acción
export type ModuloConAcciones = Modulo & {
  [K in AccionCRUD]: Endpoint[];
};