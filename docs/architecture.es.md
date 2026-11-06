---
type: Guide
title: Arquitectura
description: Las tres capas de Wispkit, la responsabilidad de cada módulo, un flujo de datos completo, el reparto host/webview de la visualización 3D, las capas de la gestión de recursos personalizada y las decisiones de diseño clave
tags: [architecture, vscode-extension, webview]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Arquitectura

[English](architecture.md) | [中文](architecture.zh-CN.md) | **Español**

## Capas

Wispkit usa la estructura estándar en dos partes de una extensión de VS Code, más una tercera parte que es **lógica pura compartida por el host y el front-end**:

```text
┌─────────────────── host de la extensión (Node, puede acceder a la API de vscode) ───────────────────┐
│ src/extension.ts        entrada de activación: 7 editores + interceptor de solo lectura + paneles + 2 comandos │
│ src/*Provider.ts        7 CustomEditorProviders + 2 webviewPanels + árbol de recursos + proveedor de comandos │
│ src/config.ts           lee cada ajuste wispkit.* en un objeto fuertemente tipado                    │
│ src/mediaActions.ts     lado del host del menú contextual de medios (guardar como / copiar ruta / copiar fuente) │
│ src/graph3dProvider.ts  panel 3D: lee Markdown / Mermaid, extrae elementos y envía el payload        │
│ src/mermaidProvider.ts  vista .mmd: render Mermaid integrado + entradas de fuente / 3D              │
│ src/mermaid/            esqueleto de página y estado de .mmd (lógica pura + HTML)                  │
│ src/graph3d/            análisis ASCII / Mermaid, extracción, fusión y diseño 3D (lógica pura)        │
│ src/markdown/ src/html/ src/image/ src/xaml/ src/readonly/ src/subtree/ src/media/ src/util/          │
│                         un directorio = un área funcional, lógica pura separada de vscode             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
              │  ① generar la cadena HTML + nonce/CSP   ② postMessage en ambos sentidos
              ▼
┌────────────────────── front-end del webview (entorno de navegador, sin API de vscode) ─────────────┐
│ media/markdown.js  árbol de contenido, menú contextual de medios, modal a pantalla completa, puente drawio, modo edición │
│ media/mermaid.js   barra de .mmd: fuente / 3D / actualizar; avisa al script integrado al cambiar   │
│ media/image.js     zoom con rueda / desplazamiento arrastrando / doble clic para ajustar             │
│ media/video.js     <video> nativo, barra con reproductor del sistema / copiar ruta                  │
│ media/xaml.js      superposición de resaltado del código, panzoom del render, arrastre del divisor    │
│ media/readonly.js  botón de desbloqueo de la vista previa de solo lectura                            │
│ media/subtree.js   render del árbol, ordenación, selección, área de acciones, redimensionado de columnas │
│ media/graph3d.js   escena 3D con three.js, burbujas / sprites de texto / aristas, paneles y fusión    │
│ media/shared/      panzoom · lightbox · toc · contextmenu · paragraph (componentes reutilizados)      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
              ▲  ③ la misma lógica pura la comparten ambos lados (el host la importa, el bundler la empaqueta)
              │
       src/util/  src/media/{parse,formats,csp}.ts  src/subtree/{columns,sort,wispkitView,fileActions}.ts
       src/readonly/highlight.ts  src/xaml/highlight.ts  src/subtree/iconTheme.ts
       src/graph3d/{ascii,mermaid,markdownElements,merge,layout,selection,types}.ts
       src/resourceTree/{model,paths,storageCore,transfer,presentation}.ts
```

La tercera parte es el punto clave: estos módulos **deliberadamente no importan `vscode`**, así que se pueden llamar directamente dentro del host de la extensión, probar con pruebas unitarias en Node sin más, y empaquetar en el front-end con esbuild. Son los archivos mejor cubiertos por las pruebas de este proyecto.

## Capa del host de la extensión: responsabilidades de los módulos

