---
type: Guide
title: Vistas e interacción
description: Composición de la interfaz, gestos, atajos y contratos de mensajes de los nueve editores personalizados, la gestión de recursos personalizada, el panel de subárbol y el panel de visualización 3D
tags: [views, interaction, webview, gestures]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T15:50:00+08:00 }
---

# Vistas e interacción

[English](views-and-interaction.md) | [中文](views-and-interaction.zh-CN.md) | **Español**

## Resumen

| Vista | viewType | Cómo se abre | Prioridad |
|---|---|---|---|
| Navegación Markdown | `wispkit.markdown` | doble clic en `.md` / `.markdown` | `default` (toma el control) |
| Navegación de imágenes | `wispkit.image` | doble clic en `.png` `.jpg` `.jpe` `.jpeg` `.jfif` `.bmp` `.gif` `.ico` `.webp` `.avif` `.apng` `.svg` `.heic` `.heif` `.tif` `.tiff` `.jxl` | `default` (toma el control) |
| Navegación de vídeo | `wispkit.video` | doble clic en `.mp4` `.m4v` `.mov` `.webm` `.ogv` `.mkv` `.avi` `.wmv` `.flv` `.mpg` `.mpeg` `.m2ts` `.3gp` `.3g2` `.rm` `.rmvb` | `default` (toma el control) |
| Navegación HTML | `wispkit.html` | doble clic en `.html` / `.htm`; *Reopen Editor With…* / `wispkit.openWith` | `default` (toma el control) |
| Navegación XAML | `wispkit.xaml` | doble clic en `.xaml` | `default` (toma el control) |
| Texto de solo lectura | `wispkit.text` | automático al activar el modo de solo lectura global | `option` (gobernado por asociaciones) |
| Atajo de Windows | `wispkit.shellLink` | *Reabrir editor con…* / `wispkit.openWith`; también lo abre `wispkit.shellLink.openBehavior` | `option` (cambio explícito) |
| Ejecutable | `wispkit.executable` | *Reabrir editor con…* / `wispkit.openWith`; también lo abre `wispkit.executable.openBehavior` | `option` (cambio explícito) |
| Gestión de recursos personalizada | `wispkit.resourceTree` (TreeView) | icono de Wispkit en la barra de actividades → «Gestión de recursos personalizada» | no es un editor |
| Panel de subárbol | `wispkit.subtree` (webviewPanel) | icono a la derecha de una fila de carpeta del Explorador / comando | no es un editor |
| Navegación Mermaid | `wispkit.mermaid` | doble clic en `.mmd` / `.mermaid` | `default` (toma el control) |
| Navegación 3D de gráficos | `wispkit.graph3d` (webviewPanel) | clic derecho en `.md` / `.markdown` / `.mmd` / `.mermaid` del Explorador → «Navegación 3D de gráficos»; o la paleta de comandos | no es un editor |

El comando `wispkit.openWith` elige la vista según la extensión (`viewTypeFor` en `src/extension.ts`); cuando nada coincide muestra «Wispkit no tiene vista para este tipo de archivo».

## Vista Markdown (`wispkit.markdown`)

### Composición

```text
┌──────────────┬────────────────────────────────────────────┐
│ Índice       │ Cuerpo (misma tipografía que la vista      │
│ h1..h6       │ previa incorporada)                        │
│ (ancho       │ bloques de código / tablas / mermaid /     │
│ ajustable,   │ drawio / imágenes                          │
│ plegable)    │                                            │
└──────────────┴────────────────────────────────────────────┘
```

Los iconos de la barra son un sprite SVG en línea: cada icono lleva atributos `width` / `height` como respaldo y un conjunto mínimo de estilos críticos se inserta antes de las hojas de estilo externas. Así, al abrir un Markdown nunca aparece el destello de «iconos enormes que luego vuelven a su tamaño normal».

### Índice de contenido

- El árbol se construye a partir de `h1..h6` **dentro del webview** y **no** depende del mapeo de origen `data-line` — por eso no se necesita ningún protocolo de sincronización de desplazamiento entre editor y vista previa.
- La sección actual se resalta al desplazarse; al pulsar una entrada se salta a ella y se le da el foco.
- El ancho del panel se puede arrastrar y **hacer doble clic en el divisor lo restablece**; se puede plegar con un clic (el cuerpo pasa entonces a ocupar todo el ancho).
- Por defecto se listan los seis niveles de encabezado que admite la especificación Markdown (`h1..h6`); `wispkit.toc.depth` permite reducirlos (por defecto 6) y `wispkit.toc.enabled` desactiva todo el panel.

### Zoom del cuerpo y búsqueda

- La barra de herramientas ofrece controles `− / porcentaje / +` con 13 pasos fijos (50%–300%, incluido 100%); pulsar el porcentaje restablece el 100%. `Ctrl+-` / `Ctrl+=` / `Ctrl+0` y `Ctrl+rueda` son equivalentes. El zoom se aplica solo a la capa del cuerpo —el índice y la barra no crecen— y el paso se recuerda por documento. El zoom también compensa las mediciones de tamaño de mermaid / drawio: escriben el resultado de `getBoundingClientRect()` en píxeles CSS y, sin compensación, un `zoom` ancestro los escalaría dos veces.
- `Ctrl+F` abre una barra de búsqueda arriba a la derecha: al escribir se resaltan todas las coincidencias y se muestra `actual/total`; `Enter` / `Shift+Enter` y `F3` / `Shift+F3` saltan entre coincidencias, `Aa` alterna la distinción de mayúsculas y `Esc` cierra la barra y limpia el resaltado. Si hay texto seleccionado en el cuerpo, `Ctrl+F` lo usa como consulta inicial.
- Los motores modernos registran objetos `Range` mediante la CSS Custom Highlight API y **no modifican el DOM**; los motores antiguos sin esa API envuelven en `<mark>` las coincidencias contenidas en un solo nodo. La búsqueda nunca entra en bloques mermaid / drawio ni en SVG, de modo que los rangos no se invalidan cuando un script de terceros reemplaza el contenido de forma asíncrona.

### Rendimiento con documentos grandes

Cuando el cuerpo tiene unos 4000 elementos, o 40 tablas / bloques de código / diagramas, o más de 180 000 caracteres de texto plano, la capa del cuerpo pasa a virtualización: los bloques de nivel superior fuera de la ventana se omiten en maquetación y pintado con `content-visibility: auto`. **Los bloques de diagrama son la excepción**: la extensión mermaid mide el SVG después de renderizar para fijar la altura del contenedor, y omitir su maquetación mediría 0×0; por eso cualquier bloque de nivel superior que contenga svg / mermaid / drawio conserva siempre la maquetación real (clase CSS `wispkit-virtualize-keep`), mientras que las demás tablas, bloques de código y párrafos sí se omiten. El resaltado del índice al desplazarse cachea las posiciones de los títulos y las busca por bisección, recalculándolas solo cuando cambian el ancho, el cuerpo renderizado o `scrollHeight`; al saltar lejos desde el índice se corrige la posición fotograma a fotograma hasta que tres fotogramas consecutivos queden dentro de 1 px (como máximo 1,2 s; la corrección se cancela en cuanto el usuario se desplaza o hace clic en el cuerpo). La virtualización se desactiva temporalmente mientras la barra de búsqueda está abierta para que cada `Range` tenga maquetación y se pueda resaltar y desplazar con precisión; se restaura al cerrarla.

