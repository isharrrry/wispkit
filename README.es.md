# Wispkit

[English](README.md) | [中文](README.zh-CN.md) | **Español**

> Mejoras de navegación para VS Code. **Nunca parchea VS Code ni modifica ninguno de sus archivos**: cinco editores personalizados gestionan Markdown / imágenes / HTML / XAML / texto de solo lectura, más un panel de subárbol en el Explorador.

El host de la extensión es TypeScript puro (`engines.vscode: ^1.71.0`), desarrollado y verificado en Windows. La vista XAML incluye un renderizador .NET framework-dependent y requiere el runtime .NET 10 Windows Desktop; las otras cuatro vistas no tienen dependencias nativas.

## Qué problema resuelve

| Problema | Qué hace Wispkit |
|---|---|
| La vista previa de Markdown es una página muerta de solo lectura | Navegación en árbol + menú contextual de medios + edición de drawio en el sitio + **edición del párrafo en el sitio** (edita el párrafo bajo el cursor, sin panel dividido ni otro editor) |
| Ampliar una imagen exige Ctrl+rueda y no se puede arrastrar | Zoom con la rueda sin modificadores (anclado al cursor) + desplazamiento manteniendo el botón derecho + doble clic ajustar/100% |
| Los enlaces `vscode://file/<ruta>:<línea>` de la documentación no abren | Se reescriben a `command:vscode.open?<args>` y abren **en la ventana actual** en esa línea |
| Quieres ver cómo queda realmente una vista WPF | Fuente XAML y render **lado a lado**; el render se desplaza y amplía; los cambios se guardan en el archivo |
| Solo quieres leer, sin cargar el documento completo | Modo de solo lectura global: lee los primeros N bytes, **no crea ningún `TextDocument`** |
| El Explorador muestra una sola columna de nombres | Panel de subárbol: columnas configurables (tamaño/fecha/tipo/propietario…), área de acciones y herramientas propias |

## Inicio rápido

```bash
npm install
npm run compile     # tsc + esbuild (4 bundles de webview)
npm test            # mocha, lógica pura, sin instanciar VS Code
npm run package     # genera wispkit-<version>.vsix
```

Instalar en tu VS Code local (ajusta la ruta a tu propio `code.cmd`):

```powershell
& "D:\app\VSCodeEXE\bin\code.cmd" --install-extension .\wispkit-0.1.0.vsix --force
```

La vista XAML necesita que su renderizador incluido se compile una vez:

```powershell
cd tools\xaml-render
dotnet build -c Release
```

## Conceptos clave

1. **Editores personalizados, no parches** — cinco `CustomEditorProvider` compiten por tipos de archivo. Markdown, imágenes y XAML usan `priority: default` (toman el control); HTML y texto de solo lectura usan `option` (cambio explícito). Para volver al editor integrado: *Reopen Editor With…* o `workbench.editorAssociations`.
2. **El host gestiona las rutas, la webview la interacción** — las URL de recursos dentro de una webview son `vscode-webview://` y **no se pueden revertir a una ruta real**. Por eso el menú contextual de medios informa solo "índice + tipo", y el host relee la ruta y el código fuente del texto Markdown; las imágenes se contrastan además con `alt`. Ver [arquitectura](docs/architecture.es.md).
3. **Renderizar con el pipeline integrado** — la extensión invoca el comando oculto `markdown.api.render`, de modo que los `markdown.markdownItPlugins` de terceros (mermaid, katex) se aplican solos, y luego emite `vscode.markdown.updateContent` sobre `window` para que los scripts de la webview vuelvan a renderizar. Ver [vistas e interacción](docs/views-and-interaction.es.md).
4. **Solo lectura significa "no cargado", no "edición prohibida"** — la vista previa lee solo los primeros N bytes, trunca por líneas, no construye `TextDocument` y nunca carga el archivo completo; un botón flotante "desbloquear edición" cambia al editor nativo. Ver [configuración](docs/configuration.es.md).
5. **Las aserciones deben morder el resultado, no "la regla existe"** — el repositorio ya se quemó con pruebas que validaban "se escribió una regla CSS" mientras el error real pasaba desapercibido; las pruebas actuales prefieren afirmar qué ocurrió después del clic. Ver [compilación y verificación](docs/build-and-verify.es.md).

## Seguridad

- **Las vistas Markdown y XAML reutilizan la CSP Strict de la vista previa integrada** (`nonce` + `cspSource`, sin `unsafe-inline`), de modo que los scripts de terceros escritos para esa política funcionan sin cambios.
- **La vista HTML usa una CSP relajada** (permite scripts en línea y recursos http(s)) — navegar HTML exige por naturaleza que los scripts de la propia página se ejecuten; el nivel de riesgo es comparable al Simple Browser integrado. **No abras HTML de origen no confiable con ella.**
- "Guardar como" de medios y "guardar" de XAML escriben solo en una **ruta que tú elijas**; no se toca nada fuera del archivo destino.

## Documentación

| Para saber sobre | Lee |
|---|---|
| Capas, responsabilidades de módulos, un flujo de datos completo | [Arquitectura](docs/architecture.es.md) |
| Interacción, gestos y contratos de mensajes de las cinco vistas y el panel de subárbol | [Vistas e interacción](docs/views-and-interaction.es.md) |
| Referencia a nivel de campo de cada ajuste, `Wispkit.json`, marcadores de herramientas | [Configuración](docs/configuration.es.md) |
| Compilación, pruebas, sondas en máquina real, empaquetado | [Compilación y verificación](docs/build-and-verify.es.md) |
| Lo que no puede hacer y lo que nunca se verificó | [Limitaciones conocidas](docs/limitations.es.md) |
| Cómo se construyó paso a paso y cada tropiezo real | [Notas de desarrollo](docs/development-notes.zh-CN.md) (中文) |

