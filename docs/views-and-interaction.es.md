---
type: Guide
title: Vistas e interacción
description: Composición de la interfaz, gestos, atajos y contratos de mensajes de los cinco editores personalizados y el panel de subárbol
tags: [views, interaction, webview, gestures]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Vistas e interacción

[English](views-and-interaction.md) | [中文](views-and-interaction.zh-CN.md) | **Español**

## Resumen

| Vista | viewType | Cómo se abre | Prioridad |
|---|---|---|---|
| Navegación Markdown | `wispkit.markdown` | doble clic en `.md` / `.markdown` | `default` (toma el control) |
| Navegación de imágenes | `wispkit.image` | doble clic en `.png` `.jpg` `.jpe` `.jpeg` `.bmp` `.gif` `.ico` `.webp` `.avif` | `default` (toma el control) |
| Navegación HTML | `wispkit.html` | *Reopen Editor With…* / `wispkit.openWith` | `option` (no compite) |
| Navegación XAML | `wispkit.xaml` | doble clic en `.xaml` | `default` (toma el control) |
| Texto de solo lectura | `wispkit.text` | automático al activar el modo de solo lectura global | `option` (gobernado por asociaciones) |
| Panel de subárbol | `wispkit.subtree` (webviewPanel) | icono a la derecha de una fila de carpeta del Explorador / comando | no es un editor |

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

### Índice de contenido

- El árbol se construye a partir de `h1..h6` **dentro del webview** y **no** depende del mapeo de origen `data-line` — por eso no se necesita ningún protocolo de sincronización de desplazamiento entre editor y vista previa.
- La sección actual se resalta al desplazarse; al pulsar una entrada se salta a ella y se le da el foco.
- El ancho del panel se puede arrastrar y **hacer doble clic en el divisor lo restablece**; se puede plegar con un clic (el cuerpo pasa entonces a ocupar todo el ancho).
- La profundidad listada está limitada por `wispkit.toc.depth` (por defecto 3) y todo el panel se puede desactivar con `wispkit.toc.enabled`.

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

## Vista HTML (`wispkit.html`)

- Usa una **CSP relajada**: se permiten scripts en línea y recursos http(s) — navegar HTML necesita por definición que los scripts propios de la página se ejecuten.
- Reescribe `href="vscode://file/<ruta>[:<línea>]"` como `command:vscode.open?<args>` y activa `enableCommandUris` en el webview. **0 líneas de script en el front-end**: el clic lo informa el shell del webview, y el enlace reescrito se abre en la ventana actual sin pasar por el manejador de protocolos del sistema.
- Los enlaces `vscode://` no reescritos también están en la lista blanca del host, así que ambas rutas funcionan.

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

## Vista de texto de solo lectura (`wispkit.text`)

- Una vez activado el modo de solo lectura global, `.ts` / `.json` / `.txt` / `.log` y otros (decididos por `wispkit.readonly.extensions`) se abren como vista previa de solo lectura.
- Solo se leen **los primeros N bytes del archivo** (`wispkit.readonly.previewBytes`, 64 KB por defecto), y luego se trunca por líneas (`wispkit.readonly.previewLines`, 800 por defecto).
- La página tiene números de línea y un **resaltador de sintaxis genérico propio** (nivel comentario / cadena / número / palabra clave, no coloreado con precisión de TextMate).
- Un botón flotante de «desbloquear edición» en la esquina inferior derecha abre el archivo en el editor nativo (editable) y deja pasar ese archivo durante el resto de la sesión.
- Las vistas de navegación que Wispkit ya posee (Markdown / HTML / XAML / imágenes) **no se ven afectadas por el modo de solo lectura** — ya son vistas de navegación, y truncar Markdown produciría un render roto.

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
- **Ordenación**: pulsa una cabecera para ordenar por esa columna; la lógica pura vive en `src/subtree/sort.ts`.

### Los tres tipos de acciones del área de acciones

| Tipo | Origen | Notas |
|---|---|---|
| Operaciones de archivo (nativas) | integradas en Wispkit | cortar / copiar / pegar / renombrar / eliminar / nuevo archivo / nueva carpeta / comparar. **Tienen que ser propias**: los comandos incorporados `filesExplorer.*` no aceptan URI externos |
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

### Contrato de mensajes

| Front-end → host | Notas |
|---|---|
| `wispkit.subtree.read` | lee un nivel de directorio (carga diferida) |
| `wispkit.subtree.sort` | ordena por columna |
| `wispkit.subtree.command` | ejecuta un comando de extensión o incorporado |
| `wispkit.subtree.fileAction` | operación de archivo, ramas `cut` / `copy` / `paste` / `rename` / `delete` / `newFile` / `newFolder` / `compare` |
| `wispkit.subtree.tool` | ejecuta una herramienta propia |
| `wispkit.subtree.open` | abre o revela una entrada |

## Componentes de interacción compartidos

| Archivo | Lo usan | Responsabilidad |
|---|---|---|
| `media/shared/panzoom.js` | vista de imagen, modal de Markdown, render XAML | zoom de rueda (anclado al cursor) + desplazamiento arrastrando + doble clic para ajustar |
| `media/shared/lightbox.js` | modal de Markdown | fondo a pantalla completa, `Esc` para cerrar |
| `media/shared/toc.js` | vista Markdown | construir el árbol, resaltar la sección actual, plegar |
| `media/shared/contextmenu.js` | Markdown / subárbol | posicionamiento del menú, detección de impacto, cierre |
| `media/shared/paragraph.js` | modo edición de Markdown | mapeo y extracción párrafo ↔ línea de origen |