| Archivo | Responsabilidad |
|---|---|
| `src/extension.ts` | Entrada de activación. `activate()` empuja **14 disposables** de una vez: el `register()` de 7 editores personalizados, el interceptor de solo lectura, el panel de subárbol, el panel 3D, el árbol de recursos, la vista de almacenamiento, el comando `wispkitView` y el comando `wispkit.openWith`. También exporta `viewTypeFor(uri)` — decide qué vista maneja un archivo según su extensión, compartido por `openWith` y las pruebas |
| `src/config.ts` | Lee y normaliza todos los ajustes `wispkit.*`. Los campos que necesita el front-end (tamaño de fuente, altura de línea, paso de zoom…) se recortan aparte — **el objeto de configuración completo nunca se entrega al webview** |
| `src/markdownProvider.ts` | El `CustomEditorProvider` de la vista Markdown. Agrega los `markdown.previewScripts` / `previewStyles` de terceros, alimenta el nonce/CSP y maneja los mensajes `render` / `save` / acciones de medios / drawio |
| `src/mermaidProvider.ts` | El `CustomTextEditorProvider` de la vista de archivo Mermaid (`.mmd` / `.mermaid`): entrega todo el código al script de vista previa integrado y maneja actualizar / abrir fuente / 3D; sin script de vista previa degrada a modo fuente |
| `src/mediaActions.ts` | Lado del host del menú contextual de medios: `Guardar como…`, `Copiar ruta`, `Copiar fuente Markdown`, `Abrir en Draw.io` |
| `src/htmlProvider.ts` | La vista HTML (`priority: default`): envuelve la fuente en una página con CSP relajada, reescribe los enlaces `vscode://file/` e inyecta el enrutador de enlaces (`media/dist/html.js`) |
| `src/imageProvider.ts` | La vista de imagen (`priority: default`): convierte el archivo en un URI que el webview puede cargar y lo envía al front-end; los mensajes `wispkit.media.openExternal` / `wispkit.media.copyPath` alimentan el panel de respaldo para formatos que el runtime no decodifica |
| `src/videoProvider.ts` | La vista de vídeo (`priority: default`): envuelve el archivo en una página con `<video>` nativo y CSP `media-src`; los mismos dos mensajes del host alimentan los botones «reproductor del sistema» / «copiar ruta» |
| `src/xamlProvider.ts` | La vista XAML: lee y escribe la fuente, llama al renderizador externo, devuelve el PNG como data URI o archivo temporal |
| `src/readonlyProvider.ts` | La vista de texto de solo lectura: lee la cabecera del archivo, trunca por líneas y la entrega a `readonly/page.ts` para construir el HTML resaltado |
| `src/subtreeProvider.ts` | El panel de subárbol (un webviewPanel, no un editor personalizado): lecturas diferidas del disco, ordenación, operaciones de archivo propias, cuatro modos de ejecución de shell. El archivo de host más grande del repositorio (unos 28 KB) |
| `src/graph3dProvider.ts` | El panel 3D (`wispkit.graph3d`, un webviewPanel): lee el código Markdown / Mermaid, llama a `extractElementsForSource` según la extensión, construye una página con CSP estricta / nonce y coloca el payload de elementos en un `<meta>`; maneja `wispkit.graph3d.refresh`. Reabrir el mismo archivo solo revela el panel existente (`Graph3dPanels` indexado por URI) |
| `src/resourceTreeProvider.ts` | Gestión de recursos personalizada (`wispkit.resourceTree`, un TreeView, no un webview): implementa `TreeDataProvider` + `TreeDragAndDropController`, registra los 13 comandos `wispkit.resourceTree.*` y los listeners de configuración / espacio de trabajo; cada cambio pasa por la capa de datos pura y luego se escribe de forma atómica en un JSON del espacio de trabajo |
| `src/wispkitViewProvider.ts` | El comando `wispkit.wispkitView.open`: abre el destino descrito por `entry` + `openWith` en `.WispkitView/Wispkit.json` |

## Directorios por área funcional

