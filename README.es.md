# ArchNodes (project-visualizer)

**Idioma:** Español | [English](README.md)

Editor visual de arquitectura para sistemas backend y frontend, acompañado de un servidor MCP para que agentes de IA puedan leer y editar el mismo grafo de proyecto. Diseñá tus dominios, rutas, endpoints, servicios, modelos, páginas y componentes como un grafo de nodos tipados en un canvas, y luego dejá que un agente de IA (o las skills incluidas) genere código real a partir de él, mantenga el código y el grafo sincronizados, o reconstruya un grafo a partir de un código existente.

## Por qué

La mayoría de los "diagramas de arquitectura" son imágenes estáticas que se desactualizan en el momento en que se dibujan. ArchNodes modela la arquitectura como datos estructurados (un grafo tipado con reglas de validación), la expone tanto por una API REST (para el editor visual) como por un servidor MCP (para agentes de IA), y viene con skills de agente que describen exactamente cómo convertir ese grafo en código y viceversa.

## Características

- **Canvas visual** (React Flow) para ubicar, conectar y organizar nodos dentro de contenedores, con panel de propiedades, paleta de nodos, panel de validación y pestaña de resumen del proyecto.
- **Esquema de nodos tipado** que cubre tanto conceptos de backend (`domain`, `subdomain`, `route`, `endpoint`, `middleware`, `service`, `model`, `table`, `db`, `orm`, `repository`, `tool`, `queue`, `externalApi`, `scheduler`, `errorHandler`, `envConfig`, `websocket`, `email`, `redisKey`) como de frontend (`page`, `layout`, `component`, `form`, `stateStore`, `apiCall`, `hook`, `navigationRouter`, `guard`, `modalDialog`, `themeToken`, `asset`), más nodos estructurales `container`.
- **Reglas de validación**: restricciones de jerarquía, campos requeridos, integridad de campos de referencia y aristas especiales (por ejemplo, relaciones de invalidación de caché `invalidates`).
- **Servidor MCP** (stdio) que expone herramientas para agentes de IA: `get_schema`, `get_project`, `list_nodes`, `get_node`, `validate_project`, `create_node`, `update_node`, `delete_node`, `connect_nodes`, `import_graph`, `export_markdown`.
- **API REST + servidor de archivos estáticos** para el editor visual, con la misma superficie CRUD/validación/exportación que las herramientas MCP.
- **Exportación a Markdown** del grafo del proyecto como documento de contexto (opcionalmente acotado a backend/frontend o a un solo dominio).
- **CLI** con comandos `start`, `mcp` e `init` (asistente interactivo o plantillas de stack).
- **Plantillas de stack**: Express+PostgreSQL(Prisma)+React, NestJS+PostgreSQL(TypeORM)+Angular, Express+MongoDB(Mongoose)+React, FastAPI+PostgreSQL(SQLAlchemy)+React, Fastify+PostgreSQL(Drizzle)+Vue, y un punto de partida para microservicios.
- **Skills de agente** (`skills/`) que documentan tres flujos de trabajo para agentes de IA: `project-scaffold` (grafo → código generado), `project-sync` (mantener grafo y código sincronizados en ambas direcciones), `codebase-import` (código existente → grafo).

## Estructura del proyecto

```
src/                  Servidor, CLI, servidor MCP, reglas de validación, store del proyecto, exportación markdown
  cli.ts              Punto de entrada: start | mcp | init
  server.ts           API REST con Express + hosting estático del cliente
  mcp/server.ts        Servidor MCP por stdio (herramientas para agentes de IA)
  store/               Store del grafo del proyecto (en memoria/persistido)
  validation/          Reglas de jerarquía, campos requeridos y campos de referencia
  init/                Asistente interactivo + plantillas de stack
  export/              Exportación del grafo a Markdown
  types/graph.ts       Definiciones de tipos de nodos/aristas/manifiesto
client/               Editor visual con React + Vite + React Flow (servido por src/server.ts en producción)
skills/               Skills en Markdown que describen flujos de trabajo de agentes sobre las herramientas MCP
```

## Requisitos

- Node.js >= 18.3.0

## Instalación

```bash
npm install
npm run build          # compila src/ -> dist/
cd client && npm install && npm run build   # compila el editor visual (client/dist)
```

## Uso

### Iniciar el editor visual

```bash
node dist/cli.js start --project mi-proyecto [--port 4173]
```

Levanta la API REST y sirve el cliente compilado en `http://localhost:<puerto>` (por defecto `4173`), también accesible desde tu red local.

### Iniciar el servidor MCP (para agentes de IA)

```bash
node dist/cli.js mcp --project mi-proyecto
```

Habla MCP por stdio. Apuntá tu cliente/agente de IA compatible con MCP a este comando para darle acceso de lectura/escritura al grafo del proyecto (ver la lista de herramientas en Características, y `skills/` para los flujos de trabajo recomendados).

### Inicializar un proyecto

```bash
# Asistente interactivo (lenguaje, framework, base de datos, arquitectura, dominios)
node dist/cli.js init --project mi-proyecto

# O desde una plantilla de stack predefinida
node dist/cli.js init --project mi-proyecto --template node-express-postgres-react
```

Ejecutá `node dist/cli.js` sin argumentos para ver la ayuda de uso completa y la lista de plantillas disponibles.

## Desarrollo

```bash
npm run dev        # tsc -w, compila en modo watch el servidor/CLI/MCP
npm test           # vitest run
npm run test:watch # vitest, modo watch

cd client
npm run dev        # servidor de desarrollo de Vite para el editor visual
```

## Skills de agente

La carpeta `skills/` contiene tres guías en Markdown pensadas para ser cargadas por un agente de IA conectado al servidor MCP:

- **`project-scaffold.md`** — genera un código real a partir de un grafo validado, recorriendo dominios → rutas → endpoints → cadenas de middleware → servicios → capa de datos, y luego routers de frontend → páginas → componentes/formularios → llamadas a API.
- **`project-sync.md`** — mantiene sincronizados el grafo y un código existente en ambas direcciones (grafo → código o código → grafo), con guía para resolver conflictos.
- **`codebase-import.md`** — reconstruye un grafo a partir de un código existente, analizándolo estáticamente e importando el resultado vía `import_graph`.

## Licencia

No especificada.