### Menú contextual de medios

| Objeto pulsado con clic derecho | Elementos del menú | Qué ocurre al pulsar |
|---|---|---|
| Imagen normal | Ampliar / Guardar como… / Copiar ruta / Copiar texto Markdown | Guardar como pasa por el diálogo de guardado del sistema; copiar ruta toma la ruta absoluta; copiar texto Markdown toma el `![alt](src)` del original |
| Diagrama mermaid | Ampliar / Guardar como SVG… / Copiar fuente | Copiar fuente toma el texto dentro del bloque ` ```mermaid ` |
| Diagrama drawio | Ampliar / **Abrir en el editor Draw.io** / Guardar como SVG… / Copiar fuente | véase la sección siguiente |

«Ampliar» es un **modal que ocupa la ventana principal**, con zoom de rueda y desplazamiento arrastrando con el botón derecho (la misma implementación de panzoom que la vista de imagen); `Esc` o un clic en el fondo lo cierran.

El front-end informa solo `{ action, kind, index, alt?, src? }`; **la ruta real y la fuente las obtiene el host del Markdown original** (`src/media/parse.ts`, funciones puras, 20 pruebas unitarias). Las imágenes además se verifican de forma cruzada con `alt`, así que un índice desplazado también se puede recuperar.

### Edición drawio en el sitio

La extensión drawio 1.17.0 ya ha entregado la edición al nuevo editor Markdown (`markdown.codeBlockEditorProviders`); el editor personalizado no tiene ese host, así que Wispkit lo cablea por su cuenta:

1. localizar el bloque de código a partir del índice informado por el front-end y extraer el contenido XML;
2. escribirlo en un archivo `.drawio` temporal;
3. abrirlo con `vscode.openWith(..., 'hediet.vscode-drawio-text')`;
4. al guardar, **volver a localizar por contenido** y escribir de vuelta — aunque el documento se haya editado en otro sitio mientras tanto, el reemplazo nunca cae en el lugar equivocado.

### Tema de tres estados (claro / seguir tema / oscuro)

El lado derecho de la barra de herramientas es un grupo de tres botones de icono: claro a la izquierda, **seguir tema** en el centro y oscuro a la derecha; el central está seleccionado por defecto.

- **Seguir tema** no fuerza ningún color y sigue leyendo las variables del tema de color actual de VS Code; cuando VS Code cambia entre claro y oscuro, el cuerpo y los diagramas lo acompañan.
- **Claro / oscuro** fuerzan solo la apariencia del **navegador Markdown** (una clase `wispkit-theme-*` en `<html>` más sobrescrituras `!important` de las variables `--vscode-*`). El tema de VS Code y las vistas de imagen / HTML / XAML no se tocan. La paleta es la Light+ / Dark+ predeterminada de VS Code; «forzado» significa *no* seguir, así que la paleta de un tema personalizado deliberadamente no se traslada.
- El estado es **global**: cambiar en una pestaña Markdown actualiza al instante todas las vistas Markdown abiertas; las vistas nuevas lo heredan de `globalState` (`wispkit.markdown.themeMode`), por lo que sobrevive a un reinicio de VS Code. **No** es una propiedad del documento md actual.
- Los modos forzados también reescriben las clases `vscode-light` / `vscode-dark` del `body` para que las reglas de borde del `markdown.css` incorporado y la paleta de diagramas de la extensión de vista previa mermaid queden del mismo lado; al volver a «seguir tema» se restaura el tipo real del host.

### Modo edición (edición de párrafos en el sitio)

El control «Editar» de la barra de herramientas es un interruptor deslizante (`role="switch"`, cuyo estado se expresa **solo** por `aria-checked`). Una vez activado, **al pulsar cualquier párrafo del cuerpo** ese párrafo se convierte en un `<textarea>` en el sitio, mientras los demás siguen renderizados — sin panel dividido, sin un segundo editor.

| Acción | Comportamiento |
|---|---|
| Un clic en un párrafo | Ese párrafo se convierte en un cuadro de edición in situ que contiene el código Markdown de ese párrafo (literal, sin añadir líneas en blanco separadoras) |
| `Enter` | Inserta una línea en blanco (`\n\n`) — un solo salto de línea solo es un salto suave en CommonMark, así que la línea en blanco es lo que realmente separa el párrafo |
| `Shift+Enter` | Salto suave dentro del párrafo, permanece en el mismo párrafo |
| `Ctrl+Enter` (`Cmd+Enter` en macOS) | Confirma el párrafo actual: escribe de vuelta todo el código y guarda de inmediato |
| `Esc` | Descarta los cambios del párrafo actual |
| `Ctrl+S` (`Cmd+S` en macOS) | Guarda todo el documento; un cuadro de edición sin confirmar se confirma primero |

El mapeo se basa en el `data-line` (línea inicial) que el motor incorporado asocia a cada token de nivel de bloque. La línea final de un párrafo se infiere como **la línea inicial del siguiente bloque menos uno**, con el total de líneas del origen como respaldo para el último párrafo; los intervalos son semiabiertos `[inicio, fin)`. Esta capa son funciones puras (`media/shared/paragraph.js`) con pruebas unitarias — las estructuras anidadas (elementos de lista, citas, interior de bloques de código) son la parte menos precisa de este esquema.

El guardado pasa por un `WorkspaceEdit` que reemplaza el documento completo y entra en la pila de deshacer normal. El código completo se pide al host **solo al entrar en modo edición** (`wispkit.requestSource`), así que la vista previa pura nunca paga ese coste.

### Contrato de mensajes

| Front-end → host | Carga útil | Respuesta del host |
|---|---|---|
| `wispkit.requestSource` | ninguna | el texto del código fuente |
| `wispkit.render` | `requestId`, `text` | `{ requestId, html }` (el host conserva la rama; tras confirmar un párrafo el re-render viene de `onDidChangeTextDocument` y el front-end ya no lo envía) |
| `wispkit.save` | `requestId`, `text` | `wispkit.saveResult { requestId, ok }` |
| `wispkit.media` | `action`, `kind` (`image`/`mermaid`/`drawio`), `index`, `alt?`, `src?`, `data?` | ninguna (el host lo ejecuta él mismo) |
| `wispkit.openLink` | `href` (el **valor crudo del atributo** del `<a>`, no la URL absoluta resuelta por el navegador) | ninguna (el host lo resuelve respecto al directorio del documento y lo abre) |
| `wispkit.setTheme` | `mode` (`light` / `auto` / `dark`) | tras escribir `globalState`, el host difunde `wispkit.theme { mode }` a **todas** las vistas Markdown |

### Tipografía

La familia, el tamaño y la altura de línea del `markdown.css` incorporado leen las variables `--markdown-font-family` / `--markdown-font-size` / `--markdown-line-height`. Wispkit alimenta esas variables con los ajustes `markdown.preview.*`, de modo que el cuerpo coincide carácter a carácter con la vista previa incorporada.

La conversión copia la incorporada (`documentRenderer.ts:211-213`): a `fontSize` se le añade el sufijo `px`, mientras que `lineHeight` se **emite tal cual** (un número significa un múltiplo del tamaño de fuente; el valor por defecto incorporado es 1.6). Añadir `px` a `lineHeight` hace que la altura de línea sea `1.6px`, y el cuerpo, los bloques de código y el índice se solapan — es una trampa en la que este proyecto cayó de verdad, y `src/test/markdownPage.test.ts` lleva una aserción de regresión para ella. **No** escribas la forma abreviada `font` en `body`: sobrescribiría esas tres variables.

## Vista de imagen (`wispkit.image`)

| Gesto | Comportamiento |
|---|---|
| Rueda | Hace zoom directamente (sin Ctrl), anclado en la **posición del cursor**, para que el centro de la vista no salte; con `wispkit.image.wheelZoom=false` vuelve a «se requiere Ctrl» |
| Mantener `wispkit.image.dragButton` (botón derecho por defecto) y arrastrar | Desplaza |
| Doble clic | Alterna entre «ajustar a la ventana» y «100 %» |
| Zoom ≥ 3× | El render pasa a `pixelated` para que no se emborrone |

El paso de zoom viene de `wispkit.zoom.wheelStep` (por defecto 1.1); el mismo panzoom lo usan también el modal de Markdown y el render XAML.

### Cobertura de formatos

- **Decodificados directamente por el runtime**: PNG / JPG / JPEG / JFIF / BMP / GIF / ICO / WebP / AVIF / APNG / **SVG**.
- **SVG usa escalado vectorial**: en lugar de `transform: scale()`, cambia el ancho/alto de maquetación del `<img>` (`scaleMode: 'box'` de panzoom), de modo que el navegador lo redibuja como vector en cada nivel de zoom; la pista de estado lo marca como imagen vectorial.
- **Formatos sin decodificador en el runtime**: HEIF / HEIC / TIFF / JXL. Chromium no incluye decodificadores para ellos y añadir libheif u otros decodificadores WASM supondría varios MB, algo que esta extensión evita deliberadamente. Estos archivos siguen abriéndose en la vista de imagen, pero la página muestra el **motivo** y ofrece dos botones:
  - «Abrir con la aplicación predeterminada del sistema» — entrega el archivo al sistema operativo (en Windows, Fotos puede leer HEIF si está instalada la extensión HEIF);
  - «Copiar ruta» — copia la ruta absoluta para convertirlo con otra herramienta.
- Los archivos corruptos o con extensión que no coincide con el contenido caen en el mismo panel de respaldo en vez de dejar una página en blanco.

## Vista de vídeo (`wispkit.video`)

| Acción | Comportamiento |
|---|---|
| Doble clic en un vídeo habitual | Abre la vista de vídeo y lo reproduce con el `<video controls>` nativo de Chromium; sin reproductor propio ni bibliotecas de terceros |
| Reproducir / pausar / buscar / volumen / pantalla completa | Todo delegado en los controles nativos; doble clic sobre la imagen alterna la pantalla completa |
| «Abrir en el reproductor del sistema» arriba a la derecha | Entrega el archivo al reproductor predeterminado del sistema (`vscode.env.openExternal`) |
| «Copiar ruta» arriba a la derecha | Copia la ruta absoluta al portapapeles |
| Cambiar a otra pestaña | Se pausa automáticamente para no seguir sonando en segundo plano |

- **La reproducción depende de los códecs del runtime**: MP4 con H.264 / AAC y WebM con VP8 / VP9 suelen reproducirse directamente; MKV / AVI / WMV / FLV / RMVB y contenedores similares normalmente solo obtienen el respaldo. Cuando `<video>` informa `MEDIA_ERR_SRC_NOT_SUPPORTED`, la página muestra el motivo y la indicación de abrir con el reproductor del sistema, en lugar de un rectángulo negro silencioso.
- La barra de estado muestra «formato · resolución · duración»; las duraciones desconocidas (archivos en streaming) muestran «duración desconocida».
- **`.ts` / `.mts` no se registran a propósito**: son extensiones de código TypeScript y registrarlas como vídeo secuestraría todos los archivos TS; MPEG-TS solo se cubre mediante `.m2ts`.
- La CSP permite `media-src ${cspSource}` para los recursos del webview mientras los scripts siguen exigiendo nonce; los vídeos se cargan directamente con `asWebviewUri`, sin copiar ni transcodificar.

## Vista HTML (`wispkit.html`)

- Usa una **CSP relajada**: se permiten scripts en línea y recursos http(s) — navegar HTML necesita por definición que los scripts propios de la página se ejecuten.
- Reescribe `href="vscode://file/<ruta>[:<línea>]"` como `command:vscode.open?<args>` y activa `enableCommandUris` en el webview; los enlaces `vscode://` no reescritos también están en la lista blanca del host. Es el **respaldo sin scripts**: si la CSP propia de la página bloquea el script inyectado, estos dos tipos de enlace siguen funcionando.
- Inyecta `media/dist/html.js` (`<script defer>`) como **enrutador de enlaces**: intercepta los clics en `<a>` en la fase de burbujeo de `document` y devuelve el `href` crudo a la extensión mediante `wispkit.openLink`. Los enlaces relativos ya no se resuelven con `<base>` a una URL de recurso del webview y se entregan al navegador del sistema; los enlaces `#ancla`, `command:` y los esquemas que el shell ya soporta (`http(s)` / `mailto` / `vscode:` que no sea file) no se interceptan.
- Los manejadores de clic propios de la página se ejecutan primero; un enlace cuyo comportamiento por defecto ya se ha prevenido (habitual en SPA) no se secuestra.

