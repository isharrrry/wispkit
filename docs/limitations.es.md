---
type: Guide
title: Limitaciones conocidas y elementos no verificados
description: Lo que Wispkit no puede hacer, por qué existe cada límite (incluida la cobertura de diagramas 3D, los límites de los árboles ASCII, los topes de grafos grandes y los límites de disco / concurrencia / multitráiz del árbol de recursos) y lo que nunca se verificó en una máquina real
tags: [limitations, unverified, honesty]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T15:50:00+08:00 }
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

### 4. Markdown / Mermaid / imágenes / vídeos / HTML / XAML se hacen cargo del manejador de apertura predeterminado

- **Síntoma**: tras instalar la extensión, al hacer doble clic en `.md`, en `.mmd` / `.mermaid`, en imágenes, en vídeos, en `.html` y en `.xaml` se abre la vista de Wispkit en lugar del editor incorporado / navegador.
- **Causa**: estas seis vistas son `priority: default` en `package.json` (para «doble clic y entrar» es obligatorio así; HTML también debe tomar el control por defecto, porque en el editor de texto incorporado los enlaces no hacen nada).
- **Alternativa**: clic derecho en el archivo → *Reopen Editor With…* y elegir el editor incorporado; o fijarlo con `workbench.editorAssociations`.
- **Atención**: **solo el texto de solo lectura es `option`**; no compite por defecto y se gobierna con `workbench.editorAssociations`.
- **Tras actualizar**: la versión recién instalada solo surte efecto tras **Reload Window** — el host de extensiones arranca al cargar la ventana, así que sin recargar sigue ejecutándose la versión anterior. Incluso después de recargar, **las pestañas ya abiertas conservan su tipo de editor original**: un SVG abierto con la vista previa incorporada antes de la actualización hay que cerrarlo y volver a abrirlo (o usar clic derecho → *Reopen Editor With…* → **Wispkit Image**) para entrar en la vista nueva.

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

- **Síntoma**: Markdown / HTML / XAML / imágenes / vídeos se siguen abriendo igual en modo de solo lectura.
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

### 15. La visualización 3D analiza la topología, no reproduce el render de Mermaid

- **Síntoma**: los nodos, aristas y grupos del panel 3D provienen del analizador ligero propio de Wispkit, no del SVG que renderiza Mermaid; los temas, colores, estilos de línea precisos, `classDef`, `style`, `click`, `accTitle` / `accDescr` no se reflejan en 3D. Los comentarios de las entradas se reconocen y se asocian a los nodos (comentarios al final de línea / de línea completa en árboles ASCII, `%%` en Mermaid), pero solo se muestran como texto plano en un tooltip al pasar el ratón, no en la posición ni con la maquetación originales.
- **Tipos admitidos**: `flowchart` / `graph` (incluido `-elk`), `sequenceDiagram`, `classDiagram`, `stateDiagram` / `stateDiagram-v2`, `erDiagram`, `mindmap`, `gitGraph`, `journey`, `gantt`, `timeline`, `pie`, `quadrantChart`. Estos tipos se normalizan a nodos / aristas / grupos según su semántica antes del diseño.
- **Tipos no admitidos**: `requirementDiagram`, `C4Context`, `sankey-beta`, `block-beta`, `architecture-beta`, `packet-beta`, `xychart-beta` y el contenido Mermaid no reconocido usan un **respaldo genérico**: las líneas de contenido se encadenan en orden de lectura y la línea de estadísticas indica «análisis de respaldo genérico (encadenado por líneas)»; la semántica (jerarquía, flujo, coordenadas) se pierde.
- **Errores de sintaxis**: el analizador conserva todos los nodos / aristas reconocidos que puede y lo explica en `note`; el panel nunca se cae.
- **Alternativa**: cuando se necesita el aspecto exacto de Mermaid, usar la propia vista Markdown; el 3D sirve para ver la estructura.

### 16. El reconocimiento de árboles ASCII desnudos es conservador

