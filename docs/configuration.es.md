---
type: Guide
title: Configuración
description: Referencia a nivel de campo de todos los ajustes, además de Wispkit.json, las herramientas propias y los modos de ejecución
tags: [configuration, settings, reference]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Configuración

[English](configuration.md) | [中文](configuration.zh-CN.md) | **Español**

Todos los ajustes se definen en `contributes.configuration` dentro de `package.json`; hay **13**.

## Resumen

| Clave | Tipo | Valor por defecto | Se aplica a | Cuándo cambiarlo | Efecto secundario |
|---|---|---|---|---|---|
| `wispkit.toc.enabled` | boolean | `true` | vista Markdown | El cuerpo ya es lo bastante ancho y solo quieres leer el contenido | La barra lateral entera deja de renderizarse y los saltos del índice desaparecen con ella |
| `wispkit.toc.depth` | number (1–6) | `3` | vista Markdown | El documento es muy profundo y quieres localizar subsecciones rápido | Con 6 la barra lateral queda muy abarrotada |
| `wispkit.zoom.wheelStep` | number (1.01–3) | `1.1` | imagen / modal / render XAML | Cada muesca de rueda salta demasiado | Cambia en los tres sitios a la vez; con 1.01 el zoom es casi imperceptible |
| `wispkit.image.wheelZoom` | boolean | `true` | vista de imagen | Necesitas que la rueda desplace rápido para navegar | Al desactivarlo vuelve a «mantener Ctrl para ampliar» |
| `wispkit.image.dragButton` | `right` \| `middle` \| `left` | `right` | vista de imagen | Un gesto del sistema ocupa el botón derecho | Ponerlo en `left` choca con el arrastre y la selección del sistema; no se recomienda |
| `wispkit.xaml.codeVisible` | boolean | `true` | vista XAML | Solo quieres ver el render y no el código | El panel de código desaparece y queda solo la imagen renderizada, centrada |
| `wispkit.xaml.codeWidth` | number (≥160) | `460` | vista XAML | El árbol de controles es profundo y las líneas del código son largas | En ventanas estrechas comprime el área de render; prevalece el valor arrastrado |
| `wispkit.readonly.default` | boolean | `false` | modo de solo lectura global | Solo quieres navegar y no cambiar archivos por error | Reescribe `workbench.editorAssociations` y lo elimina al desactivarse |
| `wispkit.readonly.previewBytes` | number (≥1024) | `65536` | modo de solo lectura global | Los archivos son grandes y quieres abrirlos más rápido | Lo que excede **no se carga** (no se pliega) |
| `wispkit.readonly.previewLines` | number (≥50) | `800` | modo de solo lectura global | Solo quieres ver las primeras líneas | Lo que excede no se muestra y al final se avisa del truncado |
| `wispkit.readonly.extensions` | string[] | 61 patrones glob | modo de solo lectura global | Solo ciertos tipos deben ser de solo lectura | Cambiarlo reescribe las asociaciones de inmediato; **no** añadas `.md`/`.html`/`.xaml`/imágenes |
| `wispkit.subtree.columns` | string[] (9 valores de enum) | `name,size,type,mtime,ctime,owner` | panel de subárbol | Quieres examinar un directorio por fecha de modificación o tamaño | Los valores inválidos se filtran, los duplicados se eliminan y un array vacío vuelve a los valores por defecto |
| `wispkit.subtree.tools` | object[] | `[]` | panel de subárbol | Quieres colgar comandos externos habituales en el lado derecho del panel | Los argumentos no se escapan para el shell; `external` abre de verdad una ventana |

## Índice de contenido

### `wispkit.toc.enabled`

- Tipo `boolean`, por defecto `true`.
- Con `false` no se renderiza toda la barra lateral del índice y el cuerpo ocupa el ancho completo.
- Afecta solo a la vista Markdown; los cambios surten efecto de inmediato (reabrir la vista o recargar con un comando).

### `wispkit.toc.depth`

- Tipo `number`, por defecto `3`, rango 1–6.
- Determina la profundidad del árbol del índice. Con 6 entran todos los encabezados y los documentos largos se vuelven abarrotados.
- Independiente del cuerpo; afecta solo a la barra lateral.