## Vista XAML (`wispkit.xaml`)

### Interfaz

Panel de código a la izquierda (editable) y la imagen renderizada a la derecha, con un divisor arrastrable en medio. El panel de código se puede ocultar (`wispkit.xaml.codeVisible`) y su ancho lo controla `wispkit.xaml.codeWidth` (por defecto 460 px).

- El área de código tiene un **resaltador ligero propio**: la capa de resaltado se apila bajo un `<textarea>` cuyo texto es transparente para que solo se vea el cursor, por lo que la salida debe ser **idéntica byte a byte** a la entrada (un carácter de menos o de más y el cursor se desplaza).
- La imagen renderizada admite zoom de rueda y desplazamiento arrastrando; al pulsarla se abre un modal a pantalla completa.
- Tras editar, guardar escribe de vuelta en el archivo `.xaml` original.

### Cadena de llamada del render

1. Buscar **hacia arriba nivel a nivel** desde el directorio del `.xaml` los `bin/(Release|Debug)/<tfm>/*.dll`;
2. llamar al proceso .NET externo; el contrato está congelado como `<renderer> render <in.xaml> <out.png> [--assembly <dll>]...`;
3. el renderizador prueba los tipos raíz en orden — `--class` (que esta extensión no pasa) → el `x:Class` del XAML → **la clase base WPF del elemento raíz** (`<Window>` → `System.Windows.Window`, `<UserControl>` → …); cada candidato se combina con dos variantes de texto («tal cual» y «sin `x:Class` ni manejadores de eventos»), y después `XamlObjectWriterSettings.RootObjectInstance` deja que el XAML rellene esa instancia (`mode=rootObjectInstance`). Los constructores de ventanas reales suelen depender de DI o de singletons de App y no se pueden `new`-ear, así que **la clase base es la ruta principal**; solo si fallan todos los candidatos recurre a `XamlReader.Parse` (`mode=parse`);
4. el PNG resultante se devuelve a la página.