| Directorio | Archivo | Responsabilidad |
|---|---|---|
| `src/markdown/` | `contributions.ts` | Recorre `vscode.extensions.all` y lee `contributes["markdown.previewScripts"]` / `["markdown.previewStyles"]` como **claves planas con puntos**. Ese es el contrato real de VS Code, no un `markdown: { previewScripts }` anidado |
| | `render.ts` | Llama al comando oculto incorporado `markdown.api.render` para convertir la fuente en HTML, de modo que los `markdownItPlugins` de terceros (mermaid, katex) se apliquen automáticamente |
| | `page.ts` | Construye el esqueleto HTML de la vista Markdown; al front-end solo se le envían los campos necesarios |
| `src/html/` | `page.ts` | Envoltorio de página HTML: CSP relajada (scripts en línea y http(s) permitidos) + reescritura de enlaces `vscode://file/` + inyección del enrutador de enlaces |
| `src/image/` | `page.ts` | El HTML y la configuración de front-end de la página de imagen, incluido el panel de respaldo por fallo de decodificación |
| `src/video/` | `page.ts` | Esqueleto de la página de vídeo: `<video>` nativo, barra de herramientas (reproductor del sistema / copiar ruta) y panel para contenedores no soportados |
| `src/xaml/` | `page.ts` | HTML de la vista XAML (panel de código + panel de render + divisor) |
| | `highlight.ts` | El resaltador ligero propio de XAML / XAML.cs. La capa de resaltado se apila bajo un `<textarea>`; el texto del textarea es transparente para que solo se vea el cursor, por lo tanto **los caracteres visibles deben ser idénticos byte a byte a la entrada** |
| | `renderer.ts` | Llama al proceso .NET separado; el contrato está congelado como `<renderer> render <in.xaml> <out.png> [--assembly <dll>]...` |
| `src/readonly/` | `associations.ts` | Escribe el **manejador nativo** de los tipos de texto en `workbench.editorAssociations`, para que VS Code los abra directamente en `wispkit.text` |
| | `intercept.ts` | Intercepta archivos que ya abrió el editor nativo y los sustituye por la vista previa de solo lectura (un reemplazo de pestaña; véase la página de limitaciones) |
| | `state.ts` | Estado del interruptor global de solo lectura, aplicación/eliminación de las asociaciones, el elemento de la barra de estado |
| | `file.ts` | Decide qué tipos **no** se interceptan (Markdown / HTML / XAML / imágenes / vídeos — ya son vistas de navegación; la regex se genera desde `media/formats.ts`) |
| | `highlight.ts` | El resaltador de sintaxis genérico de la vista de solo lectura: sin dependencias de terceros, funciones puras, testeable por unidad |
| | `page.ts` | HTML de la vista previa de solo lectura (números de línea + resaltado + botón flotante de desbloqueo) |
| `src/subtree/` | `types.ts` | `TreeEntry` y otros **tipos primitivos** que cruzan hacia el webview (nunca `vscode.Uri` / `Date`) |
| | `columns.ts` | Las 9 definiciones de columna, la resolución del orden (filtrar inválidas, deduplicar, volver a los valores por defecto), el formato de celda |
| | `sort.ts` | Lógica pura de ordenación por columna |
| | `config.ts` | Análisis de la configuración de herramientas propias, sustitución de `${file}/${dir}/${name}/${workspaceFolder}`, ensamblado de la línea de comandos |
| | `wispkitView.ts` | Análisis de `Wispkit.json`, las dos ubicaciones de búsqueda, comprobaciones de escape de `entry` |
| | `explorerCommands.ts` | Tres tipos de acciones: **nativas** (operaciones de archivo propias), comandos aportados por extensiones a `explorer/context` (recogidos automáticamente), comandos integrados de la lista de permitidos (validados con `commands.getCommands(true)` antes de ejecutar) |
| | `fileActions.ts` | La parte de **lógica pura** de las operaciones de archivo propias (cortar/copiar/pegar/renombrar/eliminar/crear/comparar). Son propias porque los comandos integrados `filesExplorer.*` no aceptan URI externos |
| | `iconTheme.ts` | **Análisis puro** de los temas de iconos (sin importar `vscode`), búsqueda en cuatro niveles: `fileNames → fileExtensions → languageIds → file` |
| | `iconThemeHost.ts` | Lecturas de disco y conversión de URI en el host; construye el puente extensión→id de lenguaje desde `contributes.languages` para `mergeLanguageIcons` |
| | `page.ts` | El HTML del panel de subárbol; los anchos de columna viajan por variables `--wispkit-col-*` compartidas por la cabecera y las filas |
| `src/resourceTree/` | `model.ts` | La **capa de datos pura** del árbol de recursos (no importa `vscode` ni `fs`): nodos `group` / `folder`, análisis y saneamiento, serialización, alta/baja/movimiento/renombrado, detección de ciclos, topes de id y de nodos / profundidad |
| | `paths.ts` | Ruta almacenada ↔ ruta absoluta: `${workspaceFolder}` / `${workspaceFolder:nombre}` / `${workspaceFolder:índice}`, rutas absolutas fuera del espacio de trabajo, normalización de mayúsculas en Windows |
| | `storageCore.ts` | Lógica de almacenamiento **pura**: resolución de la configuración y diagnóstico de valores inválidos, decodificación de BOM UTF-8, rutas temporales hermanas, `writeFileAtomically` |
| | `storage.ts` | Adaptador del host: convierte la resolución en un `vscode.Uri` (conservando los esquemas de espacio remoto / virtual), lecturas y escrituras con `workspace.fs` y escritura atómica |
| | `transfer.ts` | Plan de importación `planImport`: rechazar archivos inválidos, resumir advertencias de reparación, construir el texto de confirmación de reemplazo |
| | `presentation.ts` | Contrato de presentación del TreeItem: estado de la carpeta (directorio / ausente / archivo / no resoluble), texto de description / tooltip, comando de clic |
| `src/graph3d/` | `types.ts` | Tipos de datos puros de elementos / nodos / aristas / grupos / resultados de fusión, y las etiquetas de tipo |
| | `markdownElements.ts` | Extrae elementos del Markdown: cercas / árboles ASCII desnudos en el cuerpo, nombres desde títulos y encabezados, sufijos `(2)` para duplicados, `MAX_ELEMENTS` 200 |
| | `ascii.ts` | Análisis de árboles Unicode / ASCII: conectores, niveles de sangría, fusión de líneas continuadas, `MAX_NODES` 600 |
| | `mermaid.ts` | Analizador del subconjunto de topología Mermaid: 12 tipos de diagrama + respaldo genérico por líneas, `MAX_NODES` 600 |
| | `mermaidFile.ts` | Archivos `.mmd` / `.mermaid` independientes: un elemento por archivo, con nombre del `title` y luego del nombre de archivo |
| | `sources.ts` | Despacha el análisis Markdown multi-elemento vs Mermaid mono-elemento por extensión; lo comparten host y pruebas |
| | `merge.ts` | Fusiona nodos con el mismo nombre entre el elemento izquierdo y el derecho, reasigna ids / grupos derechos y deduplica aristas |
| | `layout.ts` | Diseño 3D: árbol radial, capas con SCC colapsado, fuerza dirigida determinista, capas compactas, FR-3D en cáscara Louvain, separación mutex de grafos fusionados, secuencia, cuadrante, marcadores colgantes `void`; funciones puras y reproducibles |
| | `selection.ts` | Restaura las selecciones izquierda/derecha tras actualizar (mantiene «(ninguno)», busca por id y luego por nombre) |
| | `page.ts` | Esqueleto de la página 3D, CSP, nonce, `<meta>` del payload |
| `src/mermaid/` | `page.ts` | Esqueleto de la página `.mmd` / `.mermaid`: barra, insignia de estado y cuerpos diagram / source |
| | `status.ts` | Reutiliza el resultado de `graph3d/mermaid.ts` para la insignia y la entrada 3D (tipo / nodos / aristas) |
| `src/media/` | `parse.ts` | Localización de medios en el origen: mapea «la N-ésima imagen/diagrama de la página» de vuelta a ese segmento del Markdown original. Funciones puras |
| | `formats.ts` | Fuente única de verdad de las extensiones de imagen / vídeo, `fileExtension`, detección de vectoriales y clasificación de decodificación nativa. Funciones puras |
| | `csp.ts` | Texto CSP de las vistas de imagen y vídeo (`img-src` / `media-src`). Funciones puras |
| | `webview.ts` | Utilidades compartidas del host: `localResourceRoots` para medios, ruta del portapapeles y manejo en lista blanca de `openExternal` / `copyPath` |
| `src/util/` | `csp.ts` | El texto CSP del webview, que refleja la política Strict de la vista previa Markdown incorporada (`documentRenderer.ts:275`) |
| | `nonce.ts` | Base64 de 32 bytes aleatorios, usado como nonce del CSP |
| | `html.ts` | `escapeHtml` / `escapeAttribute` |
| | `linkRewrite.ts` | Reescribe `vscode://file/<ruta>[:línea]` como un enlace `command:` — el `isSupportedLink` del host solo permite http(s), así que sin la reescritura al hacer clic no ocurre nada |