**Regla de documentación**: cada tema en `docs/` existe en inglés, chino y español — **cualquier cambio actualiza los tres en el mismo cambio** (las variantes son traducciones fieles, no resúmenes). La única excepción es `docs/development-notes.zh-CN.md`, un registro de ingeniería interno que se mantiene solo en chino. Lo no verificado se etiqueta explícitamente en [Limitaciones conocidas](docs/limitations.es.md) en lugar de presentarse como garantía.

## Compilación y entorno medido

| Ítem | Valor |
|---|---|
| Node / npm | compila localmente (`npm run compile`) |
| TypeScript | 5.7 |
| esbuild | 0.24 (4 bundles de webview) |
| Pruebas | mocha + jsdom, **477 pasando**, 20 archivos de prueba |
| Lint | eslint 9, **0 errores** |
| VSIX | 94 entradas / ~1.1 MB (incluye docs, los tres README y las capturas) |
| VS Code medido | **1.137.0** (Windows) |

## Capturas de pantalla

Capturadas de un Extension Development Host real de VS Code 1.137.0, con la carpeta `demo/` incluida en este repositorio.

**Vista Markdown** — render de bloques drawio, tabla de contenidos, botón de edición y la insignia «Wispkit Markdown»:

![Vista Markdown de Wispkit: bloques drawio, tabla de contenidos y botón de edición](docs/images/wispkit-markdown.png)

**Vista XAML** — código resaltado junto al resultado renderizado; la línea de estado indica tipo raíz, tamaño y modo de alojamiento:

![Vista XAML de Wispkit: código resaltado junto al render](docs/images/wispkit-xaml.png)

**Vista de imagen** — zoom con la rueda por defecto (sin Ctrl), arrastre con el botón derecho para desplazar, regla para comprobar la escala:

![Vista de imagen de Wispkit: zoom con rueda y arrastre](docs/images/wispkit-image.png)

**Vista de texto de solo lectura** — solo se carga la cabecera del archivo (64 KB / 800 líneas por defecto); «Desbloquear edición» vuelve al editor nativo:

![Vista de texto de solo lectura: carga parcial con control de desbloqueo](docs/images/wispkit-readonly.png)

**Explorador de subárbol** — varias columnas (nombre / tamaño / tipo / modificación / creación), anchos arrastrables y acciones de archivo para la selección a la derecha:

![Explorador de subárbol: vista multicolumna con grupos de acciones](docs/images/wispkit-subtree.png)

## Comportamiento medido

Cada fila se ejecutó en un VS Code real, no es una intención de diseño:

| Verificación | Resultado |
|---|---|
| Menú contextual de medios en Markdown | 4 elementos para imágenes / 3 para mermaid / 4 para drawio; el portapapeles recibe el texto fuente exacto |
| Edición de drawio en el sitio | Bloque de código → archivo temporal → al guardar se reubica por contenido y se reescribe byte a byte |
| Renderizado XAML (controles reales de `Common.Resources` con `x:Class` y `Binding`) | **6/6 renderizados**; `Work.xaml` confirmado visualmente como la fila de botones "▶ ⏸ ⏹" |
| XAML de extremo a extremo en la webview | 3 ensamblados descubiertos → `ok:true` → imagen cargada 102×49 → 27 líneas de fuente → 0 violaciones de CSP / 0 errores de script |
| Iconos del subárbol frente al Explorador | Comparación CDP en máquina real de 6 archivos (`.md`/`.json`/`.mjs`) — **todos idénticos**; 3 usaban el genérico `file.svg` antes del arreglo |
| Enter dentro de un párrafo editable | Un Enter se rellena a línea en blanco y renderiza un párrafo nuevo; `Shift+Enter` mantiene el salto suave |

Ninguna fila es una estimación. Los elementos no verificados están en [Limitaciones conocidas](docs/limitations.es.md).

## Limitaciones conocidas (resumen)

1. **Sin sincronización de desplazamiento editor↔vista previa** (sin mapeo de origen `data-line`); el resaltado del índice no depende de ello.
2. **Simple Browser no se puede interceptar** — es un webviewPanel creado por comando y nunca entra en la competencia de customEditors.
3. **XAML es una instantánea estática**: sin DataContext, sin manejadores de eventos, sin bucle de mensajes; `App.xaml` y los hosts `BlazorWebView` no tienen contenido visual (un host Blazor en blanco es **correcto**).
4. **La caja de edición de párrafo no tiene resaltado de sintaxis** — es un `<textarea>` simple, cambiando resaltado por alineación con el texto y cero dependencias.
5. **`atime` y los bits de permisos POSIX del subárbol son siempre `-`** — el `FileStat` de VS Code no los expone.
6. **Los temas de iconos basados en fuente (p. ej. Seti) no tienen respaldo** — los iconos del subárbol usan un sprite dibujado por la extensión; solo se analizan los temas basados en SVG.

Los catorce elementos y la lista de no verificados están en [Limitaciones conocidas](docs/limitations.es.md).

## Licencia

MIT, ver [LICENSE](LICENSE).