## Zoom

### `wispkit.zoom.wheelStep`

- Tipo `number`, por defecto `1.1`, rango 1.01–3.
- El factor de zoom **por muesca de rueda**: `1.1` significa un 10 % más en cada muesca.
- El mismo panzoom lo comparten tres lugares: la vista de imagen, el modal a pantalla completa de Markdown y el render XAML — cambiarlo los cambia los tres.

## Vista de imagen

### `wispkit.image.wheelZoom`

- Tipo `boolean`, por defecto `true`.
- `true`: la rueda hace zoom directamente, sin Ctrl.
- `false`: vuelve a «mantener Ctrl para ampliar» y la rueda recupera el desplazamiento.

### `wispkit.image.dragButton`

- Tipo `string`, enum `right` / `middle` / `left`, por defecto `right`.
- Qué botón desplaza la imagen mientras se mantiene pulsado.
- Ponerlo en `left` entra en conflicto con el comportamiento de arrastre del sistema; no se recomienda.

## Vista XAML

### `wispkit.xaml.codeVisible`

- Tipo `boolean`, por defecto `true`.
- Si se muestra el panel de código de la izquierda; con `false` solo queda la imagen renderizada (centrada).

### `wispkit.xaml.codeWidth`

- Tipo `number`, por defecto `460`, mínimo `160` (píxeles).
- El ancho inicial del panel de código. Se puede cambiar temporalmente arrastrando el divisor en tiempo de ejecución; prevalece el valor arrastrado.

## Modo de solo lectura global

### `wispkit.readonly.default`

- Tipo `boolean`, por defecto `false`.
- Si la extensión arranca en modo de solo lectura. Se puede alternar en tiempo de ejecución desde el interruptor a la derecha de la barra de estado (`wispkit.toggleReadOnly`).

### `wispkit.readonly.previewBytes`

- Tipo `number`, por defecto `65536` (64 KB), mínimo `1024`.
- El **número máximo de bytes** que carga la vista previa de solo lectura; lo que exceda no se carga. Este es el mecanismo real detrás de «ahorrar el coste de renderizado».

### `wispkit.readonly.previewLines`

- Tipo `number`, por defecto `800`, mínimo `50`.
- El **número máximo de líneas** que muestra la vista previa de solo lectura (un truncado por líneas aplicado después del límite de bytes).

### `wispkit.readonly.extensions`

- Tipo `string[]`, por defecto 61 patrones glob (`.txt` `.log` `.json` `.ts` `.py` `.cs` …).
- Los tipos de archivo a los que se aplica el modo de solo lectura. Cuando está activo, estos tipos se escriben en `workbench.editorAssociations` para que su manejador de apertura nativo sea la vista de solo lectura.
- **Excluye deliberadamente** los tipos de navegación propios de Wispkit (`.md` / `.html` / `.xaml` / imágenes) — truncarlos produciría un render roto.
- Un array vacío significa que el modo de solo lectura no se aplica a ningún archivo.

## Panel de subárbol

### `wispkit.subtree.columns`

- Tipo `string[]`, por defecto `["name","size","type","mtime","ctime","owner"]`.
- Enum: `name` `ext` `size` `mtime` `ctime` `atime` `owner` `mode` `type`.
- **El orden del array es el orden de las columnas.** Los valores inválidos se filtran, los duplicados se eliminan y un resultado vacío vuelve a los valores por defecto (lógica pura en `src/subtree/columns.ts`, probada por unidad).
- Se sabe que dos columnas están siempre vacías: `atime` (hora de acceso) y `mode` (bits de permiso POSIX) — el `FileStat` de VS Code no las expone, así que muestran `-`.

### `wispkit.subtree.tools`

Un array de herramientas propias, vacío por defecto. Cada elemento tiene esta forma:

```jsonc
{
  "label": "Abrir en terminal",      // obligatorio, el texto del botón
  "command": "powershell",           // obligatorio, el ejecutable o comando
  "args": ["-NoExit", "-Command", "cd '${dir}'"],  // opcional
  "shell": "newTerminal"             // opcional, por defecto silent
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `label` | ✅ | el texto del botón |
| `command` | ✅ | el comando a ejecutar |
| `args` | — | array de argumentos |
| `shell` | — | `silent` / `currentTerminal` / `newTerminal` / `external` |

**Los cuatro modos de ejecución**:

| `shell` | Comportamiento | Uso típico |
|---|---|---|
| `silent` (por defecto) | se ejecuta en segundo plano, sin ventana ni terminal | formateo, estadísticas |
| `currentTerminal` | escribe en la terminal activa | `cd` o ejecutar un comando en una terminal existente |
| `newTerminal` | crea una terminal y escribe en ella | tareas que necesitan su propia terminal |
| `external` | inicia una ventana de terminal del sistema como proceso independiente | programas que necesitan una ventana interactiva |

**Marcadores** (se sustituyen en `command` y `args`):

| Marcador | Se reemplaza por |
|---|---|
| `${file}` | la ruta absoluta de la entrada seleccionada |
| `${dir}` | la ruta absoluta del directorio padre de la entrada seleccionada |
| `${name}` | el nombre de archivo de la entrada seleccionada (con extensión) |
| `${workspaceFolder}` | la ruta absoluta de la primera carpeta del espacio de trabajo |

La sustitución es un **reemplazo literal de cadenas** sin escapado de shell — cuando una ruta contiene espacios, añade las comillas tú mismo en la configuración (`"cd '${dir}'"`).

## `configurationDefaults`: mermaid se puede ampliar sin configurar nada

`package.json` contiene un bloque `contributes.configurationDefaults`:

```json
{ "markdown-mermaid.mouseNavigation.enabled": "always" }
```

El script de front-end de mermaid incorporado tiene pan/zoom, pero por defecto exige **mantener Alt** (ese ajuste vale `alt` por defecto). Esta extensión eleva el valor a `always`, de modo que los diagramas mermaid se amplían con la rueda y se desplazan arrastrando sin configurar nada.

Dos condiciones previas: ① debe estar instalada la extensión incorporada `mermaid-markdown-features` (VS Code la incluye); ② cuando el usuario ha cambiado ese ajuste explícitamente, prevalece su valor. Si la extensión no está instalada, es una clave no registrada e inocua.

## `.WispkitView/Wispkit.json`

El icono «Mostrar» a la izquierda de una fila de carpeta del Explorador lee este archivo.

**Orden de búsqueda**:

1. `<carpeta>/.WispkitView/Wispkit.json`
2. `<carpeta>/Wispkit.json`

**Esquema**:

```jsonc
{
  "title": "Proyecto de demostración",   // opcional: título del panel/pestaña
  "entry": ".WispkitView/index.html",    // obligatorio: archivo de entrada relativo a la carpeta
  "openWith": "wispkit.html"             // obligatorio: viewType
}
```

**Validación**: `entry` debe permanecer dentro de esa carpeta (se rechaza si se escapa) y `openWith` debe ser un viewType registrado. Una configuración ausente o una comprobación fallida produce un mensaje visible, nunca un fallo silencioso.

## Un ejemplo completo de settings.json

```jsonc
{
  // Markdown
  "wispkit.toc.enabled": true,
  "wispkit.toc.depth": 4,

  // Imágenes y zoom
  "wispkit.zoom.wheelStep": 1.15,
  "wispkit.image.wheelZoom": true,
  "wispkit.image.dragButton": "middle",

  // XAML
  "wispkit.xaml.codeVisible": true,
  "wispkit.xaml.codeWidth": 520,

  // Modo de solo lectura
  "wispkit.readonly.default": false,
  "wispkit.readonly.previewBytes": 32768,
  "wispkit.readonly.previewLines": 500,

  // Panel de subárbol
  "wispkit.subtree.columns": ["name", "size", "mtime", "owner"],
  "wispkit.subtree.tools": [
    {
      "label": "Mostrar en el Explorador",
      "command": "explorer",
      "args": ["${dir}"],
      "shell": "external"
    }
  ]
}
```