Cuando el render falla, la página muestra un panel de error con las causas habituales en lugar de una pantalla en blanco.

## Vista de archivo Mermaid (`wispkit.mermaid`)

Haz doble clic en un archivo `.mmd` / `.mermaid`. El host entrega todo el código fuente al script de vista previa de Mermaid integrado en VS Code; la página es una barra de herramientas más el diagrama:

- la insignia muestra el tipo de diagrama y los recuentos de nodos / aristas (el mismo analizador que el panel 3D, `src/graph3d/mermaid.ts`);
- **Navegación 3D de gráficos** entrega el diagrama a `wispkit.graph3d`; el desplegable contiene una sola entrada `1. título · tipo · N nodos / M aristas`;
- **Fuente** abre el mismo archivo en un editor de texto normal junto a la vista previa;
- **Actualizar** relee el archivo y vuelve a renderizar; los cambios de texto en un editor se aplican en el sitio tras un debounce de 300 ms.

El diagrama se **centra horizontalmente** mediante el script integrado (el mismo canal de renderizado que un diagrama Mermaid en la vista previa Markdown): la página solo hace que `.mermaid-wrapper` ocupe toda la fila y no añade un centrado flex propio — de lo contrario, el `transform` que el script integrado calcula como `(ancho del contenedor − ancho del SVG) / 2` se aplicaría dos veces y el diagrama quedaría desplazado a la derecha.

Cuando no hay un script de vista previa de Mermaid disponible (por ejemplo en un VS Code más antiguo), la vista degrada a modo fuente: la barra, la entrada 3D y la insignia no cambian, el cuerpo pasa a `<pre>` y un aviso explica el motivo.

Contrato de mensajes: webview → host `wispkit.mmd.refresh` / `wispkit.mmd.openSource` / `wispkit.mmd.open3d`; host → webview solo `wispkit.mmd.update { source, status, hint? }`. Al actualizar, el front-end reescribe el textContent del contenedor `.mermaid` y emite `vscode.markdown.updateContent`, que el script integrado escucha.

## Vista de texto de solo lectura (`wispkit.text`)

- Una vez activado el modo de solo lectura global, `.ts` / `.json` / `.txt` / `.log` y otros (decididos por `wispkit.readonly.extensions`) se abren como vista previa de solo lectura.
- Solo se leen **los primeros N bytes del archivo** (`wispkit.readonly.previewBytes`, 64 KB por defecto), y luego se trunca por líneas (`wispkit.readonly.previewLines`, 800 por defecto).
- La página tiene números de línea y un **resaltador de sintaxis genérico propio** (nivel comentario / cadena / número / palabra clave, no coloreado con precisión de TextMate).
- Un botón flotante de «desbloquear edición» en la esquina inferior derecha abre el archivo en el editor nativo (editable) y deja pasar ese archivo durante el resto de la sesión.
- Las vistas de navegación que Wispkit ya posee (Markdown / HTML / XAML / imágenes) **no se ven afectadas por el modo de solo lectura** — ya son vistas de navegación, y truncar Markdown produciría un render roto.

## Vista de acceso directo (`wispkit.shellLink`)

Un archivo `.lnk` de Windows es un binario pequeño que registra «a qué apunta» un acceso directo. Esta vista lo analiza y muestra la ruta de destino, el directorio de trabajo, los argumentos de inicio, la ubicación del icono, la etiqueta del volumen, la máquina que lo creó y los bits de banderas, sin lanzar nada. Está registrada como editor `option`, así que un doble clic en un acceso directo sigue ejecutándolo; la página de propiedades se alcanza con *Reabrir editor con…* o `wispkit.openWith`.

**Qué ocurre al abrir un `.lnk`** lo decide `wispkit.shellLink.openBehavior`:

| Valor | Comportamiento |
|---|---|
| `system` (predeterminado) | entregar el acceso directo a Windows — lo mismo que hace un doble clic en el Explorador |
| `internal` | abrir el destino dentro de Wispkit: una carpeta va al panel de subárbol, un archivo se abre en su vista correspondiente |
| `ask` | preguntar cada vez cuál de las dos opciones |

Cuando el comportamiento es `internal` y el destino parece una carpeta, `wispkit.shellLink.folderTarget` decide dónde aterriza: `subtree` (predeterminado) abre el panel de subárbol para esa carpeta, `system` lo entrega al gestor de archivos del sistema.

**Edición** (solo Windows) reescribe la ruta de destino, el directorio de trabajo, los argumentos y el comentario a través del objeto de accesos directos del host de scripts de Windows: primero se abre el acceso directo existente y solo se guardan los campos que el usuario cambió de verdad, de modo que el icono, la tecla de acceso rápido y todo lo demás del archivo quedan como estaban. Poner `wispkit.shellLink.allowEdit` en `false` oculta el formulario y deja la página de solo lectura.

**Directorio de trabajo.** Iniciar un acceso directo **no** sobrescribe el directorio de inicio guardado dentro de él. Eso es lo que hace un doble clic, y envolver el lanzamiento en otro directorio cambiaría en silencio el significado del acceso directo.

## Vista de ejecutable (`wispkit.executable`)

Un archivo `.exe` abierto aquí muestra su estructura PE: el formato (`PE32` o `PE32+`), la arquitectura, el subsistema, si la imagen es una DLL, si lleva un ensamblado .NET, el RVA del punto de entrada, la base de imagen, la tabla de secciones y los recursos de versión. También es un editor `option`, así que los `.exe` siguen lanzándose con doble clic.

`wispkit.executable.openBehavior` decide qué significa «abrir»:

| Valor | Comportamiento |
|---|---|
| `system` (predeterminado) | iniciar el ejecutable |
| `viewer` | abrir esta página de propiedades |
| `ask` | preguntar primero |

**Directorio de trabajo.** Un ejecutable iniciado desde Wispkit se ejecuta con **su propio directorio** como directorio de trabajo (`Start-Process -WorkingDirectory` en el host), de modo que un programa que busca archivos junto a sí mismo los encuentra. El acceso directo es el caso contrario — véase la sección anterior.

**Comandos.** Se aportan seis comandos de menú contextual en la fila del Explorador de estos dos tipos de archivo, cada uno en el tipo al que se aplica: `wispkit.openDefault` (abrir de la forma configurada), `wispkit.shellLink.openSystem`, `wispkit.shellLink.openTarget`, `wispkit.shellLink.openViewer`, `wispkit.executable.openSystem` y `wispkit.executable.openViewer`.

## Gestión de recursos personalizada (`wispkit.resourceTree`)

### Entrada e interfaz

El icono **Wispkit** de la barra de actividades (`media/wispkit-activity.svg`) abre la vista «Gestión de recursos personalizada». Es un `TreeView` nativo (no un webview), así que su aspecto, el plegado, el arrastre y los menús contextuales siguen el tema actual de VS Code.

- **Sin espacio de trabajo**: el cuerpo de la vista indica «abre primero una carpeta del espacio de trabajo; el árbol de recursos se guarda en `.WispkitView/resource-tree.json` de la primera carpeta».
- **Árbol vacío**: la página de bienvenida ofrece «Nuevo grupo virtual» y «Añadir carpeta», y avisa de que no se mueve ni se elimina ningún archivo del disco.
- **Descripción de la vista**: a la derecha del título se muestra la ruta relativa al espacio de trabajo del archivo de almacenamiento actual; fuera de él o en un espacio que no sea `file`, la ruta absoluta / el URI.
- **Error de configuración / fallo de lectura**: el cuerpo de la vista mantiene el diagnóstico (marcador no resoluble, JSON inválido, ruta que es un directorio…) y el árbol actual no se toca.

