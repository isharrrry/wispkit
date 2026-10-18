---
type: Guide
title: Arquitectura
description: Las tres capas de Wispkit, la responsabilidad de cada módulo, un flujo de datos completo y las decisiones de diseño clave
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
│ src/extension.ts        entrada de activación: registra 5 editores + interceptor + 2 comandos        │
│ src/*Provider.ts        5 CustomEditorProviders + 1 panel + 1 proveedor de comandos                  │
│ src/config.ts           lee cada ajuste wispkit.* en un objeto fuertemente tipado                    │
│ src/mediaActions.ts     lado del host del menú contextual de medios (guardar como / copiar ruta / copiar fuente) │
│ src/markdown/ src/html/ src/image/ src/xaml/ src/readonly/ src/subtree/ src/media/ src/util/          │
│                         un directorio = un área funcional, lógica pura separada de vscode             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
              │  ① generar la cadena HTML + nonce/CSP   ② postMessage en ambos sentidos
              ▼
┌────────────────────── front-end del webview (entorno de navegador, sin API de vscode) ─────────────┐
│ media/markdown.js  árbol de contenido, menú contextual de medios, modal a pantalla completa, puente drawio, modo edición │
│ media/image.js     zoom con rueda / desplazamiento arrastrando / doble clic para ajustar             │
│ media/xaml.js      superposición de resaltado del código, panzoom del render, arrastre del divisor    │
│ media/readonly.js  botón de desbloqueo de la vista previa de solo lectura                            │
│ media/subtree.js   render del árbol, ordenación, selección, área de acciones, redimensionado de columnas │
│ media/shared/      panzoom · lightbox · toc · contextmenu · paragraph (componentes reutilizados)      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
              ▲  ③ la misma lógica pura la comparten ambos lados (el host la importa, el bundler la empaqueta)
              │
       src/util/  src/media/parse.ts  src/subtree/{columns,sort,wispkitView,fileActions}.ts
       src/readonly/highlight.ts  src/xaml/highlight.ts  src/subtree/iconTheme.ts
```

La tercera parte es el punto clave: estos módulos **deliberadamente no importan `vscode`**, así que se pueden llamar directamente dentro del host de la extensión, probar con pruebas unitarias en Node sin más, y empaquetar en el front-end con esbuild. Son los archivos mejor cubiertos por las pruebas de este proyecto.

## Capa del host de la extensión: responsabilidades de los módulos

| Archivo | Responsabilidad |
|---|---|
| `src/extension.ts` | Entrada de activación. `activate()` empuja 9 disposables de una vez: el `register()` de 5 editores/paneles, el interceptor de solo lectura, el panel de subárbol, el comando `wispkitView` y el comando `wispkit.openWith`. También exporta `viewTypeFor(uri)` — decide qué vista maneja un archivo según su extensión, compartido por `openWith` y las pruebas |
| `src/config.ts` | Lee y normaliza todos los ajustes `wispkit.*`. Los campos que necesita el front-end (tamaño de fuente, altura de línea, paso de zoom…) se recortan aparte — **el objeto de configuración completo nunca se entrega al webview** |
| `src/markdownProvider.ts` | El `CustomEditorProvider` de la vista Markdown. Agrega los `markdown.previewScripts` / `previewStyles` de terceros, alimenta el nonce/CSP y maneja los mensajes `render` / `save` / acciones de medios / drawio |
| `src/mediaActions.ts` | Lado del host del menú contextual de medios: `Guardar como…`, `Copiar ruta`, `Copiar fuente Markdown`, `Abrir en Draw.io` |
| `src/htmlProvider.ts` | La vista HTML (`priority: option`): envuelve la fuente en una página con CSP relajada y reescribe los enlaces `vscode://file/` |
| `src/imageProvider.ts` | La vista de imagen (`priority: default`): convierte el archivo en un URI que el webview puede cargar y lo envía al front-end |
| `src/xamlProvider.ts` | La vista XAML: lee y escribe la fuente, llama al renderizador externo, devuelve el PNG como data URI o archivo temporal |
| `src/readonlyProvider.ts` | La vista de texto de solo lectura: lee la cabecera del archivo, trunca por líneas y la entrega a `readonly/page.ts` para construir el HTML resaltado |
| `src/subtreeProvider.ts` | El panel de subárbol (un webviewPanel, no un editor personalizado): lecturas diferidas del disco, ordenación, operaciones de archivo propias, cuatro modos de ejecución de shell. El archivo de host más grande del repositorio (unos 28 KB) |
| `src/wispkitViewProvider.ts` | El comando `wispkit.wispkitView.open`: abre el destino descrito por `entry` + `openWith` en `.WispkitView/Wispkit.json` |

## Directorios por área funcional

| Directorio | Archivo | Responsabilidad |
|---|---|---|
| `src/markdown/` | `contributions.ts` | Recorre `vscode.extensions.all` y lee `contributes["markdown.previewScripts"]` / `["markdown.previewStyles"]` como **claves planas con puntos**. Ese es el contrato real de VS Code, no un `markdown: { previewScripts }` anidado |
| | `render.ts` | Llama al comando oculto incorporado `markdown.api.render` para convertir la fuente en HTML, de modo que los `markdownItPlugins` de terceros (mermaid, katex) se apliquen automáticamente |
| | `page.ts` | Construye el esqueleto HTML de la vista Markdown; al front-end solo se le envían los campos necesarios |
| `src/html/` | `page.ts` | Envoltorio de página HTML: CSP relajada (scripts en línea y http(s) permitidos) + reescritura de enlaces `vscode://file/` |
| `src/image/` | `page.ts` | El HTML y la configuración de front-end de la página de imagen |
| `src/xaml/` | `page.ts` | HTML de la vista XAML (panel de código + panel de render + divisor) |
| | `highlight.ts` | El resaltador ligero propio de XAML / XAML.cs. La capa de resaltado se apila bajo un `<textarea>`; el texto del textarea es transparente para que solo se vea el cursor, por lo tanto **los caracteres visibles deben ser idénticos byte a byte a la entrada** |
| | `renderer.ts` | Llama al proceso .NET separado; el contrato está congelado como `<renderer> render <in.xaml> <out.png> [--assembly <dll>]...` |
| `src/readonly/` | `associations.ts` | Escribe el **manejador nativo** de los tipos de texto en `workbench.editorAssociations`, para que VS Code los abra directamente en `wispkit.text` |
| | `intercept.ts` | Intercepta archivos que ya abrió el editor nativo y los sustituye por la vista previa de solo lectura (un reemplazo de pestaña; véase la página de limitaciones) |
| | `state.ts` | Estado del interruptor global de solo lectura, aplicación/eliminación de las asociaciones, el elemento de la barra de estado |
| | `file.ts` | Decide qué tipos **no** se interceptan (Markdown / HTML / XAML / imágenes — ya son vistas de navegación) |
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
| `src/media/` | `parse.ts` | Localización de medios en el origen: mapea «la N-ésima imagen/diagrama de la página» de vuelta a ese segmento del Markdown original. Funciones puras |
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
6. **El webview carga**: `media/markdown.js` recibe el cuerpo, construye el árbol de contenido (`shared/toc.js`), enlaza el menú contextual de medios (`shared/contextmenu.js` + `shared/lightbox.js`) e inicializa panzoom (`shared/panzoom.js`).
7. **Los scripts de terceros vuelven a renderizar**: el front-end despacha `vscode.markdown.updateContent` en `window`; el script mermaid incorporado lo usa para dibujar `<div class="mermaid">` como svg.
8. **Interacción del usuario → mensaje de vuelta**: al pulsar «Copiar fuente» el front-end envía solo `{ action: 'copyText', kind: 'mermaid', index: 0 }`; el host usa `media/parse.ts` para recuperar la fuente por índice y escribe el portapapeles.
9. **Guardado (modo edición)**: el front-end envía el texto; el host reemplaza el documento completo mediante un `WorkspaceEdit`, que entra en la pila de deshacer normal.

## Razones de diseño

**¿Por qué `CustomEditorProvider` y no un `webviewPanel`?** Porque la extensión tiene que **hacerse cargo del manejador de apertura** — hacer doble clic en `.md` debe terminar en esta vista. Un `webviewPanel` solo se puede crear con un comando y no puede ganar el manejador de apertura (Simple Browser es exactamente esa forma, por eso no se puede tomar el control de él).

**¿Por qué el menú contextual de medios informa solo «índice + tipo»?** Los URI de recursos dentro de un webview son `vscode-webview://` y **no se pueden mapear de vuelta a una ruta de archivo real**. Como el front-end no puede obtener la ruta, informa solo la posición y el host obtiene la ruta y la fuente del texto original. Las imágenes además se verifican de forma cruzada con `alt`, así que un índice desplazado también se puede recuperar.

**¿Por qué pasar por el comando oculto `markdown.api.render`?** Implementar el renderizado Markdown por nuestra cuenta perdería los `markdownItPlugins` de terceros (mermaid y katex dependen por completo de ello). Usar el comando incorporado significa reutilizar la tubería oficial, a cambio de depender de un comando no documentado.

**¿Por qué el modo de solo lectura no crea un `TextDocument`?** El objetivo es precisamente «ahorrar el coste de carga». Solo `CustomEditorProvider` + leer la cabecera del archivo directamente evita cargar todo el archivo en memoria; el precio es perder el coloreado de sintaxis oficial, por eso `readonly/highlight.ts` implementa un resaltador genérico propio.

**¿Por qué mantener la lógica pura en archivos que no importan `vscode`?** Para poder probarla. `src` tiene 11.450 líneas de TypeScript (5.730 de ellas pruebas), 20 archivos de prueba y 477 casos; una buena parte de esos casos se ejecuta en Node sin arrancar VS Code — lo que solo es posible cuando el análisis, el formato, la ordenación y el resaltado están desacoplados de `vscode`.

## Escala

| Elemento | Valor |
|---|---|
| Host de la extensión y lógica pura | `src` suma 11.450 líneas de TypeScript (5.720 sin contar las pruebas) |
| Front-end | 15 archivos escritos a mano en `media` (incluidos 5 componentes reutilizados en `shared/`) |
| Pruebas | 20 archivos de prueba / 477 casos |
| Herramienta nativa que viaja con la extensión | `tools/xaml-render` (.NET, dependiente del framework) |