## Un flujo de datos completo: abrir un `.md`

1. **VS Code decide quién lo abre**: `.md` coincide con el selector de `wispkit.markdown` en `package.json` y `priority: default`, así que se entrega a `MarkdownEditorProvider`.
2. **El host lee la configuración**: `config.ts` lee `wispkit.toc.*`, `markdown.preview.*` tamaño de fuente / altura de línea, etc., y recorta el conjunto mínimo que necesita el front-end.
3. **El host agrega las contribuciones de terceros**: `markdown/contributions.ts` recorre los `contributes` de todas las extensiones, reúne las listas de scripts y estilos, y fusiona cada `extensionUri` en `localResourceRoots` (si no, esos recursos no se cargan dentro del webview).
4. **El host renderiza el cuerpo**: `markdown/render.ts` ejecuta el `markdown.api.render` incorporado y obtiene HTML — este paso es lo que hace que se apliquen los `markdownItPlugins` de mermaid y katex.
5. **El host construye la página**: `markdown/page.ts` ensambla el HTML (`<script nonce=...>`, `<link>`, meta CSP y el cuerpo inicial inyectados); `nonce.ts` genera el nonce aleatorio.
6. **El webview carga**: `media/markdown.js` recibe el cuerpo, construye el árbol de contenido (`shared/toc.js`), aplica el paso de zoom del cuerpo (`shared/pagezoom.js`), conecta la búsqueda Ctrl+F (`shared/find.js`), enlaza el menú contextual de medios (`shared/contextmenu.js` + `shared/lightbox.js`) e inicializa panzoom (`shared/panzoom.js`).
7. **Los scripts de terceros vuelven a renderizar**: el front-end despacha `vscode.markdown.updateContent` en `window`; el script mermaid incorporado lo usa para dibujar `<div class="mermaid">` como svg.
8. **Interacción del usuario → mensaje de vuelta**: al pulsar «Copiar fuente» el front-end envía solo `{ action: 'copyText', kind: 'mermaid', index: 0 }`; el host usa `media/parse.ts` para recuperar la fuente por índice y escribe el portapapeles.
9. **Guardado (modo edición)**: el front-end envía el texto; el host reemplaza el documento completo mediante un `WorkspaceEdit`, que entra en la pila de deshacer normal.