### Dos tipos de nodo: grupo virtual vs carpeta

| Nodo | Icono | En disco | Notas |
|---|---|---|---|
| Grupo virtual (`group`) | `folder-library` | **ninguna carpeta del disco** | solo para nombrar y agrupar; puede contener grupos o carpetas; al pulsarlo avisa de que no se puede navegar |
| Carpeta (`folder`) | `folder`; `warning` si está rota | un directorio real; `path` guarda una ruta absoluta o un marcador de espacio de trabajo | al pulsarla se abre en el panel de subárbol; puede contener hijos |

- **Ambos tipos pueden tener hijos**, así que la «profundidad arbitraria» se expresa con un único conjunto de reglas. Topes por defecto: 2000 nodos en total, 200 hijos por nivel, profundidad 12.
- La `description` de una carpeta muestra la ruta relativa al espacio de trabajo (ruta absoluta para carpetas fuera de él); si la ruta no existe / apunta a un archivo / no se puede resolver el marcador, muestra `⚠ Carpeta no encontrada` / `⚠ No es una carpeta` / `⚠ No se puede resolver la ruta` y el icono pasa a advertencia.
- Renombrar, mover y eliminar actúan solo sobre este árbol: **no se renombra, mueve ni elimina ningún archivo del disco**.

### Comandos del título de la vista

| Comando | Ubicación | Comportamiento |
|---|---|---|
| Nuevo grupo virtual | barra de título | crea un grupo en la raíz o bajo el nodo seleccionado |
| Añadir carpeta | barra de título | abre el selector de carpetas del sistema; permite multiselección y cada carpeta se añade como nodo; las entradas que no son directorios se omiten con un aviso |
| Actualizar | barra de título | relee el JSON; con JSON inválido / fallo de lectura conserva el árbol actual y avisa, nunca sobrescribe el archivo |
| Importar árbol de recursos… | menú desbordado del título | elige un JSON y **reemplaza todo el árbol** tras confirmar; un archivo inválido se rechaza antes del diálogo de confirmación |
| Exportar árbol de recursos… | menú desbordado del título | escribe el árbol actual en un archivo JSON que elijas |
| Abrir JSON del árbol de recursos | menú desbordado del título | abre el archivo de almacenamiento actual; si no existe, escribe primero el árbol actual (vacío en el primer uso) |

### Comandos del menú contextual de los nodos

| Comando | Se aplica a | Comportamiento |
|---|---|---|
| Explorar carpeta | carpeta (icono en línea al pasar el ratón / menú contextual) | abre ese directorio en el panel de subárbol |
| Copiar ruta | carpeta (menú contextual) | copia la ruta absoluta de la carpeta al portapapeles del sistema; solo resuelve marcadores, no exige que el directorio exista (también sirve para recursos de red desconectados) |
| Abrir en la terminal integrada | carpeta (icono en línea / menú contextual) | abre el directorio en la terminal integrada de VS Code; la pestaña usa el nombre visible / alias |
| Abrir en terminal del sistema | carpeta (submenú del menú contextual) | abre una ventana de terminal del sistema fuera de VS Code. Windows: Símbolo del sistema (cmd), PowerShell, Símbolo del sistema (Administrador), PowerShell (Administrador); macOS: Terminal.app; Linux: prueba gnome-terminal → konsole → xfce4-terminal → xterm. Las entradas de administrador muestran la confirmación UAC |
| Abrir en VS Code | carpeta (menú contextual) | abre el directorio como espacio de trabajo en una **ventana nueva**, sin reemplazar la actual |
| Abrir en el explorador del sistema | carpeta (menú contextual) | entrega el directorio al sistema operativo (Explorador de Windows) |
| Nuevo grupo virtual / Añadir carpeta | grupo o carpeta | crea un nodo hijo bajo él |
| Renombrar | grupo o carpeta | cambia solo el nombre visible en el árbol, nunca el directorio del disco |
| Mover a… | grupo o carpeta | selector rápido de grupo / carpeta destino (incluida «Raíz»); moverse a sí mismo o a un descendiente se rechaza |
| Subir / Bajar | grupo o carpeta | reordena los hermanos |
| Eliminar | grupo o carpeta | lo quita del árbol (con su subárbol) tras confirmar; **no elimina archivos del disco** |

Al hacer clic derecho en una **carpeta** del Explorador también aparece «Añadir a la gestión de recursos personalizada», que la añade a la raíz. Con una sola selección pide un nombre visible; con multiselección añade todas las carpetas en lote usando el nombre de la carpeta (sin preguntar por cada una), omite los archivos y demás entradas que no son directorios con un aviso resumen, y añade la misma ruta solo una vez por lote.

### Arrastrar y soltar

| Origen → destino | Comportamiento |
|---|---|
| Elemento de la vista → grupo / carpeta | mueve el nodo (admite multiselección); los nodos cuyo destino está dentro de sí mismos o de un descendiente no se mueven |
| Elemento de la vista → zona vacía | lo mueve a la raíz |
| Carpeta del Explorador → grupo / carpeta / zona vacía | la añade como nodo de carpeta; al soltarla en un contenedor se convierte en hija; las entradas que no son directorios se omiten con un aviso |

Los arrastres internos usan un MIME privado (`application/vnd.code.tree.wispkit.resourcetree`) y las entradas externas usan `text/uri-list`; el host vuelve a validar los tipos de nodo y los ciclos en el destino, y un movimiento ilegal deja el árbol sin cambios.

### Almacenamiento y actualización

- La ubicación por defecto es la **primera carpeta del espacio de trabajo**: `.WispkitView/resource-tree.json`; `wispkit.resourceTree.file` puede cambiarla (relativa a la primera carpeta, con `${workspaceFolder}` / `${workspaceFolder:nombre}` / `${workspaceFolder:índice}` y rutas absolutas).
- El archivo es JSON plano: `{ "version": 1, "roots": [...] }`. Cada alta, renombrado, movimiento o borrado lo reescribe automáticamente con la escritura «archivo temporal hermano + rename».
- **Las ediciones externas no aparecen solas**: la extensión no vigila este archivo, así que tras editar el JSON hay que pulsar Actualizar en el título de la vista. La actualización conserva en lo posible la expansión / selección.
- JSON inválido, un directorio o un error de permisos: la actualización falla con el motivo y tanto el árbol actual como el archivo quedan intactos; al cambiar `wispkit.resourceTree.file` se recarga el nuevo archivo automáticamente.

## Panel de subárbol (`wispkit.subtree`)

### Cómo se abre

Cada **fila de carpeta** del Explorador tiene dos iconos a su derecha: «Mostrar» a la izquierda (`wispkit.wispkitView.open`) y «Explorar subárbol» a la derecha (`wispkit.subtree.open`). Ambos comandos aparecen solo cuando la fila es una carpeta, y ninguno aparece en la paleta de comandos.

**La misma carpeta reutiliza el mismo panel**: volver a pulsar solo revela el panel existente en lugar de abrir un montón de ellos.