- **Admitido**: árboles dentro de cercas cuyo lenguaje sea `""` / `text` / `txt` / `plain` / `plaintext` / `ascii` / `tree` / `log` / `none`; y árboles en el cuerpo del texto con al menos dos **líneas de conexión con etiqueta**.
- **Conectores**: Unicode `├──` / `└──` / `│` y similares (1–8 guiones), o ASCII `|--` / `+--` / `` `-- `` / `\--` (2–8 guiones). Una sola línea de conexión no es un árbol; los marcos / bordes de tabla puros (`+---+`, `┌── x ──┐`) se excluyen.
- **Límites de los árboles desnudos en el cuerpo**: las líneas del cuerpo no pueden ser estructuras Markdown (encabezados ATX, citas, listas, tablas, HTML, separadores, definiciones de referencia de enlaces); una línea en blanco termina el bloque; las líneas con sangría y sin conector se fusionan con la etiqueta del nodo anterior (texto partido); una segunda raíz a columna 0 solo se absorbe si la línea siguiente es otro conector; la profundidad de sangría se limita a 30.
- **No se reconoce**: jerarquía expresada solo con espacios y sin conectores; fragmentos con un único conector; árboles dentro de cercas no ASCII como ` ```js `; Mermaid escrito dentro de una cerca que no es `mermaid`.
- **Truncado**: un árbol ASCII se detiene a los 600 nodos (no se añade aviso adicional; véase el punto siguiente).

### 17. Topes de elementos y nodos 3D, y rendimiento con grafos grandes

| Tope | Valor | Comportamiento |
|---|---:|---|
| Elementos por archivo Markdown | **200** | los elementos sobrantes simplemente no se recogen (truncado silencioso) |
| Nodos por diagrama Mermaid | **600** | se trunca a los primeros 600, con una nota «el número de nodos supera 600…» junto a las estadísticas |
| Nodos por árbol ASCII | **600** | deja de añadir nodos al llegar al tope (el analizador ASCII no añade nota de truncado) |