## El reparto host/webview de la visualización 3D

El panel 3D está construido deliberadamente como «el host solo aporta datos, el front-end solo dibuja»:

| Capa | Hace | No hace |
|---|---|---|
| Host (`src/graph3dProvider.ts`) | lee el Markdown con `workspace.openTextDocument`; llama a `extractGraphElements(text)` para obtener `GraphElement[]` (id, nombre, tipo, lenguaje, línea inicial, fuente, nodos, aristas, grupos, notas de degradación); serializa `{ fileName, filePath, elements }` a JSON, lo escapa como HTML y lo coloca en `<meta id="wispkit-3d-data" data-wispkit>` | no toca three.js, no calcula el diseño, no construye cadenas de script |
| Webview (`media/graph3d.js`) | lee el payload del `<meta>`; selecciona / fusiona izquierda y derecha; llama a la función pura `layoutGraph` para las coordenadas; dibuja burbujas, sprites de texto, aristas y flechas con three.js + OrbitControls | no lee archivos, no accede a la API de `vscode` |

`extractGraphElements` y `layoutGraph` no importan `vscode`, ni three, ni el DOM, así que el host y el webview comparten el mismo código y se pueden probar directamente con mocha. El análisis de diagramas, de árboles ASCII, la fusión por nombre y la estrategia de diseño viven en esa capa; el front-end solo gestiona la selección, la cámara y el dibujo.