### Interfaz

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ Cabecera: Nombre | Tamaño | Tipo | Modificado | Creado | Propietario          │
├───────────────────────────────────────────────────────────────────────────────┤
│ ▸ CarpetaA                                                                    │
│   ▸ CarpetaB                                                                  │
│     archivo.txt                                                               │
├───────────────────────────────────────────────────────────────────────────────┤
│ Área de acciones (derecha): operaciones de archivo                            │
│   (cortar/copiar/pegar/renombrar/eliminar/crear/comparar)                     │
│   comandos de extensiones (con distintivo de origen) · herramientas propias   │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Carga diferida**: un nivel solo se lee cuando se expande; nunca se recorre todo el árbol de una vez.
- **Columnas configurables**: se renderizan estrictamente en el orden de `wispkit.subtree.columns`; la cabecera y las filas de datos comparten las variables `--wispkit-col-*` para mantenerse alineadas. Las propiedades no disponibles muestran `-` en lugar de fallar (`atime` y los bits de permiso POSIX son siempre `-`).
- **Iconos de archivo**: las filas `.lnk` y `.exe` muestran el icono **incrustado en el propio archivo** — en Windows mediante la misma asociación de shell con la que el Explorador dibuja iconos, de modo que un acceso directo muestra el icono del programa al que apunta y no un símbolo de enlace genérico. Todo lo demás recurre al tema de iconos del usuario y luego a los sprites integrados; cuando el icono real no puede leerse se usa el del tema, nunca un marcador de posición.
- **Salto por teclado**: pulsa una letra o un dígito para saltar a la primera entrada que empiece por él; pulsar el mismo carácter otra vez recorre la lista hacia abajo y vuelve al principio. Letras, dígitos y nombres chinos se comparan por prefijo simple — en chino se usa el texto que confirma el método de entrada y no hay tabla de pinyin. Pon `wispkit.subtree.typeAhead` en `false` para desactivarlo.
- **Ordenación**: pulsa una cabecera para ordenar por esa columna; la lógica pura vive en `src/subtree/sort.ts`.

### Los tres tipos de acciones del área de acciones

| Tipo | Origen | Notas |
|---|---|---|
| Operaciones de archivo (nativas) | integradas en Wispkit | cortar / copiar / pegar / renombrar / eliminar / nuevo archivo / nueva carpeta / comparar, más **terminal del sistema** y **abrir con la aplicación predeterminada**. **Tienen que ser propias**: los comandos incorporados `filesExplorer.*` no aceptan URI externos |
| Comandos aportados por extensiones | recogidos automáticamente | recorre `contributes.menus['explorer/context']` de las extensiones instaladas y comprueba que el comando existe antes de ejecutarlo |
| Lista de permitidos incorporada | enumerada a mano | validada con `commands.getCommands(true)` antes de ejecutar; si falta lo dice en lugar de quedarse en silencio |
| Herramientas propias | `wispkit.subtree.tools` | admite `${file}` `${dir}` `${name}` `${workspaceFolder}`; cuatro modos de ejecución abajo |

| `shell` | Comportamiento |
|---|---|
| `silent` | se ejecuta en segundo plano, sin ventana |
| `currentTerminal` | escribe en la terminal activa |
| `newTerminal` | crea una terminal y escribe en ella |
| `external` | inicia una ventana de terminal del sistema como proceso independiente |

**El destino es la fila seleccionada en el panel, no la fila seleccionada en el Explorador** — todos los botones del área de acciones actúan sobre la fila actualmente seleccionada en el panel de subárbol.

**Abrir en el terminal** (`openInTerminal`) y **Terminal del sistema** se parecen y son deliberadamente distintos: el primero escribe en un terminal que gestiona el editor, el segundo abre una ventana propia que sigue viva cuando el editor se cierra. Su submenú solo lista los terminales que la plataforma actual realmente ofrece —cmd y PowerShell, cada uno con variante elevada en Windows; Terminal.app en macOS; el terminal de escritorio en Linux— y la ventana arranca en la carpeta seleccionada, o en la carpeta del archivo seleccionado.

**Abrir con la aplicación predeterminada** (`vscode.open`) entrega la selección a la aplicación que el sistema operativo tiene registrada, que es lo mismo que hace el doble clic. Permanece deshabilitada cuando la selección contiene una carpeta: abrirla así produciría otra ventana, y «Abrir carpeta en ventana nueva» ya cubre ese caso.

### Contrato de mensajes

| Front-end → host | Notas |
|---|---|
| `wispkit.subtree.read` | lee un nivel de directorio (carga diferida) |
| `wispkit.subtree.sort` | ordena por columna |
| `wispkit.subtree.command` | ejecuta un comando de extensión o incorporado |
| `wispkit.subtree.fileAction` | operación de archivo, ramas `cut` / `copy` / `paste` / `rename` / `delete` / `newFile` / `newFolder` / `compare` |
| `wispkit.subtree.systemTerminal` | inicia un terminal del sistema: `kind` nombra el terminal de la plataforma (p. ej. `windows-powershell-admin`), `paths` lleva la selección |
| `wispkit.subtree.tool` | ejecuta una herramienta propia |
| `wispkit.subtree.open` | abre o revela una entrada |
| `wispkit.subtree.drop` | recursos soltados en bruto (`targetDir` + bytes de archivo + cadenas); el host pregunta y escribe. `internalDrag` + `moveRequested` significan «arrastrado dentro del subárbol con Ctrl/Cmd pulsado», así que el host omite la pregunta copiar/mover y mueve directamente |

### Arrastrar y soltar

- **Soltar dentro**: arrastra archivos/carpetas del Explorador, texto, HTML, imágenes o enlaces sobre el árbol o una fila de carpeta.
  - Cuando se puede resolver una ruta de origen (`text/uri-list` o una ruta absoluta en `text/plain`) se pregunta **copiar / mover**; si hay un nombre en conflicto se pregunta **sobrescribir / renombrar automáticamente / cancelar**. Mover intenta primero `workspace.fs.rename` y, entre volúmenes, recurre a copiar + borrar a la papelera.
  - Un `File` soltado directamente desde el sistema trae contenido pero no ruta de origen, así que solo se puede completar la copia; la opción «mover» explica esa limitación.
  - Texto / HTML / imágenes en data URL / enlaces se tratan como **otros recursos**: elige un **tipo de almacenamiento** (se listan todos los tipos admitidos, p. ej. `.txt` / `.md` / `.url`) y escribe un **nombre de archivo**. El nombre por defecto es el primer texto significativo del contenido (`<title>` de HTML, último segmento de la URL o el host, primera línea del texto); si no se puede extraer nada, el campo queda vacío en lugar de inventar un nombre.
