---
type: Guide
title: Limitaciones conocidas y elementos no verificados
description: Lo que Wispkit no puede hacer, por qué existe cada límite y lo que nunca se verificó en una máquina real
tags: [limitations, unverified, honesty]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Limitaciones conocidas y elementos no verificados

[English](limitations.md) | [中文](limitations.zh-CN.md) | **Español**

Esta página solo describe «lo que no se puede» y «lo que no se ha verificado». **No verificado no significa que se sepa que no funciona** — son dos listas separadas.

## 1. Límites de capacidad

### 1. No hay sincronización de desplazamiento editor↔vista previa

- **Síntoma**: al desplazarse por el código Markdown, la vista previa no se mueve; y al revés.
- **Causa**: la navegación por el índice se implementa construyendo un árbol con `h1..h6` dentro del webview, **sin depender del mapeo de origen `data-line`**. La sincronización de desplazamiento requiere todo el protocolo `data-line`/`code-line`, es decir, replicar el mecanismo de sincronización de la vista previa incorporada.
- **Alternativa**: el resaltado y la localización del índice no dependen de ello; al pulsar una entrada del índice se salta con precisión.
- **Verificación**: en `src/markdown/` no existe ningún módulo relacionado con scroll-sync.

### 2. Simple Browser no puede ser tomado

- **Síntoma**: cuando un archivo HTML se abre en Simple Browser, la capacidad de salto `vscode://file/` de Wispkit no funciona.
- **Causa**: Simple Browser es un `webviewPanel` creado por un comando (`onWebviewPanel:simpleBrowser.view`), **no pasa por la competición de customEditors** y la extensión no tiene punto de entrada para tomarlo.
- **Alternativa**: abrir el mismo archivo con la propia vista HTML de Wispkit.

### 3. La vista HTML usa una CSP relajada

- **Síntoma**: la vista HTML permite scripts en línea y recursos http(s); su nivel de seguridad es inferior a la política Strict de las vistas Markdown/XAML.
- **Causa**: navegar HTML requiere por definición que los scripts propios de la página se ejecuten; endurecer la CSP rompería la mayoría de las páginas reales. El nivel de riesgo es comparable al de Simple Browser incorporado.
- **Alternativa**: **no abrir con la vista HTML archivos HTML de origen no confiable.**

### 4. Markdown / imágenes / XAML se hacen cargo del manejador de apertura predeterminado

- **Síntoma**: tras instalar la extensión, al hacer doble clic en `.md`, en imágenes y en `.xaml` se abre la vista de Wispkit en lugar del editor incorporado.
- **Causa**: estas tres vistas son `priority: default` en `package.json` (para «doble clic y entrar» es obligatorio así).
- **Alternativa**: clic derecho en el archivo → *Reopen Editor With…* y elegir el editor incorporado; o fijarlo con `workbench.editorAssociations`.
- **Atención**: **HTML y el texto de solo lectura son `option`**, no toman el manejador de apertura por defecto y hay que cambiar explícitamente.

### 5. El zoom predeterminado de mermaid depende de la extensión incorporada

- **Síntoma**: `contributes.configurationDefaults` eleva `markdown-mermaid.mouseNavigation.enabled` a `always` para que los diagramas mermaid se puedan ampliar por defecto.
- **Causa**: ese valor por defecto solo tiene sentido si está instalada `mermaid-markdown-features` (incluida en VS Code); si no lo está, es una clave no registrada e inocua. Si el usuario ha cambiado ese ajuste explícitamente, prevalece su valor.

### 6. El render de XAML es una instantánea estática

- **Síntoma**: la imagen renderizada solo muestra la maquetación; no hay datos ni interacción.
- **Causa**: el renderizador construye el árbol de controles con el analizador XAML en un proceso separado y lo renderiza fuera de pantalla a PNG — **sin DataContext, sin ejecutar manejadores de eventos, sin bucle de mensajes**.
- **Consecuencia**: los `{Binding}` se renderizan vacíos, `BlazorWebView` se renderiza en blanco (lo cual es **correcto**: la interfaz está en Razor y en XAML solo queda el control anfitrión), y `App.xaml` no se puede renderizar (solo puede existir una instancia de `Application` por proceso y, además, no es una vista visual).
- **Uso adecuado**: ver la maquetación, no el comportamiento en ejecución.