**Empaquetado de three.js**: `media/graph3d.js` importa `* as THREE` y `OrbitControls` directamente; esbuild empaqueta three.js, OrbitControls y `src/graph3d/*` en `media/dist/graph3d.js`. Es el único bundle con `minify: true` (una dependencia grande + código escrito a mano) y pesa actualmente unos **603 KB**; los otros 6 bundles de webview siguen sin minificar para facilitar la depuración. No hay CDN ni peticiones de red en tiempo de ejecución.

**CSP / nonce**: la página reutiliza la política estricta de la vista previa Markdown incorporada (el mismo `src/util/csp.ts`): `default-src 'none'`; `script-src 'nonce-<random>'` (sin `unsafe-inline`); `style-src` / `img-src` / `font-src` permiten `cspSource`, `https:` y `data:` (los estilos además permiten `'unsafe-inline'`). La etiqueta `<script>` lleva el mismo nonce y los datos de los elementos viven solo en un atributo `data-*` escapado — no se genera ningún script en línea. Los estilos llegan por el URI de webview de `media/graph3d.css`.

**Estructura de archivos**:

| Ruta | Responsabilidad |
|---|---|
| `src/graph3dProvider.ts` | ciclo de vida del panel, registro del comando, lectura de archivos, mensajes de actualización |
| `src/graph3d/markdownElements.ts` | extrae elementos del Markdown: cercas / árboles desnudos, nombres y deduplicación, `MAX_ELEMENTS` |
| `src/graph3d/ascii.ts` | análisis de árboles Unicode / ASCII |
| `src/graph3d/mermaid.ts` | analizador del subconjunto de topología Mermaid (todos los tipos + respaldo genérico, `MAX_NODES`) |
| `src/graph3d/merge.ts` | fusión por nombre de los elementos izquierdo y derecho |
| `src/graph3d/layout.ts` | diseño 3D: árbol / capas (SCC) / fuerza dirigida / capas compactas / Louvain / separación mutex de grafos fusionados / secuencia / cuadrante |
| `src/graph3d/selection.ts` | restaura las selecciones izquierda/derecha tras actualizar |
| `src/graph3d/page.ts` | esqueleto de página, CSP, nonce, meta del payload |
| `src/graph3d/types.ts` | tipos de datos puros de elementos / nodos / aristas / grupos / fusiones |
| `media/graph3d.js` · `.css` | interacción y estilos del front-end |
| `media/dist/graph3d.js` | salida de esbuild (incluye three.js) |

**Un flujo de datos 3D**:

1. El usuario hace clic derecho en un `.md` del Explorador (o ejecuta `wispkit.graph3d.open` desde la paleta).
2. El host lee la fuente con `workspace.openTextDocument`; `extractGraphElements` la analiza y produce `GraphElement[]`.
3. El host crea el webviewPanel `wispkit.graph3d`, genera nonce / CSP / URI de recursos y coloca el payload en `<meta>`.
4. `media/graph3d.js` lee el payload y selecciona el primer elemento a la izquierda; el usuario puede seleccionar uno a la derecha.
5. En cada cambio de selección / fusión / intervalo el front-end llama a `layoutGraph` (funciones puras) para obtener coordenadas y hace que three.js reconstruya la escena.
6. Al pulsar Actualizar, el front-end envía `wispkit.graph3d.refresh`; el host relee el archivo y responde con `wispkit.graph3d.elements`; si falla, responde `wispkit.graph3d.error`.

## Las capas de la gestión de recursos personalizada