- **Ctrl al arrastrar dentro del árbol = mover**: mantén **Ctrl** (**Cmd** en macOS) mientras arrastras una fila — dentro de un panel o entre dos paneles de subárbol — para moverla sin la pregunta copiar / mover. Se miran las teclas tanto en dragstart como en drop: pulsar Ctrl antes de arrastrar y soltarlo antes de soltar también cuenta; el resaltado del destino pasa del azul de copia al verde de mover. Los conflictos de nombre siguen preguntando **sobrescribir / renombrar automáticamente / cancelar**. **Los arrastres del sistema quedan excluidos**: en el Explorador de Windows Ctrl significa copiar e interpretarlo como mover borraría el origen.
- **Arrastrar fuera**: el arrastre usa Pointer Events, nunca el arrastre nativo HTML5: en un webview de VS Code, `draggable=true` entra en el bucle de arrastre OLE nativo y bloquea el proceso principal (siempre al soltar en el Explorador del sistema). Soltar dentro del árbol copia / mueve con Ctrl; al soltar fuera del webview se resuelve la ventana del Explorador bajo el cursor y se copian / mueven los elementos a su carpeta actual (Ctrl = mover, incluida la selección múltiple). Si el cursor no está sobre una ventana del Explorador, los archivos se colocan en el portapapeles de Windows para `Ctrl+V`.
- **No hace falta Shift al arrastrar archivos desde el sistema**: el webview de VS Code entrega normalmente los arrastres «solo de archivos» al editor y pone el iframe en `pointer-events: none`, así que antes solo un arrastre con Shift llegaba a la página. Ahora el front-end intercepta los arrastres de archivos puros en la **fase de captura** de `document`: `dragenter` llama a `preventDefault()` (el pre script se detiene si ve `defaultPrevented` y ya no pide al host que desactive el iframe) y `stopPropagation()` impide que dragover / drop lleguen a la lógica de reenvío de `window`. Los archivos se pueden soltar directamente en el árbol; los arrastres del sistema siguen sin ruta de origen, así que solo se puede completar la copia.

## Navegación 3D de gráficos (`wispkit.graph3d`)

### Cómo se abre

| Entrada | Comportamiento |
|---|---|
| Clic derecho en `.md` / `.markdown` / `.mmd` / `.mermaid` del Explorador → **Navegación 3D de gráficos** | el elemento solo aparece para esas extensiones; abre el archivo actual (un `.mmd` / `.mermaid` se analiza como un solo gráfico) |
| Paleta de comandos → `Wispkit: Navegación 3D de gráficos` | prioriza el editor / pestaña Markdown activa; si el archivo activo no es Markdown / Mermaid avisa de que solo se admiten esas extensiones; sin archivo activo pide hacer clic derecho o abrir un Markdown / Mermaid primero |

**El mismo archivo reutiliza el mismo panel**: volver a ejecutar el comando solo revela el panel existente en lugar de apilar pestañas. Este panel es un `webviewPanel` (no un editor personalizado), así que no compite por el manejador de apertura.

### Composición

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Gráfico izq. [selector]  Gráfico der. [selector] │ Fusionar  Restablecer  Actualizar │ Distribución [selector]  Intervalo [control] 1,00× [x] Mostrar nombres de flujo  Estado │
├───────────────────────────────────┬──────────────────────────────────────────┤
│ Izquierda: nombre + N nodos · M aristas │ Derecha: nombre + N nodos · M aristas │
│        escena 3D                   │        escena 3D                         │
│  arrastrar izq. rotar · arrastrar der. desplazar · rueda zoom · pasar el ratón por un nodo para ver comentarios │
└───────────────────────────────────┴──────────────────────────────────────────┘
```

- **Selectores izquierdo / derecho**: cada opción muestra `índice. nombre · N nodos / M aristas`, más «(ninguno)». Al inicio el lado izquierdo selecciona el primer elemento y el derecho queda vacío; con un solo lado seleccionado ese lado ocupa todo el panel.
- **Fusionar izquierda/derecha**: solo se habilita cuando ambos lados tienen selección. Tras fusionar, los dos paneles y el divisor se ocultan y solo queda la «vista fusionada»; el botón pasa a «Cancelar fusión».
- **Restablecer vista**: devuelve la cámara a una dirección y distancia que muestran todo el gráfico.
- **Actualizar**: relee y reanaliza el archivo actual. Las selecciones izquierda/derecha existentes se restauran por id y luego por nombre; un «(ninguno)» elegido por el usuario se mantiene; si el documento pasa de no tener elementos a tenerlos, se selecciona el primero automáticamente. El botón de actualizar se reactiva a los 8 segundos para que una petición perdida no lo deje deshabilitado.
- **Distribución**: el desplegable ofrece Automático (por topología), Capas compactas, Mutex · Capas compactas, FR-3D en cáscara Louvain, Árbol radial, Anillos por capas, Fuerza dirigida 3D y Mutex · Fuerza dirigida 3D; al cambiar se redistribuye de inmediato. En la vista fusionada, los dos algoritmos mutex llevan el nodo central de cada gráfico a extremos opuestos de la distribución y dejan los nodos de fusión (mismo nombre) entre ellos (si un gráfico es un subconjunto del otro, los nodos de fusión se quedan y los exclusivos del otro lado se empujan hacia fuera); la barra de estado indica ambos núcleos. Sin fusión (un solo gráfico) se vuelve al algoritmo base correspondiente.
- **Intervalo**: 0,25×–3×; el gráfico se vuelve a distribuir unos 90 ms después de soltar el control. La distancia de la cámara se escala con el nuevo radio envolvente, así que el gráfico no se sale del viewport.
- **Mostrar nombres de flujo**: marcada por defecto. Al marcarla, cada arista muestra su etiqueta por encima del punto medio (el mismo texto Sprite que las burbujas de nodo); en una arista colgante la etiqueta se desplaza hacia el extremo colgante para que un nombre largo no tape el texto de la burbuja del nodo real. Al desmarcarla se ocultan al instante sin redistribuir. Las vistas izquierda, derecha y fusionada se mantienen sincronizadas.
- **Marcadores colgantes `void`**: cuando la etiqueta de un nodo Mermaid es exactamente `void` (se ignoran espacios y mayúsculas; por ejemplo, la exportación de interconexión de módulos de Drawcode lo usa para «el otro lado no se creó»), no se dibuja burbuja; cada flujo conectado se convierte en una **arista colgante** que va del nodo real hacia el espacio vacío. Las direcciones evitan las aristas existentes y las burbujas cercanas, varias aristas colgantes de un mismo nodo se reparten por ángulo y la longitud se mantiene cerca del intervalo normal entre aristas; las flechas conservan la dirección original source → target (`void → nodo` apunta al nodo real, `nodo → void` apunta al vacío). Los recuentos de nodos del desplegable y del estado excluyen `void`; las aristas colgantes siguen contando y el estado añade «N colgantes». Los nodos `void` aislados o conectados solo con otros `void` se mantienen visibles; el `void` de los árboles ASCII no se modifica.
- **Tooltip de comentarios al pasar el ratón**: cuando el puntero está sobre el área de la burbuja de un nodo con comentario, aparece un tooltip junto al cursor con el nombre del nodo y el comentario; se oculta al salir de la burbuja, al empezar a arrastrar o al hacer zoom. Los nodos sin comentario no muestran tooltip.
- **Nombres largos completos**: cuando el nombre es largo y no tiene saltos de línea manuales, primero se convierten espacios, barras, barras invertidas y guiones en saltos de línea; después se ajusta el texto al ancho disponible de la burbuja según su relación de aspecto. **No se recorta ningún carácter** del texto principal: si la textura supera 2048 px solo se reduce el tamaño de fuente. El bloque de texto se escala al rectángulo inscrito en la esfera, de modo que sus cuatro esquinas quedan dentro del contorno de la burbuja.
- **Burbujas con imagen**: cuando el nombre de un nodo es un enlace Markdown `[texto](ruta de imagen)` (también se acepta la sintaxis de imagen `![texto](ruta)`), la ruta existe y la imagen se puede analizar (png / jpg / jpeg / jpe / gif / webp / bmp / ico / avif, hasta 16 MB), la burbuja muestra la **imagen en lugar del texto**. La imagen conserva su relación de aspecto y se escala para que sus cuatro esquinas queden exactamente sobre la esfera de la burbuja; siempre mira hacia la cámara. Si el archivo no existe, la extensión no es de imagen, la cabecera no se reconoce o el frontend no puede decodificarla, el nodo vuelve al texto automáticamente. Las rutas relativas se resuelven respecto al archivo Markdown / Mermaid actual; se admiten rutas absolutas de Windows (letra de unidad / UNC) y URI `file:`.
- **Divisor**: aparece cuando ambos lados están seleccionados; arrastrar ajusta la proporción y la limita a **15%–85%**; **doble clic restablece 50% / 50%**.
- **Barra de estado**: resultados del análisis, cuántos nodos con el mismo nombre se fusionaron, mensajes de actualización y errores; los errores usan el color de error.
- Cada escena 3D muestra una pista en la parte inferior; sin WebGL la escena muestra una capa de error en lugar de quedarse en blanco.

### Gestos

| Gesto | Comportamiento |
|---|---|
| Arrastrar con el botón izquierdo | Rota la vista (con amortiguación) |
| Arrastrar con el botón derecho | Desplaza la vista; el menú contextual del navegador sobre el lienzo se suprime |
| Rueda | Zoom (acercar / alejar) |
| Pasar el ratón por la burbuja de un nodo | Si el nodo tiene comentario, muestra un tooltip junto al cursor; oculto al arrastrar / hacer zoom |
| Táctil: un dedo / dos dedos | un dedo rota; dos dedos hacen zoom + desplazamiento |
| `Esc` | En estado fusionado, cancela la fusión y vuelve a los dos paneles |
| Arrastrar / doble clic en el divisor | Ajusta / restablece la proporción izquierda-derecha (véase arriba) |

### Reglas de nombres de los elementos

- Solo se recogen dos tipos: **Mermaid** en bloques de código cercados (```` ```mermaid ````) y **árboles ASCII / dibujados con tabulaciones** en cercas o en el cuerpo del texto. Un archivo Mermaid independiente (`.mmd` / `.mermaid`) se analiza como un solo elemento, con nombre tomado de su `title` o, en su defecto, del nombre de archivo.
- Prioridad del nombre: `title` de Mermaid (frontmatter o directiva `title`) > **el encabezado Markdown más cercano** (`#`..`######`; los encabezados dentro de cercas no cuentan) > la primera etiqueta de nodo no vacía del gráfico > el nombre del archivo como respaldo.
- Al nombre se le añade el tipo, por ejemplo `Flujo de compilación · Diagrama de flujo`, `src · Árbol ASCII`, `Secuencia de inicio · Secuencia`; un tipo Mermaid desconocido muestra `Diagrama Mermaid`.
- **Los nombres duplicados reciben `(2)`, `(3)` automáticamente**, así el selector siempre puede distinguirlos.
- El título del panel muestra `3D: nombre del archivo (N)`, donde N es el número de elementos; cada opción del selector incluye además sus recuentos de nodos / aristas.