### 7. Los tipos referenciados por `x:Class` deben estar ya compilados

- **Síntoma**: si el proyecto no se ha compilado (no se encuentra `bin/(Release|Debug)/<tfm>/*.dll`), el XAML con `x:Class` falla al renderizar.
- **Causa**: el renderizador prefiere la ruta «cargar el ensamblado compilado + `RootObjectInstance`», que exige que exista el tipo raíz; solo sin `x:Class` recurre a `XamlReader.Parse`.
- **Alternativa**: ejecutar antes `dotnet build` en el proyecto de destino.

### 8. El modo edición no tiene resaltado de sintaxis

- **Síntoma**: el cuadro de edición de párrafos Markdown es un `<textarea>` puro, y el panel de código XAML solo tiene el resaltado ligero propio.
- **Causa**: lo que se gana es **alineación al píxel** con la barra de números de línea y cero dependencias de terceros (el resaltador propio debe garantizar que la salida sea idéntica carácter a carácter a la entrada, o el cursor se desplazaría).
- **Alternativa**: cuando se necesite resaltado, usar *Reopen Editor With…* para cambiar al editor nativo de VS Code.

### 9. El modo de solo lectura no se aplica a las propias vistas de navegación de Wispkit

- **Síntoma**: Markdown / HTML / XAML / imágenes se siguen abriendo igual en modo de solo lectura.
- **Causa**: ya son vistas de navegación (no escriben archivos) y **truncar Markdown produciría un render incompleto**.
- **Excepción**: el panel de código de la vista XAML sigue siendo editable — esto se ajustará más adelante junto con el modo de solo lectura.

### 10. El modo de solo lectura reemplaza la pestaña una vez al cambiar de editor

- **Síntoma**: al activar el modo de solo lectura y abrir un archivo de texto se ve «se cierra la pestaña del editor nativo y aparece la vista previa de solo lectura».
- **Causa**: la interceptación ocurre después de que el archivo ya lo haya abierto el editor nativo (momento `onDidOpenTextDocument`); no es posible sustituirlo antes de abrir.
- **Excepción**: los archivos abiertos por peek / diff / en segundo plano no se interceptan.

### 11. `atime` y los bits de permiso POSIX en la vista de subárbol siempre son `-`

- **Causa**: el `FileStat` de VS Code no expone ninguno de los dos; la extensión no puede obtenerlos.
- **Alternativa**: ninguna (salvo usar `fs.stat` directamente, pero eso abandonaría el soporte remoto de `workspace.fs`).

### 12. Los temas de iconos basados en fuentes no tienen respaldo

- **Síntoma**: con un tema de iconos de **forma de fuente** (con definiciones `fonts` propias) como Seti, los iconos del subárbol no coinciden con los del Explorador.
- **Causa**: `parseIconTheme` solo analiza temas en forma de SVG (con rutas svg en `iconDefinitions`); los temas de fuente fallan al analizarse por completo y se recurre al sprite dibujado por nosotros.
- **Alternativa**: usar un tema en forma de SVG (como los modern icons empleados en la verificación en máquina real).

### 13. La lista de permitidos de comandos incorporados del Explorador no se verificó uno por uno

- **Síntoma**: los comandos incorporados del área de acciones (`revealInExplorer`, `copyFilePath`, etc.) no se han pulsado uno a uno en una máquina real.
- **Causa**: los comandos incorporados del Explorador de VS Code **no tienen una lista enumerable** (no están en el `contributes` de ninguna extensión); solo se pueden enumerar a mano.
- **Protección**: antes de ejecutar, siempre se validan con `commands.getCommands(true)`; si no existe, se muestra una explicación, **nunca en silencio**; si el tipo de argumento no coincide, se lanza el error en el acto y se muestra la causa.