La gestión de recursos sigue el mismo modelo de interacción que el árbol de ensamblados de drawcode: **`TreeDataProvider` + `TreeDragAndDropController`**, comandos en el título de la vista / menú contextual de los nodos, arrastres internos y entradas desde el Explorador. Solo cambia el almacenamiento: drawcode guarda su árbol en `workspaceState`, mientras que Wispkit debe permitir editar el archivo desde fuera, exportarlo, importarlo y recargarlo con Actualizar, así que vive en un JSON normal dentro del espacio de trabajo.

| Capa | Archivo | Depende de | Responsabilidad |
|---|---|---|---|
| Host / vista | `src/resourceTreeProvider.ts` | `vscode` | implementa `TreeDataProvider` y `TreeDragAndDropController`; crea el `TreeView` (`showCollapseAll`); registra los 13 comandos; recarga ante cambios de configuración / espacio de trabajo; confirma los resultados de la lógica pura como una escritura atómica |
| Capa de datos pura | `src/resourceTree/model.ts` | nada (no importa `vscode` ni `fs`) | tipos de nodo, análisis y saneamiento, serialización, alta/baja/movimiento/renombrado, detección de ciclos, topes de id y de nodos / profundidad |
| Capa de rutas | `src/resourceTree/paths.ts` | `node:path` | ruta almacenada ↔ ruta absoluta: marcadores de espacio de trabajo, rutas absolutas externas, normalización de mayúsculas |
| Lógica de almacenamiento pura | `src/resourceTree/storageCore.ts` | `node:path` | resolución de la configuración y diagnóstico de valores inválidos, decodificación de BOM UTF-8, rutas temporales hermanas, escritura atómica |
| Adaptador de almacenamiento | `src/resourceTree/storage.ts` | `vscode` | convierte la resolución en un `vscode.Uri` (conservando esquemas remotos / virtuales), lecturas y escrituras con `workspace.fs` y escritura atómica |
| Importación / exportación | `src/resourceTree/transfer.ts` | `model` | `planImport`: rechazar archivos inválidos, resumir advertencias de reparación, construir el texto de confirmación |
| Caché de estado de carpetas | `src/resourceTree/folderStateCache.ts` | `node:path` | caché `directory` / `file` / `missing` con TTL de 30 s, tope LRU de 2000, deduplicación en vuelo y cola de stat con concurrencia limitada (8) |
| Contrato de presentación | `src/resourceTree/presentation.ts` | solo tipos | estado de la carpeta (incluido `unknown` antes de que vuelva la comprobación asíncrona), texto de description / tooltip, comando de clic |

**Un flujo de datos del árbol de recursos**:

1. `registerResourceTree` crea el `TreeView` y el `ResourceTreeProvider`, registra los comandos `wispkit.resourceTree.*`, el listener de configuración y el de carpetas del espacio de trabajo.
2. Arranque / actualización: `currentStorageResolution()` resuelve `wispkit.resourceTree.file` con `storageCore.resolveStoragePath` (por defecto, `.WispkitView/resource-tree.json` de la primera carpeta del espacio) → `readStore` hace `stat` primero; si falta el archivo devuelve un árbol vacío, mientras que un directorio / error de permisos / JSON inválido devuelve `error`.
3. `model.parseStoreJson` analiza y sanea: tipos desconocidos, carpetas sin `path`, ids duplicados y nodos por encima de los topes / demasiado profundos se registran como `warnings`; si hay `error`, el árbol actual **no se reemplaza** y no se escribe nada.
4. El `TreeView` pide `getChildren`; las funciones puras de `presentation` deciden el estado, la descripción y el comando de clic de cada elemento. El estado de las carpetas se precarga de forma asíncrona con `workspace.fs.stat` y se cachea (TTL de 30 s, máximo 2000 entradas, 8 comprobaciones concurrentes); `getTreeItem` solo lee la caché, así que nunca bloquea con IO de disco síncrono.
5. Alta / baja / movimiento / arrastre: el provider llama a las funciones puras de `model` para obtener un **store inmutable nuevo** (el anterior no se toca), luego `commit` → `serializeStore` → `writeTextAtomically` (archivo temporal hermano + `rename`) → si va bien sustituye el árbol en memoria y llama a `fire()`; si falla, el árbol en memoria conserva el valor anterior.
6. Importación: `planImport` decide primero si el archivo se puede importar y produce el texto de advertencia / confirmación; solo tras confirmar, la capa de comandos llama a `replaceStore`. La exportación reutiliza `serializeStore` y la misma escritura atómica.
7. Ediciones externas: no hay vigilancia del archivo, así que el usuario pulsa Actualizar y se repiten los pasos 2–4; cambiar `wispkit.resourceTree.file` y los cambios de carpetas del espacio de trabajo también provocan una recarga.