### Comentarios de las entradas

Los comentarios se asocian a los nodos y se muestran en un tooltip al pasar el ratón por la burbuja; nunca se mezclan con la etiqueta ni participan en la comparación de nombres.

- **Árboles ASCII / con tabulaciones**:
  - Comentarios al final de línea: `├── src   # directorio fuente`, `└── main.ts   // entrada`. El marcador debe ir precedido de espacio en blanco, así que `#` en etiquetas como `C#` o `F#` no se separa.
  - Comentarios de línea completa: `│   # una nota` (con prefijo de árbol opcional), asociados al nodo más reciente.
  - Comentarios partidos: si la línea de continuación no repite `#`, solo se une al comentario cuando su columna de sangría es **≥ la columna inicial del comentario**; en caso contrario sigue tratándose como etiqueta partida.
  - Las líneas de comentario consecutivas se unen con `\n`; cada nodo conserva como máximo 12 líneas / 1200 caracteres.
- **Mermaid**: un `%% comentario` de línea completa se asocia a los nodos **creados en la línea siguiente**; un `%% comentario` al final de una instrucción pertenece a los nodos creados en esa misma línea; los comentarios de línea completa consecutivos se unen. Las directivas como `%%{init: …}%%` no son comentarios. Si una línea crea varios nodos (por ejemplo `A --> B`), todos reciben el comentario.
- **Vista fusionada**: al fusionar nodos con el mismo nombre, los comentarios se deduplican por línea y se combinan, así el tooltip muestra ambos lados.

### Reglas de fusión de nodos con el mismo nombre

- **Solo se fusionan nodos entre el elemento izquierdo y el derecho**; los nodos con el mismo nombre dentro de un mismo gráfico no se fusionan, para no confundir nodos repetidos normales con una misma entidad.
- Comparación de nombres: `trim`, colapsar espacios consecutivos a uno, quitar comillas / acentos graves iniciales y finales, sin distinguir mayúsculas; el chino no se ve afectado.
- Se conserva el nodo izquierdo (id y etiqueta); el `detail` de una coincidencia derecha se deduplica y se añade (máximo 24 entradas), y las líneas de `comment` se deduplican y combinan. Los nodos derechos sin coincidencia reciben un id nuevo con prefijo `r:`; los ids de grupo derechos se reasignan igual para evitar colisiones.
- Se conservan todas las aristas: las izquierdas tal cual, las derechas con extremos reasignados; las aristas con `source + target + label + dashed` idénticos se deduplican, así los dos gráficos quedan conectados como un todo a través de los nodos compartidos.
- Si no hay nodos con el mismo nombre, ambos gráficos siguen en la misma escena 3D pero permanecen independientes; la barra de estado y las estadísticas indican el número real fusionado (incluido 0).
- La línea de estadísticas de la vista fusionada lleva `se fusionaron N nodos con el mismo nombre…` o `no hay nodos con el mismo nombre en ninguno de los dos lados…`.

### Contrato de mensajes

| Front-end → host | Carga útil | Respuesta del host |
|---|---|---|
| `wispkit.graph3d.refresh` | ninguna | `wispkit.graph3d.elements { elements, message }`; en caso de fallo `wispkit.graph3d.error { message }` |

## Componentes de interacción compartidos

| Archivo | Lo usan | Responsabilidad |
|---|---|---|
| `media/shared/panzoom.js` | vista de imagen, modal de Markdown, render XAML | zoom de rueda (anclado al cursor) + desplazamiento arrastrando + doble clic para ajustar |
| `media/shared/lightbox.js` | modal de Markdown | fondo a pantalla completa, `Esc` para cerrar |
| `media/shared/toc.js` | vista Markdown | construir el árbol, resaltar la sección actual, plegar |
| `media/shared/contextmenu.js` | Markdown / subárbol | posicionamiento del menú, detección de impacto, cierre |
| `media/shared/paragraph.js` | modo edición de Markdown | mapeo y extracción párrafo ↔ línea de origen |