### 14. Las operaciones de archivo del subárbol son propias, no comandos incorporados

- **Causa**: los comandos incorporados `filesExplorer.rename` / `explorer.newFile` / `filesExplorer.paste` no aceptan URI externos y no pueden actuar sobre la entrada seleccionada en el panel, así que cortar/copiar/pegar/renombrar/eliminar/crear/comparar se implementan todos por nuestra cuenta (`src/subtree/fileActions.ts`).
- **Implicación**: los detalles de comportamiento de estas operaciones (aviso de conflicto, papelera de reciclaje, copia recursiva) los decide Wispkit y no se garantiza que coincidan literalmente con el Explorador.

## 2. Elementos no verificados

Lo siguiente **no se ha verificado en un VS Code real**. No significa que no funcione, solo que no hay evidencia.

| # | Elemento no verificado | Por qué es sospechoso | Cómo verificarlo |
|---|---|---|---|
| 1 | **Aspecto a nivel de píxel** | Varios cambios solo verificaron «el SVG/valor de regla analizado es correcto», sin comparación de capturas renderizadas | Abrir los archivos reales y comparar a ojo |
| 2 | **Límites de párrafo en el motor real** | La edición de párrafos infiere la línea final (línea inicial del siguiente bloque menos uno) a partir de `data-line` (primera línea del párrafo); en estructuras anidadas (elementos de lista, citas, interior de bloques de código) el límite puede ser impreciso | En un documento con listas/citas/bloques anidados, abrir la edición párrafo a párrafo y comprobar que el código extraído está completo |
| 3 | **Cadena completa de escritura de `workspace.fs`** | Aviso de conflicto al renombrar, retroceso cuando `useTrash` no está disponible, copia recursiva de directorios, ruta de error en sistemas de solo lectura — todo tiene solo pruebas unitarias, sin pulsaciones en máquina real | Operar uno por uno en un espacio de trabajo real y observar los avisos |
| 4 | **Ejecución real de comandos `explorer/context` aportados por extensiones** | La recopilación automática de ids de comando es fiable, pero «si el tipo de argumento coincide al ejecutar» no se ha probado uno por uno | Seleccionar un archivo y pulsar uno por uno los comandos de las extensiones |
| 5 | **Lectura real de `package.nls.json`** | Si VS Code lee correctamente la localización de los títulos de comando y las descripciones de configuración | Mirar la paleta de comandos y la página de ajustes con una interfaz no inglesa |
| 6 | **Sincronización del reemplazo de pestaña en solo lectura** | El comportamiento de «abrir primero en nativo y luego sustituir» en discos lentos, archivos grandes y pestañas `preview` | Probar una vez con `workbench.editor.enablePreview` activado y otra desactivado |
| 7 | **Comportamiento de carga diferida en directorios enormes** | Lectura y render con decenas de miles de entradas en un nivel, anidamiento profundo y rutas de red | Abrir el panel de subárbol sobre `node_modules` o un directorio grande |
| 8 | **Cobertura del puente de idioma de los temas de iconos** | Los 349 mapeos «extensión → id de lenguaje» provienen de los `contributes.languages` de cada extensión y no se han comparado uno a uno con la tabla completa de lenguajes de VS Code; las extensiones no cubiertas recurren al icono `file` | Cambiar varios temas y comprobar que los archivos con distintas extensiones muestran el icono correcto |

> El punto 9 queda cerrado en esta pasada de documentación: los enlaces relativos y las anclas de todo el conjunto documental los comprueba `node tools/docs-check.mjs`, que debe informar de **0 problemas**.

## 3. Cómo usar esta lista

- **Antes de depender de un comportamiento**, confirmar aquí que no está en «no verificado».
- **Al informar de un fallo**, si cae en cualquiera de los elementos de la tabla anterior, puede ser una zona ciega conocida y no un problema nuevo.
- Este documento solo enumera «lo que hoy no se puede / no se ha verificado», no «lo que se planea hacer» — los planes están en el tablero o en el historial de commits.