**¿Por qué no `workspaceState`?** El requisito es «editable desde fuera, exportable, importable y recargable con Actualizar». `workspaceState` es almacenamiento privado de la extensión que el usuario no puede ver ni editar; un JSON normal en el espacio de trabajo convierte todo eso en operaciones de archivo corrientes y mantiene la interacción de árbol de drawcode. El precio es tener que gestionar nosotros mismos ediciones concurrentes, archivos corruptos y escrituras atómicas (véase [limitaciones conocidas](limitations.es.md#19-los-grupos-virtuales-no-corresponden-a-ninguna-carpeta-del-disco)).

## Razones de diseño

**¿Por qué `CustomEditorProvider` y no un `webviewPanel`?** Porque la extensión tiene que **hacerse cargo del manejador de apertura** — hacer doble clic en `.md` debe terminar en esta vista. Un `webviewPanel` solo se puede crear con un comando y no puede ganar el manejador de apertura (Simple Browser es exactamente esa forma, por eso no se puede tomar el control de él).

**¿Por qué el menú contextual de medios informa solo «índice + tipo»?** Los URI de recursos dentro de un webview son `vscode-webview://` y **no se pueden mapear de vuelta a una ruta de archivo real**. Como el front-end no puede obtener la ruta, informa solo la posición y el host obtiene la ruta y la fuente del texto original. Las imágenes además se verifican de forma cruzada con `alt`, así que un índice desplazado también se puede recuperar.

**¿Por qué pasar por el comando oculto `markdown.api.render`?** Implementar el renderizado Markdown por nuestra cuenta perdería los `markdownItPlugins` de terceros (mermaid y katex dependen por completo de ello). Usar el comando incorporado significa reutilizar la tubería oficial, a cambio de depender de un comando no documentado.

**¿Por qué el modo de solo lectura no crea un `TextDocument`?** El objetivo es precisamente «ahorrar el coste de carga». Solo `CustomEditorProvider` + leer la cabecera del archivo directamente evita cargar todo el archivo en memoria; el precio es perder el coloreado de sintaxis oficial, por eso `readonly/highlight.ts` implementa un resaltador genérico propio.

**¿Por qué mantener la lógica pura en archivos que no importan `vscode`?** Para poder probarla. `src` tiene 30.345 líneas de TypeScript (12.635 de ellas pruebas), 70 archivos de prueba y 1149 casos; una buena parte de esos casos se ejecuta en Node sin arrancar VS Code — lo que solo es posible cuando el análisis, el formato, la ordenación, el resaltado y el diseño están desacoplados de `vscode`.

**¿Por qué la vista 3D no reutiliza el renderizador de Mermaid?** Mermaid produce SVG en 2D, que no se puede convertir directamente en una escena 3D rotable; la vista 3D necesita la topología (quién se conecta con quién), no el estilo. Wispkit analiza solo la topología y la distribuye por su cuenta, cambiando la paridad visual con los temas de Mermaid por funcionamiento sin conexión, cero CDN y un diseño testeable (véase [limitaciones conocidas](limitations.es.md#15-la-visualización-3d-analiza-la-topología-no-reproduce-el-render-de-mermaid)).

## Escala

| Elemento | Valor |
|---|---|
| Host de la extensión y lógica pura | `src` suma 22.816 líneas de TypeScript (13.093 sin contar las pruebas) |
| Front-end | 22 archivos escritos a mano en `media` (incluidos 6 componentes reutilizados en `shared/`) + 7 salidas de esbuild |
| Pruebas | 70 archivos de prueba / 1149 casos |
| Herramienta nativa que viaja con la extensión | `tools/xaml-render` (.NET, dependiente del framework) |
