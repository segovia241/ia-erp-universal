export interface IAInterpreterInput {
  message: string;
  context: {
    erp: string;
    clienteId?: string;
    usuarioId?: string;
    permisos: {
      modulos: string[];
      acciones: string[];
    };
    [key: string]: any;
  };
}
