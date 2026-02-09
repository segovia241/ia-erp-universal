export interface IAAction {
  accion: "CREATE" | "READ" | "UPDATE" | "DELETE";
  modulo: string;
  entidad: string;
  parametros: Record<string, any>;
}