- **Coste del diseño**: los diseños de árbol / capas son casi lineales, pero los grafos cíclicos de clase / ER usan el diseño **de fuerza dirigida determinista**, cuya distancia es O(n²) (hasta 170 iteraciones + 36 pasadas de eliminación de solapamientos). Cada nodo crea un sprite con textura Canvas y cada arista un TubeGeometry más un cono de flecha. Con cientos de nodos, el tiempo de diseño y la memoria de GPU crecen de forma notable.
- **Límite medido**: las pruebas unitarias cubren el truncado a 600 nodos y el determinismo del diseño; las muestras 3D en máquina real solo tenían 3–8 nodos (véase [compilación y verificación](build-and-verify.es.md#3d-bundle-y-sondas-de-extremo-a-extremo)), y **no se ha hecho ninguna prueba de estrés con un documento real de 200 elementos / 600 nodos**.
- **Alternativa**: dividir los documentos muy grandes en varios gráficos pequeños y verlos por separado; aumentar el intervalo reduce el solapamiento de texto pero no el número de nodos.

### 18. La escena 3D necesita WebGL

- **Síntoma**: cuando el host / el controlador de GPU desactiva WebGL, la escena 3D no se puede crear y el panel muestra una capa de error «no se pudo crear un contexto WebGL: …».
- **Causa**: el `WebGLRenderer` de three.js requiere un contexto WebGL real; no hay ruta de respaldo 2D ni SVG.
- **Alternativa**: activar la aceleración por hardware o usar una máquina con soporte WebGL; si solo se necesita la estructura, leer el Mermaid / árbol ASCII en la vista Markdown.

### 19. Los grupos virtuales no corresponden a ninguna carpeta del disco

- **Síntoma**: un grupo virtual (`group`) parece una carpeta en el árbol, pero al pulsarlo avisa «un grupo virtual no corresponde a una carpeta real y no se puede navegar»; aun así puede contener carpetas o subgrupos.
- **Causa**: un nodo `group` solo tiene `id` / `name` / `children` y no tiene `path` (`src/resourceTree/model.ts`). Es un contenedor puramente de nombres y agrupación dentro del árbol.
- **Implicación**: renombrar, mover o eliminar un grupo virtual solo cambia el JSON; el diálogo de borrado indica explícitamente que no se eliminará ningún archivo del disco. Cuando se necesite un directorio real, usar «Añadir carpeta».

### 20. Las rutas absolutas fuera del espacio de trabajo dejan de funcionar en otra máquina / espacio

- **Síntoma**: las carpetas fuera del espacio de trabajo se guardan como rutas absolutas de estilo POSIX (por ejemplo `D:/shared/docs`). Al cambiar de máquina, de letra de unidad o al mover el directorio, esas filas muestran `⚠ Carpeta no encontrada` y al pulsarlas se avisa de que la ruta no existe.
- **Causa**: `paths.ts` solo usa el marcador `${workspaceFolder}` para rutas **dentro de un espacio de trabajo**; fuera no hay ancla portátil, así que la única opción es una ruta absoluta.
- **Límites**: `${workspaceFolder}` siempre significa el **primer** espacio de trabajo; `${workspaceFolder:nombre}` / `${workspaceFolder:índice}` fallan al resolverse cuando esa raíz no existe (`⚠ No se puede resolver la ruta`) en lugar de apuntar a otro sitio en silencio. Una ruta relativa sin marcador se resuelve respecto al primer espacio.
- **Alternativa**: mantener los directorios dentro del espacio de trabajo para que la extensión guarde marcadores; para un árbol compartido entre máquinas, mover los directorios al espacio de trabajo o editar las rutas en bloque tras importar.

### 21. Ediciones externas concurrentes y riesgo de sobrescritura

- **Síntoma**: editar `resource-tree.json` directamente en VS Code no actualiza la vista; si un editor externo mantiene cambios sin guardar mientras la extensión hace un alta / renombrado / movimiento / borrado, la extensión reescribe el archivo completo desde su árbol en memoria.
- **Causa**: no hay `FileSystemWatcher`; cada cambio serializa todo el árbol en memoria. La escritura «archivo temporal hermano + rename» garantiza que **no se escribe un archivo a medias**, pero no hay fusión ni bloqueo entre procesos.
- **Prueba real de «gana el último que escribe»** (2026-10-26, VS Code 1.137.0, Windows 11; 17/17 pasos del sondeo en `.selftest/e2e-resource-tree-concurrency/`):
  - **Búfer externo sin guardar + escritura de la extensión → guardado externo** (búfer real del editor de texto de VS Code): el alta de la extensión se escribió en disco mientras el búfer seguía sucio. Al guardar el búfer, VS Code mostró `Failed to save ... The content of the file is newer`; tras pulsar **Overwrite** en la notificación, el búfer externo sustituyó el archivo. Al actualizar, la vista mostró solo la versión externa y el cambio de la extensión se **perdió**. Una comprobación previa a la escritura no puede evitar esta dirección: la pérdida ocurre cuando el editor externo guarda después.
  - **Escritura de la extensión → sobrescritura externa → Actualizar**: Actualizar lee la versión externa y descarta el estado en memoria anterior de la extensión (al leer gana el archivo externo).
  - **Llamada directa a `storage.writeStore`**: no hay ninguna comprobación de conflictos; un árbol externo ya guardado fue sustituido byte a byte por el store recibido. La protección de abajo solo existe en `ResourceTreeProvider.commit`.
- **Refuerzo de bajo coste (implementado)**: antes de cada escritura, `commit` vuelve a leer el archivo y lo compara de forma canónica con el texto que la extensión cargó / escribió por última vez (`classifyExternalChange` en `storageCore.ts`; las diferencias de sangría / BOM no cuentan). Ante `modified` / `created` / `deleted` / JSON no analizable muestra un **aviso no modal** con **Sobrescribir cambios externos** / **Cancelar**:
  - **Cancelar** (o cerrar la notificación): no se escribe nada; el árbol en memoria y el archivo externo quedan igual.
  - **Sobrescribir cambios externos**: la escritura continúa; el cambio externo ya guardado se pierde igualmente. Es una decisión explícita, no una fusión.
- **Límites restantes**: la comprobación es leer-antes-de-escribir (TOCTOU); un guardado externo que llegue entre la comprobación y el rename aún puede sobrescribirse. Sigue sin haber vigilancia de archivos, fusión ni bloqueo entre procesos; la dirección «externo sin guardar» del primer punto sigue siendo inevitable. `writeStore` / las rutas de exportación no ejecutan la comprobación.
- **JSON no válido**: guardar JSON no válido fuera y pulsar Actualizar conserva el árbol actual, no sobrescribe el archivo y no se bloquea; el aviso dice «el árbol actual se mantiene, el archivo no se sobrescribirá». Una edición posterior de la extensión se trata como cambio externo y pide la misma confirmación.
- **Matar el proceso entre dos escrituras**: tras completar la escritura 1 y matar a la fuerza el host de extensiones antes de la 2, el archivo quedó idéntico byte a byte (mismo md5) y **sin restos `.tmp-*`**; el host se reinició y la vista mostró el contenido de la escritura 1. No se capturó un kill **durante** la escritura del temporal / rename (la ventana es muy corta; los restos `.tmp-*` se tratan en el punto 23).
- **Alternativa**: pulsar Actualizar antes y después de editar fuera; no hacer altas / bajas / movimientos en la vista mientras el archivo esté abierto fuera; cuando aparezca el aviso, comparar antes de elegir Sobrescribir; evitar escrituras simultáneas si varias personas comparten un mismo JSON.

### 22. Enlaces simbólicos, permisos ausentes y límites multitráiz

- **Enlaces simbólicos**: el estado de la carpeta se comprueba de forma asíncrona con `workspace.fs.stat`, que **sigue el enlace** (verificado en máquina real el 2026-10-26 con VS Code 1.137.0 en Windows 11; sondas y capturas en `.selftest/e2e-resource-tree-symlink/`). Un enlace a un directorio se trata como directorio (`SymbolicLink | Directory`); un enlace a un archivo se trata como archivo, así que un nodo de carpeta muestra `⚠ No es una carpeta`; un **enlace roto** hace que stat termine correctamente con solo el bit `SymbolicLink` (el destino ya no existe) y ahora se muestra como `⚠ Enlace roto`, con el tooltip «⚠ el destino del enlace no existe, no se puede abrir» y el aviso al pulsar «Enlace roto (el destino no existe): <ruta>», en lugar del engañoso «No es una carpeta» anterior. El árbol guarda la ruta del enlace, no la resuelve al destino; tras restaurar el destino, Actualizar devuelve el estado de directorio / archivo.
- **Permisos ausentes**: en NTFS local, aunque la ACL del directorio niegue la lectura al usuario actual, `workspace.fs.stat` sigue leyendo los atributos y devuelve directorio: el árbol lo muestra como una carpeta normal, así que **no se confunde con «no existe», pero tampoco avisa de antemano**. El fallo aparece solo al leer el contenido: el panel de subárbol muestra «No se puede leer: …» con un token de usuario normal. Esta máquina de prueba se ejecutó como Administrador con `SeBackupPrivilege` habilitado, lo que también permitió enumerar el directorio, por lo que la ruta EACCES no se pudo reproducir aquí (queda registrado en `priv-check.txt`). Si un proveedor de sistema de archivos lanza `NoPermissions` en la fase de stat, la implementación actual sigue mostrando `⚠ Carpeta no encontrada`: **en la capa de stat «sin permisos» y «no existe» siguen siendo indistinguibles**; los errores concretos aparecen solo al abrir el subárbol o al leer / escribir el archivo de almacenamiento.
- **Espacios multitráiz** (verificado en máquina real el 2026-10-26 con VS Code 1.137.0 en Windows 11; sondas en `.selftest/e2e-resource-tree-multiroot/`): el almacenamiento va por defecto a la **primera** raíz; `${workspaceFolder:nombre}` / `${workspaceFolder:índice}` pueden apuntar a otras raíces; no hay semántica de «mover entre raíces» (mover solo cambia la estructura del JSON, nunca el directorio del disco). `${workspaceFolder}` sigue a la primera raíz, los marcadores por nombre / índice resuelven a la segunda raíz y un nombre / índice inexistente muestra `⚠ no se puede resolver la ruta` (marcador original en el tooltip y aviso al pulsar). Añadir una carpeta desde el menú contextual del Explorador guarda `${workspaceFolder:<nombre>}`, nunca una ruta absoluta. Al eliminar la primera raíz, VS Code reinicia el host de extensiones (comportamiento de la plataforma, no un fallo); el almacenamiento por defecto pasa a la nueva primera raíz, el archivo antiguo queda intacto, `${workspaceFolder}` apunta ahora a la nueva primera raíz (los nodos existentes pueden mostrar `⚠ la carpeta no existe`), los marcadores por índice dejan de resolver y el árbol sigue funcionando. No hay un aviso emergente aparte para ese cambio: el título de la vista muestra la ruta del almacenamiento, con el nombre de la raíz como prefijo mientras el espacio tenga más de una raíz.
- **Añadir desde el Explorador**: la entrada `explorer/context` admite multiselección. Con varios elementos, las carpetas se añaden en lote usando el nombre de la carpeta como nombre visible (sin pedir un nombre por cada una); los archivos y demás entradas que no son directorios se omiten con un aviso resumen; una misma ruta real solo se añade una vez por lote, aunque se siguen permitiendo duplicados entre lotes. Al arrastrar una multiselección se añaden todas las carpetas del mismo modo.

### 23. Topes de tamaño del árbol de recursos y caché de estado de carpetas

- **Topes**: 2000 nodos en total, 200 hijos por nivel, profundidad 12, 120 caracteres por nombre. Los nodos que exceden los topes se truncan al leer con una advertencia; al crear interactivamente en el límite solo se avisa «se alcanzó el límite de nodos o de profundidad».
- **Estado de carpetas**: los estados se comprueban de forma asíncrona con `workspace.fs.stat` y se cachean como `directory` / `file` / `missing` / `broken-link` (TTL de 30 s, máximo 2000 entradas, 8 stats concurrentes). Recargar / Actualizar / alta / renombrado / movimiento / borrado / cambios de `wispkit.resourceTree.file` / cambios de carpetas del espacio reconstruyen o podan la caché, y `getTreeItem` solo la lee: en esa ruta **ya no queda ningún `fs.statSync` síncrono**. Un fallo de caché se pinta como estado desconocido (icono de carpeta normal, tooltip «comprobando…») y se consulta en segundo plano; una entrada caducada sigue mostrando su último valor hasta que vuelve la comprobación. Sin vigilancia de archivos, un cambio externo puede tardar hasta el TTL de 30 s (o un Actualizar manual) en aparecer.
- **Coste**: banco local (2000 nodos / 1000 subdirectorios, sonda: `.selftest/resource-tree-cache/bench.mjs`): 1000 stats síncronos ≈ **23–26 ms** de trabajo bloqueante en el hilo del extension host; tras la precarga asíncrona con 8 vías, 2000 consultas equivalentes a `getTreeItem` tardan ≈ **2,8–3,8 ms** con **0** stats síncronos. En una instancia real de VS Code con el mismo árbol de 2000 nodos / 1000 subdirectorios, expandir un grupo de 199 hijos tardó ≈ **55 ms** y un Actualizar manual (esperando los 1989 stats de carpeta) ≈ **0,7–0,9 s**; esa espera es asíncrona y no bloquea la interfaz. El comportamiento en unidades de red sigue sin probarse (véase el elemento no verificado 14).
- **Archivos temporales**: matar el proceso a mitad de escritura puede dejar archivos `.tmp-*` en el mismo directorio; los archivos antiguos no se ven afectados, pero los restos no se limpian automáticamente.

### 24. La vista previa 2D de `.mmd` depende de la extensión Mermaid integrada

- **Síntoma**: en un VS Code que incluye scripts de vista previa Mermaid (`mermaid-markdown-features`, 1.104+), un archivo `.mmd` se renderiza como diagrama; sin ella la vista degrada a modo fuente.
- **Causa**: Wispkit no empaqueta su propio renderizador Mermaid; usa el mismo pipeline de contribución `markdown.previewScripts` que la vista Markdown.
- **Alternativa**: actualizar VS Code o instalar una extensión que aporte vista previa Mermaid; la navegación 3D no se ve afectada (usa el analizador de topología propio).

### 25. Un archivo `.mmd` se trata como un solo diagrama

- **Síntoma**: varios diagramas Mermaid en un mismo archivo (por ejemplo unidos con líneas en blanco o `---`) no se dividen en varios elementos; todo el código pasa por un único análisis.
- **Causa**: la convención habitual de `.mmd` es un diagrama por archivo; la idea de varios elementos gráficos es propia de Markdown.
- **Alternativa**: poner varios diagramas en cercas Markdown, o usar dos archivos en paralelo para compararlos.

### 26. La navegación 3D de `.mmd` comparte los límites del analizador Mermaid

- **Síntoma**: en 3D, `.mmd` sigue teniendo los 12 tipos admitidos más el respaldo genérico, como máximo 600 nodos por gráfico y encadenado por líneas para tipos desconocidos.
- **Causa**: `wispkit.graph3d` usa el mismo `src/graph3d/mermaid.ts` para ambas entradas; no hay un analizador separado para archivos Mermaid.
- **Alternativa**: igual que los puntos 15 y 17.

### 27. HEIF / HEIC y varios contenedores de vídeo no se pueden decodificar in situ

- **Síntoma**: las imágenes HEIC / HEIF, TIFF y JXL muestran «no se puede mostrar» en la vista de imagen; vídeos MKV / AVI / WMV / FLV / RMVB y similares normalmente solo obtienen el respaldo de «abrir en el reproductor del sistema».
- **Causa**: la decodificación se delega por completo al runtime Chromium de VS Code. HEIF necesita libheif (una compilación WASM ocupa varios MB); TIFF / JXL y la mayoría de contenedores de vídeo no tienen decodificador en Chromium. Siguiendo la regla «no implementar si exige una dependencia grande», Wispkit no empaqueta ninguno y no llama a códecs específicos de Windows.
- **Excepción**: los formatos cuyos códecs vienen con el runtime — MP4 (H.264 / AAC), WebM (VP8 / VP9) — sí se reproducen; una extensión como `.mkv` solo significa «Wispkit lo ha recogido», y la reproducción real depende del contenedor y códec internos.
- **Alternativa**: abrirlo en el reproductor del sistema o transcodificarlo a MP4 (H.264 / AAC).
- **Verificado**: en VS Code 1.137.0 / Electron 42 reales: WebP, AVIF y SVG se decodifican; aparece el panel de respaldo HEIC; la reproducción MP4 avanza `currentTime`; un MKV corrupto muestra el respaldo de código de error 4 (`.selftest/e2e-media/probe-media.mjs`, 17/17).

### 28. El destino de carpeta de un acceso directo solo llega al panel de subárbol

- **Síntoma**: con `wispkit.shellLink.openBehavior` en `internal`, un acceso directo que apunta a una carpeta abre el panel de subárbol; no hay forma de abrir esa misma carpeta en el navegador de comparación.
- **Causa**: el navegador de comparación no acepta un directorio inicial, así que el panel de subárbol es el único destino interno.
- **Alternativa**: navegar a la carpeta a mano en el navegador de comparación, o volver a poner el comportamiento en `system`.

### 29. Los archivos `.dll` no tienen página de propiedades

- **Síntoma**: un `.dll` no ofrece ninguna vía de «abrir como ejecutable»; solo se reclama `.exe`.
- **Causa**: solo `*.exe` está registrado como selector. El analizador PE es válido para DLL y declara el indicador de DLL, pero ningún selector reclama la extensión.
- **Alternativa**: usar un visor PE externo, o copiar el archivo con extensión `.exe`.

### 30. La edición de accesos directos es solo para Windows

- **Síntoma**: en macOS y Linux la página del acceso directo muestra los campos analizados pero no el formulario de edición.
- **Causa**: escribir un `.lnk` pasa por el objeto de acceso directo del anfitrión de scripts de Windows; la extensión no incluye un equivalente multiplataforma.
- **Alternativa**: editar el acceso directo en Windows.

### 31. Un acceso directo que solo guarda una IDList de destino no puede abrirse internamente

- **Síntoma**: con el comportamiento en `internal`, ese acceso directo recurre a entregar el archivo al sistema en lugar de abrir el destino.
- **Causa**: el archivo registra una lista de elementos del shell y no una ruta absoluta legible, así que no hay ninguna ruta que se pueda abrir con seguridad.
- **Alternativa**: usar la vía del sistema.

### 32. Los archivos por encima del tope de 256 MB se rechazan

- **Síntoma**: abrir un acceso directo o un ejecutable mayor que el tope informa del tamaño y no lo analiza.
- **Causa**: analizar un archivo sin límite en el anfitrión de la extensión bloquearía la interfaz.
- **Alternativa**: usar una herramienta externa de PE o de accesos directos.

### 33. El análisis de accesos directos es multiplataforma, pero la apertura y la edición no

- **Síntoma**: en macOS y Linux los campos del `.lnk` se leen, mientras que la vía de apertura del sistema y el formulario de edición no están disponibles.
- **Causa**: el análisis es a nivel de bytes e independiente de la plataforma; abrir y escribir están ligados a la plataforma.
- **Alternativa**: abrir el acceso directo a través del sistema en esas plataformas.

### 34. Los iconos reales de archivo solo existen en Windows

- **Síntoma**: en macOS y Linux, las filas `.lnk` y `.exe` muestran el icono genérico del tema de iconos en lugar del incrustado en el archivo.
- **Causa**: el icono se toma mediante la asociación de shell de Windows (`ExtractAssociatedIcon`); otras plataformas no tienen equivalente, y descodificar recursos PE a mano solo para dibujar un icono de 16 px no compensa el código.
- **Alternativa**: usar allí el tema de iconos — el análisis, la apertura y todo lo demás siguen funcionando.

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
| 9 | **Rendimiento 3D con grafos grandes** | Las pruebas unitarias solo cubren el truncado a 600 nodos y el determinismo del diseño; la fuerza dirigida es O(n²), cada nodo tiene una textura Canvas y cada arista un TubeGeometry, y las muestras reales solo tenían 3–8 nodos | Usar un Markdown con 200 elementos / un grafo de 600 nodos y registrar tiempos de apertura, diseño y rotación, además de la memoria |
| 10 | **Corrección visual en la vista 3D real de tipos distintos de árbol ASCII / flowchart / sequence** | Los 12 analizadores y diseños Mermaid solo tienen pruebas unitarias; la aceptación real de 1/2 solo miró árboles ASCII, flowchart y sequence | Abrir uno a uno class / state / er / mindmap / gitGraph / journey / gantt / timeline / pie / quadrant y un grafo de respaldo genérico en el panel 3D real y comprobar que nodos y aristas se leen |
| 11 | **Legibilidad de la vista 3D fusionada con grupos complejos / muchas aristas** | La fusión tiene pruebas unitarias, pero la reasignación de grupos, los cruces de aristas y la ocultación de texto no se evaluaron en máquina real | Preparar dos grafos grandes de 50+ nodos cada uno, con muchos nodos homónimos y grupos, fusionarlos y revisarlos a ojo |
| 12 | **Comportamiento real de espacios multitráiz** — ✅ verificado (2026-10-26, VS Code 1.137.0, Windows 11) | verificado con dos raíces: el almacenamiento por defecto y `${workspaceFolder}` siguen a la primera raíz; `${workspaceFolder:ws-b}` / `${workspaceFolder:1}` resuelven a la segunda; un nombre / índice inexistente muestra `⚠ no se puede resolver la ruta` con tooltip y aviso al pulsar; añadir desde el menú contextual del Explorador en la segunda raíz guarda un marcador; eliminar la primera raíz cambia el almacenamiento por defecto a la nueva primera raíz (archivo antiguo intacto), re-resuelve `${workspaceFolder}` a la nueva primera raíz, invalida los marcadores por índice y no provoca fallos. Evidencia: `.selftest/e2e-resource-tree-multiroot/probe-multiroot*.mjs` y capturas `mr-01…mr-14` | cerrado — no requiere más verificación |
| 13 | **Rename atómico en sistemas de archivos remotos / virtuales** | `workspace.fs.rename(overwrite)` puede no estar soportado por algunos proveedores; la política actual es «fallar con error y no tocar el archivo antiguo», sin respaldo copy+fsync. **Comprobación local (2026-10-26, VS Code 1.137.0)**: la extensión Remote-SSH no está instalada y no hay ningún host SSH disponible, la característica opcional WSL está deshabilitada, Docker / Dev Containers no están instalados y Remote Tunnels no tiene cuenta: ninguno de los cuatro proveedores está disponible. Solo se verificó un recurso compartido SMB de bucle local (`\\localhost\ShareData` → `Z:`, sigue siendo el proveedor `file`): `rename(overwrite:true)` funciona y `overwrite:false` lanza `FileExists`; una escritura de 1500 nodos / 161 KB tardó 24–30 ms, el `.tmp-*` del mismo directorio fue visible durante la escritura y no quedaron restos; con el destino bloqueado por un proceso externo la escritura falló con `EBUSY ... unlink '<target>'`, el archivo antiguo permaneció idéntico byte a byte y el temporal se limpió, y el mismo comando funcionó tras desbloquear. **SSH / WSL / Containers / Tunnels y los sistemas de archivos entre hosts / no Windows siguen sin verificar** | Editar y guardar el árbol de recursos por SSH / WSL / Remote Containers y observar si hay errores |
| 14 | **Rendimiento de stat en unidades de red / árboles enormes** | el `fs.statSync` síncrono por fila ya no existe y el banco local de 2000 nodos / 1000 subdirectorios pasa (véase el elemento 23), pero los recursos compartidos de red, la alta latencia y las implementaciones de `workspace.fs` de cada proveedor siguen sin probarse; los cambios externos también pueden tardar hasta el TTL de 30 s | Apuntar el árbol a un recurso compartido de red o a un directorio con miles de subdirectorios y registrar los tiempos de primera expansión / actualización y la fluidez de la interfaz |
| 15 | **Tiempo de conflicto de ediciones externas concurrentes** — ✅ verificado (2026-10-26, VS Code 1.137.0, Windows 11) | Construido con un búfer real del editor de texto de VS Code y un escritor externo: búfer externo sin guardar + escritura de la extensión → guardado externo → Actualizar pierde la escritura de la extensión (VS Code pide antes Overwrite / Compare); escritura de la extensión → sobrescritura externa → Actualizar lee la versión externa; JSON no válido + Actualizar conserva el árbol, no toca el archivo y no se bloquea; matar el host de extensiones entre dos escrituras deja el archivo intacto y sin `.tmp-*`. Se añadió una comparación canónica previa a la escritura con aviso no modal Sobrescribir / Cancelar: Cancelar deja ambos lados igual, Sobrescribir sigue siendo «gana el último que escribe» y la comprobación tiene una ventana TOCTOU. Evidencia: `.selftest/e2e-resource-tree-concurrency/probe-concurrency.mjs` (17/17), capturas `cc-01…cc-11` | cerrado — la ventana de kill durante la escritura se registra en el punto 23 |
| 16 | **Presentación de enlaces simbólicos / rutas sin permisos** — ✅ verificado (2026-10-26, VS Code 1.137.0, Windows 11) | Se crearon enlaces simbólicos de directorio y de archivo, enlaces rotos (directorio / archivo), un directorio de solo lectura y un directorio con ACL denegada: el enlace de directorio se trata como directorio, el de archivo muestra `⚠ No es una carpeta`, los enlaces rotos ahora muestran `⚠ Enlace roto` con un aviso claro al pulsar; el directorio de solo lectura no cambia; el directorio con ACL denegada sigue haciendo stat con éxito en NTFS local, así que el árbol lo muestra como carpeta normal (no se confunde con «no existe», pero tampoco avisa). EACCES no se pudo reproducir porque la máquina se ejecutó como Administrador con `SeBackupPrivilege`. Evidencia: `.selftest/e2e-resource-tree-symlink/probe-symlink-{before,after}.mjs` y `sym-*.png` | cerrado, no requiere más verificación |
| 17 | **Las páginas de propiedades de accesos directos y ejecutables en una ventana real de VS Code** | el análisis, la política de apertura, la reescritura al editar y el lector PE tienen casos unitarios, pero ninguna página se ha abierto en una ventana en ejecución, y la vía editable llama al anfitrión de scripts de Windows, que ninguna prueba unitaria puede ejecutar | abrir un `.lnk` y un `.exe` reales en esta vista, cambiar un campo y guardar, y luego reabrir el acceso directo para confirmar que el cambio llegó y que el icono y la tecla de acceso rápido sobrevivieron |

> La comprobación local del punto 13 se completó el 2026-10-26; las sondas y capturas están en `.selftest/e2e-resource-tree-remote/` (`probe-remote.mjs`, `probe-ui-only.mjs`, `rem-01…rem-03`). En esta máquina no hay ninguno de los cuatro proveedores nombrados, por lo que el punto **sigue sin verificar**; solo se obtuvo evidencia del proveedor `file` sobre un recurso compartido SMB de bucle local, y tanto el recurso como VS Code están en el mismo host Windows, así que no representa un sistema de archivos entre hosts / Linux. Observación adicional: con el destino bloqueado, `workspace.fs.rename(overwrite:true)` falló con `EBUSY ... unlink '<target>'`, es decir, esa ruta ejecuta un unlink del destino; si el unlink tiene éxito y el rename posterior falla (por ejemplo, si se mata el proceso), el archivo antiguo puede haber desaparecido y solo quedar el `.tmp-*`. Sigue sin haber respaldo copy+fsync.

> El punto 9 queda cerrado en esta pasada de documentación: los enlaces relativos y las anclas de todo el conjunto documental los comprueba `node tools/docs-check.mjs`, que debe informar de **0 problemas**.

> El punto 12 queda cerrado el 2026-10-26: el comportamiento multitráiz se verificó en máquina real (sondas y capturas en `.selftest/e2e-resource-tree-multiroot/`). La fila se conserva solo para no alterar la numeración de los elementos siguientes.

> **Verificación 3D ya realizada**: entrada (menú contextual / paleta de comandos), reapertura que solo revela, recuento en el título, selectores izquierdo/derecho con paneles 15%–85%, fusión / `Esc`, control de intervalo, actualización, restablecer vista, arrastrar izquierdo para rotar / derecho para desplazar / rueda para zoom, adaptación al tamaño de ventana y revalidación del VSIX empaquetado pasaron en VS Code 1.137.0 (sondas en `.selftest/e2e-graph3d/`, 2026-10-26). La tabla anterior solo enumera lo que sigue sin verificar.

## 3. Cómo usar esta lista

- **Antes de depender de un comportamiento**, confirmar aquí que no está en «no verificado».
- **Al informar de un fallo**, si cae en cualquiera de los elementos de la tabla anterior, puede ser una zona ciega conocida y no un problema nuevo.
- Este documento solo enumera «lo que hoy no se puede / no se ha verificado», no «lo que se planea hacer» — los planes están en el tablero o en el historial de commits.
