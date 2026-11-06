---
type: Specification
title: Requisitos y criterios de aceptación
description: El contrato de requisitos autorizado de Wispkit — cada capacidad entregada por número de requisito, sus criterios de aceptación y el protocolo de cambio que siguen todos los demás documentos
tags: [requirements, specification, acceptance]
status: stable
---

# Requisitos y criterios de aceptación

[English](requirements.md) | [中文](requirements.zh-CN.md) | **Español**

> Este documento es el contrato de requisitos de Wispkit: cada capacidad entregada bajo un número de requisito estable, los criterios con los que se juzga y el protocolo de cambio que siguen todos los demás documentos.

## Estatus de este documento

Wispkit es una extensión de mejora de navegación para Visual Studio Code. Este archivo declara **qué debe hacer la extensión**, con independencia de cómo lo haga una versión concreta.

- **Este archivo es la declaración autorizada de requisitos.** Cuando otro documento lo contradice, gana este archivo y el otro documento es defectuoso.
- [Arquitectura](architecture.es.md), [Vistas e interacción](views-and-interaction.es.md), [Configuración](configuration.es.md) y [Compilación y verificación](build-and-verify.es.md) son **notas de implementación**. Describen cómo se realiza una capacidad y cómo se reproduce una medición. Nunca amplían ni reducen lo que aquí se promete.
- **Todo lo que no figure aquí no es un compromiso.** Un comportamiento que existe sin número de requisito es un detalle de implementación y puede cambiar sin aviso.
- **Cada fallo conocido y cada elemento no verificado tiene exactamente un hogar en [Limitaciones conocidas](limitations.es.md) y una fila en el [§6 Diferido y excluido](#6-diferido-y-excluido).** Los dos no pueden contradecirse; una contradicción es un defecto de documentación, no un matiz.

## Convenciones de lectura

### Palabras normativas

| Palabra | Significado |
|---|---|
| **DEBE** / **TIENE QUE** | Requisito absoluto. Una versión que lo incumple es defectuosa, no «aproximadamente correcta». |
| **NO DEBE** / **NO PUEDE** | Prohibición absoluta. |
| **PUEDE** | Realmente opcional; cualquiera de las dos opciones es conforme. |
| **CUANDO … ENTONCES …** | La forma obligatoria de cada criterio de aceptación: una situación desencadenante y después un resultado observable desde fuera. |

### Numeración de requisitos y criterios

| Identificador | Significado |
|---|---|
| `R<n>` | Un requisito. Los números se asignan **en el orden en que se encargaron las capacidades** y nunca se reutilizan. |
| `AC-R<n>.<m>` | El criterio de aceptación *m*-ésimo del requisito *n*. Un requisito sin criterio no es un requisito. |
| `demo/R<n>-*/` | El conjunto de material de aceptación del requisito *n*. Esa correspondencia forma parte del contrato: renombrar o borrar un directorio de material rompe la trazabilidad. |

Tres hechos de numeración son estructurales y deben sobrevivir a cualquier edición posterior:

1. **`R7` está retirado y no debe reutilizarse.** Se asignó originalmente a dos capacidades encargadas juntas — el modo global de solo lectura y el panel de subárbol del Explorador — que después se separaron. Ambas recibieron finalmente su propio número (`R10` y `R11`); el número compartido quedó vacante en lugar de reasignarse, para que ninguna referencia histórica cambie de significado en silencio.
2. **`R12` no es una capacidad propia.** Es el conjunto de material producido para la vista XAML después de sustituir su renderizador, y queda registrado bajo `R6`. Tanto `demo/R6-xaml/` como `demo/R12-xaml/` son material de aceptación legítimo para `R6`; ninguno puede borrarse con el argumento de que «el otro ya lo cubre».
3. **`R9` cubre una vista, no solo un directorio de material.** Su archivo de almacenamiento real se crea en la primera edición, así que un espacio de trabajo nuevo muestra legítimamente un árbol vacío antes de cargar `demo/R9-resource-tree/`.

## 1. Intención del producto

1. **La extensión DEBE mejorar la navegación sin modificar el anfitrión.** NO DEBE parchear, reemplazar ni escribir en la instalación de Visual Studio Code, y NO DEBE incluir ningún recurso modificado de una extensión integrada. Cada capacidad se entrega a través de la superficie pública de extensiones y sobrevive a una actualización del anfitrión sin volver a parchear.
2. **El anfitrión DEBE poseer las rutas; el front-end DEBE poseer la interacción.** Una URL de recurso dentro de una webview TIENE QUE tratarse como opaca y NO DEBE convertirse de vuelta en una ruta del sistema de archivos. Cuando el front-end necesita una ruta real o un fragmento de origen, DEBE informar una posición, y el anfitrión DEBE releer la ruta del documento original.
3. **El renderizado DEBE pasar por la tubería propia del anfitrión.** El Markdown DEBE renderizarse con el renderizador Markdown integrado del anfitrión, de modo que todo plugin de terceros aportado por otras extensiones siga funcionando. La extensión NO DEBE sustituir una implementación privada de Markdown en la ruta por defecto.
4. **«Solo lectura» DEBE significar «no cargado», no «edición deshabilitada».** El modo de solo lectura existe para evitar el coste de cargar un archivo, así que DEBE evitar materializar el documento completo; limitar la ventana cargada es el requisito, no una optimización.
5. **Una capacidad solo PUEDE juzgarse por resultados observables desde fuera.** Un criterio de aceptación DEBE describir lo que un usuario o un observador automatizado puede ver tras una acción, nunca que una regla, un ajuste o un mensaje existan.

## 2. Alcance y no objetivos

### Dentro del alcance

| Área | Entregada por |
|---|---|
| Navegación Markdown: navegación por directorio, zoom del cuerpo, búsqueda en el documento, menú contextual de medios, edición de drawio en el sitio, edición de párrafos en el sitio, rendimiento en documentos grandes | `R1`, `R2`, `R15`, `R16`, `R17` |
| Navegación de diagramas: zoom de Mermaid en Markdown, vista de archivo Mermaid independiente, navegación de topología 3D | `R3`, `R8`, `R13` |
| Navegación de medios: imágenes con zoom por rueda y paneo arrastrando un botón, reproducción de vídeo con reserva al reproductor del sistema | `R4`, `R14` |
| Contenido web: vista HTML con enrutado interno de enlaces | `R5` |
| Origen y render de XAML uno al lado del otro | `R6` |
| Navegación de texto de solo lectura con una ruta de desbloqueo | `R10` |
| Organización de archivos: árbol de recursos personalizado en la barra de actividades, panel de subárbol del Explorador | `R9`, `R11` |
| Localización de la propia superficie de la extensión | `R18` |
| Páginas de propiedades de accesos directos y ejecutables de Windows | `R19` |

### Fuera del alcance

| No se entrega | Por qué |
|---|---|
| Adueñarse de la página Simple Browser del anfitrión | Se crea por comando como panel de webview y nunca entra en la competición de editores personalizados; adueñarse de ella no es expresable en la superficie pública |
| Cambiar el comportamiento o los recursos de cualquier extensión integrada | Viola la intención 1; una extensión integrada solo se *consume*, nunca se modifica |
| Sincronización de desplazamiento editor ↔ vista previa | Requiere un protocolo de mapa de origen que la vista previa no produce; la navegación por directorio no depende de él a propósito |
| Una capa general de mapa de origen entre la salida renderizada y las líneas del código | La única línea de origen que se consume es la necesaria para localizar un párrafo; un mapa completo es otra capacidad con su propio presupuesto de precisión |
| Incluir decodificadores grandes de terceros para imagen y vídeo | Un códec como HEIF cuesta megabytes y contradice la regla de «ninguna dependencia grande»; esos formatos reciben una entrega explícita |
| Un respaldo 2D para la escena 3D | El panel 3D es un instrumento de topología, no un renderizador de diagramas; una proyección 2D prometería en silencio otro producto |
| Reimplementar el renderizador de una biblioteca de diagramas para igualar su apariencia | La vista 3D consume solo topología; la igualdad de píxeles con los temas de la biblioteca queda explícitamente fuera de lo prometido |
| Precargar diccionarios de recursos entre archivos al renderizar XAML | Exige resolver el grafo de recursos de una aplicación, que es específico de cada aplicación y sin límite |

## 3. Requisitos

### R1  Los scripts de vista previa Markdown de terceros se ejecutan bajo una CSP estricta

**Requisito.** La vista Markdown DEBE ejecutar cada script y aplicar cada hoja de estilo aportados por otras extensiones instaladas a través de los puntos de contribución de vista previa Markdown del anfitrión. La vista TIENE QUE usar una política de seguridad de contenido estricta: los scripts DEBEN admitirse solo por nonce, y el script en línea NO DEBE admitirse relajando la política. Cuando el documento cambie, la extensión DEBE notificar a los scripts aportados para que puedan volver a renderizar.

**Justificación.** El renderizado de diagramas, la composición de fórmulas y el coloreado de sintaxis del ecosistema Markdown llegan como scripts de vista previa aportados. Un renderizador privado los descartaría en silencio, y por eso la intención 3 hace obligatoria la tubería del anfitrión. Reutilizar la política propia del anfitrión significa que un script de terceros escrito para la vista previa integrada funciona aquí sin cambios.

**Criterios de aceptación.**

- **AC-R1.1** — **CUANDO** una extensión instalada aporta scripts o estilos de vista previa, **ENTONCES** abrir un documento Markdown muestra su salida renderizada (diagramas, fórmulas, resaltado) sin configuración por extensión.
- **AC-R1.2** — **CUANDO** la vista ha terminado de renderizar, **ENTONCES** el recuento de violaciones de la política de seguridad de contenido es cero.
- **AC-R1.3** — **CUANDO** cambia el texto del documento, **ENTONCES** los scripts aportados se vuelven a ejecutar y su salida refleja el texto nuevo.
- **AC-R1.4** — **CUANDO** la extensión que aporta el script se desinstala y el documento se reabre, **ENTONCES** la vista sigue renderizando y no informa de ningún error.
- **AC-R1.5** — **CUANDO** existe una referencia relativa a una imagen en el documento, **ENTONCES** se carga desde el directorio del propio documento y no desde el directorio de instalación de la extensión.

**Evidencia.** [Vistas e interacción → Vista Markdown](views-and-interaction.es.md#vista-markdown-wispkitmarkdown); material en `demo/R1-injection/`; medido en [Compilación y verificación](build-and-verify.es.md).

### R2  La navegación por directorio sigue al documento

**Requisito.** La vista Markdown DEBE presentar una barra lateral que enumere cada encabezado del documento, DEBE resaltar la sección actualmente visible mientras el cuerpo se desplaza y DEBE saltar a un encabezado cuando se active su entrada. El ancho de la barra lateral DEBE ser ajustable y restablecible, y la barra DEBE poder quitarse en una sola acción.

**Justificación.** Un documento largo se navega por su estructura. El resaltado se deriva de la geometría renderizada y no de un mapa de origen, que es lo que mantiene esta capacidad independiente de la sincronización de desplazamiento.

**Criterios de aceptación.**

- **AC-R2.1** — **CUANDO** se abre un documento con encabezados, **ENTONCES** el número de entradas de la barra lateral es igual al número de encabezados que el documento contiene realmente.
- **AC-R2.2** — **CUANDO** el cuerpo se desplaza hasta una sección, **ENTONCES** la entrada de esa sección se muestra como actual, sin ninguna entrada obsoleta.
- **AC-R2.3** — **CUANDO** se activa una entrada, **ENTONCES** el encabezado correspondiente queda en la parte superior del área visible con una tolerancia de una altura de línea.
- **AC-R2.4** — **CUANDO** se arrastra el separador y después se hace doble clic, **ENTONCES** la barra lateral vuelve a su ancho por defecto.
- **AC-R2.5** — **CUANDO** se deshabilita la barra lateral por configuración, **ENTONCES** la barra lateral entera está ausente y el cuerpo ocupa todo el ancho.
- **AC-R2.6** — **CUANDO** el documento se edita de forma que se añaden o quitan encabezados, **ENTONCES** la barra lateral se reconstruye y sigue cumpliendo AC-R2.1.

**Evidencia.** [Vistas e interacción → Tabla de contenidos](views-and-interaction.es.md#índice-de-contenido); material en `demo/R2-toc/`.

### R3  Los diagramas Mermaid en Markdown se amplían y se desplazan por defecto

**Requisito.** La vista Markdown DEBE permitir al lector ampliar y desplazar un diagrama Mermaid **sin mantener una tecla modificadora**, y DEBE ofrecer una vista a ventana completa para inspeccionarlo de cerca. La ampliación DEBE seguir disponible después de editar el documento y volver a renderizar el diagrama.

**Justificación.** Un diagrama en la columna de un documento suele ser ilegible en su tamaño de maquetación, y exigir una tecla modificadora hace que la capacidad sea en la práctica imposible de descubrir. La capacidad pertenece al lector del documento, que puede no tener configurada ninguna extensión de diagramas.

**Criterios de aceptación.**

- **AC-R3.1** — **CUANDO** se muestra un diagrama y el puntero está sobre él, **ENTONCES** la rueda cambia su escala sin ninguna tecla modificadora pulsada.
- **AC-R3.2** — **CUANDO** un diagrama está ampliado, **ENTONCES** arrastrarlo lo desplaza y un gesto de restablecimiento lo devuelve a su escala original.
- **AC-R3.3** — **CUANDO** el documento se edita y el diagrama se vuelve a renderizar, **ENTONCES** la ampliación y el desplazamiento siguen funcionando sobre la salida nueva.
- **AC-R3.4** — **CUANDO** la vista ampliada está abierta, **ENTONCES** cerrarla restaura el documento exactamente como estaba, sin alterar el diagrama del documento.
- **AC-R3.5** — **CUANDO** el diagrama se amplía en la vista a ventana completa, **ENTONCES** sus colores coinciden con los que tenía en la columna del documento.

**Evidencia.** [Vistas e interacción → Menú contextual de medios](views-and-interaction.es.md#menú-contextual-de-medios); material en `demo/R3-mermaid/`; el valor por defecto de configuración que elimina la tecla modificadora está documentado en [Configuración](configuration.es.md).

### R4  Las imágenes se amplían con la rueda y se desplazan arrastrando un botón

**Requisito.** La vista de imagen DEBE ampliar con un gesto de rueda simple, anclado en el puntero, DEBE desplazar mientras se mantiene pulsado un botón de arrastre y DEBE alternar entre ajustar a la ventana y 100 % con doble clic. Ampliar NO DEBE desenfocar una imagen ráster más allá de su resolución de origen, y DEBE volver a renderizar una imagen vectorial con el tamaño de maquetación nuevo. Para los formatos que el tiempo de ejecución del anfitrión no puede decodificar, la vista DEBE indicar el motivo y ofrecer una entrega en lugar de mostrar una página en blanco.

**Justificación.** Navegar una imagen es una tarea de comparación: el lector quiere ver detalle sin perder el sitio. Anclar en el puntero es lo que hace que gestos repetidos de rueda converjan en el punto de interés en lugar de derivar.

**Criterios de aceptación.**

- **AC-R4.1** — **CUANDO** el puntero está sobre la imagen y la rueda gira sin ninguna tecla modificadora, **ENTONCES** la imagen escala alrededor del puntero y el centro de la vista no salta.
- **AC-R4.2** — **CUANDO** se mantiene pulsado el botón de arrastre configurado y el puntero se mueve, **ENTONCES** la imagen se desplaza; al soltar el botón el desplazamiento se detiene.
- **AC-R4.3** — **CUANDO** se hace doble clic sobre la imagen, **ENTONCES** alterna entre ajustar a la ventana y 100 %.
- **AC-R4.4** — **CUANDO** una imagen ráster se amplía más de tres veces su tamaño ajustado, **ENTONCES** se renderiza con escalado de vecino más cercano para que los píxeles sigan siendo legibles.
- **AC-R4.5** — **CUANDO** se amplía una imagen vectorial, **ENTONCES** cambia su tamaño de maquetación y no solo su transformación, de modo que los bordes se mantienen nítidos.
- **AC-R4.6** — **CUANDO** se abre un archivo en un formato seleccionado pero no decodificable, **ENTONCES** la página indica el motivo y ofrece tanto la entrega a la aplicación por defecto del sistema como la acción de copiar la ruta.
- **AC-R4.7** — **CUANDO** se deshabilita la configuración de zoom, **ENTONCES** la rueda deja de ampliar y vuelve a ser necesaria una tecla modificadora.

**Evidencia.** [Vistas e interacción → Vista de imagen](views-and-interaction.es.md#vista-de-imagen-wispkitimage); material en `demo/R4-image/`; resultados de sondas en [Compilación y verificación](build-and-verify.es.md).

### R5  Los enlaces dentro del contenido renderizado se abren en la ventana del anfitrión

**Requisito.** Tanto la vista Markdown como la vista HTML DEBEN enrutar la activación de un enlace: un destino relativo DEBE resolverse contra el directorio del propio documento; un destino que apunta a un archivo dentro del editor con un número de línea DEBE abrirse **en la ventana actual** en esa línea; un ancla dentro del documento DEBE desplazar el documento; y un destino que el anfitrión maneja por sí mismo (web, correo, otro esquema ya soportado) DEBE dejarse al anfitrión. Un enlace cuya activación por defecto ya impidió la propia página NO DEBE ser reabierto por la extensión.

**Justificación.** La documentación se refiere habitualmente a archivos de código por ruta y línea. Entregar ese enlace al navegador del sistema pierde la posición e interrumpe el contexto de lectura.

**Criterios de aceptación.**

- **AC-R5.1** — **CUANDO** se activa un enlace relativo, **ENTONCES** el destino se abre resuelto contra el directorio del documento, no contra el directorio de instalación de la extensión.
- **AC-R5.2** — **CUANDO** se activa un enlace que apunta a un archivo con un número de línea, **ENTONCES** el archivo se abre en la ventana actual con el cursor en esa línea — no en una ventana nueva y no en el navegador del sistema.
- **AC-R5.3** — **CUANDO** se activa un ancla dentro del documento, **ENTONCES** el documento se desplaza hasta ella sin recargar la página.
- **AC-R5.4** — **CUANDO** se activa un enlace web o de correo, **ENTONCES** el anfitrión lo maneja según su propia política.
- **AC-R5.5** — **CUANDO** la página impide por sí misma la activación por defecto de un enlace, **ENTONCES** la extensión no lo reabre.
- **AC-R5.6** — **CUANDO** el script propio de la página está bloqueado por su política de seguridad de contenido, **ENTONCES** las dos formas de enlace reescritas siguen navegando.

**Evidencia.** [Vistas e interacción → Vista HTML](views-and-interaction.es.md#vista-html-wispkithtml); material en `demo/R5-jump/`.

### R6  Origen XAML y resultado renderizado uno al lado del otro

**Requisito.** La vista XAML DEBE mostrar el origen de un archivo `.xaml` junto a una imagen renderizada del mismo, DEBE permitir editar el origen y volver a renderizar desde el texto actual sin guardar por medio, y DEBE permitir ampliar, desplazar y ver a ventana completa el render. Guardar DEBE escribir de vuelta en el mismo archivo. El resultado renderizado DEBE presentarse como una instantánea estática, y la vista DEBE indicar el motivo cuando el renderizado falla.

**Justificación.** Leer la definición de una maquetación sin ver su resultado es adivinar; editar una maquetación cambiando de ventana para ver el efecto es lento. La capacidad es deliberadamente una instantánea: evaluar contra datos vivos y ejecutar manejadores de eventos exigiría alojar la aplicación, lo que contradice la intención 1.

**Criterios de aceptación.**

- **AC-R6.1** — **CUANDO** un archivo `.xaml` se abre en esta vista, **ENTONCES** el origen se muestra junto a una imagen renderizada del mismo.
- **AC-R6.2** — **CUANDO** se edita el origen y se pide volver a renderizar, **ENTONCES** la imagen nueva refleja el texto editado antes de que el archivo se guarde.
- **AC-R6.3** — **CUANDO** se guarda el origen, **ENTONCES** el archivo en disco coincide con el texto editado.
- **AC-R6.4** — **CUANDO** se muestra el render, **ENTONCES** la rueda amplía, arrastrar con un botón desplaza y hay disponible una vista a ventana completa.
- **AC-R6.5** — **CUANDO** el renderizado falla, **ENTONCES** la página indica el fallo y sus causas habituales en lugar de mostrar un área en blanco.
- **AC-R6.6** — **CUANDO** el mismo `.xaml` se renderiza dos veces con el texto sin cambios, **ENTONCES** ambos renders no están en blanco y son visualmente equivalentes.
- **AC-R6.7** — **CUANDO** el elemento raíz es un tipo que no puede instanciarse en una instantánea, **ENTONCES** la vista renderiza igualmente la maquetación alojándola en su tipo base, o explica por qué no pudo.

**Evidencia.** Material en `demo/R6-xaml/` (primera generación) y `demo/R12-xaml/` (segunda generación, con artefactos de render registrados); contrato del renderizador y cobertura medida en [las notas del renderizador](../tools/xaml-render/README.md); el límite de la instantánea está en [Limitaciones conocidas](limitations.es.md#6-el-render-de-xaml-es-una-instantánea-estática).

### R8  Navegación 3D de topología de grafos Markdown y Mermaid

**Requisito.** La extensión DEBE abrir un panel 3D que renderice la topología de los elementos de gráfico encontrados en un documento Markdown o en un archivo Mermaid, DEBE permitir mostrar dos elementos uno al lado del otro y fusionarlos a través de nodos homónimos, y DEBE ofrecer controles de cámara, maquetación y separación. El panel DEBE indicar cuándo fusiona, cuántos nodos fusionó y qué flujos terminan en un marcador de posición.

**Justificación.** Un documento que acumula versiones de un diagrama se compara por estructura, no por estilo: qué nodos se comparten y cuáles son únicos. Leer dos gráficos 2D en paralelo obliga al lector a hacer un diff con la vista.

**Criterios de aceptación.**

- **AC-R8.1** — **CUANDO** se invoca la entrada 3D sobre un archivo Markdown, **ENTONCES** el panel se abre listando cada elemento de gráfico de ese documento con un nombre derivado del documento, no de un desplazamiento de archivo.
- **AC-R8.2** — **CUANDO** se pide el mismo archivo otra vez con el panel abierto, **ENTONCES** el panel existente se revela y no se crea un segundo panel.
- **AC-R8.3** — **CUANDO** se seleccionan dos elementos, **ENTONCES** se muestran uno al lado del otro con un divisor arrastrable limitado a un rango declarado y restablecible con doble clic.
- **AC-R8.4** — **CUANDO** se pide fusionar, **ENTONCES** los nodos con el mismo nombre entre los dos lados se convierten en uno, los flujos duplicados se colapsan y el panel indica cuántos se fusionaron.
- **AC-R8.5** — **CUANDO** los dos elementos no comparten ningún nombre de nodo, **ENTONCES** la fusión igualmente tiene éxito, informa cero nodos fusionados y mantiene los dos lados visualmente distintos.
- **AC-R8.6** — **CUANDO** el puntero arrastra con el botón principal, **ENTONCES** la cámara rota; con el botón secundario se desplaza; la rueda amplía.
- **AC-R8.7** — **CUANDO** la etiqueta de un nodo es un marcador de posición que indica una contraparte ausente, **ENTONCES** no se dibuja como burbuja y sus flujos se convierten en aristas colgantes cuya dirección de flecha se conserva.
- **AC-R8.8** — **CUANDO** un documento supera el tope declarado de elementos o de nodos, **ENTONCES** el exceso se trunca y el truncamiento se informa en lugar de aplicarse en silencio.
- **AC-R8.9** — **CUANDO** el tiempo de ejecución no puede proporcionar un contexto 3D, **ENTONCES** el panel indica el fallo en lugar de degradar a un renderizado 2D.

**Evidencia.** [Vistas e interacción → Navegación 3D de gráficos](views-and-interaction.es.md#navegación-3d-de-gráficos-wispkitgraph3d); material en `demo/R8-graph3d/`; resultados de sondas en [Compilación y verificación](build-and-verify.es.md).

### R9  Gestión de recursos personalizada en la barra de actividades

**Requisito.** La extensión DEBE proporcionar una vista en la barra de actividades en la que el usuario organice carpetas de uso frecuente en un árbol de grupos virtuales y carpetas de profundidad arbitraria. El árbol DEBE persistirse como un documento JSON dentro del espacio de trabajo, DEBE poder editarse tanto mediante la vista como como archivo, y cada mutación DEBE escribirse de inmediato y de forma atómica. Renombrar, mover y borrar DEBEN afectar solo al árbol, nunca al sistema de archivos.

**Justificación.** Las carpetas de uso frecuente están dispersas por el espacio de trabajo; llegar a una cuesta un recorrido de clics cada vez. Organizarlas es una anotación del espacio de trabajo, no una operación del sistema de archivos, así que el árbol nunca debe mover un archivo como efecto secundario.

**Criterios de aceptación.**

- **AC-R9.1** — **CUANDO** no hay ninguna carpeta de espacio de trabajo abierta, **ENTONCES** la vista indica que se requiere un espacio de trabajo y nombra dónde se almacenaría el árbol.
- **AC-R9.2** — **CUANDO** el árbol está vacío, **ENTONCES** la vista ofrece las acciones que crean contenido e indica que no se mueve ni se borra ningún archivo.
- **AC-R9.3** — **CUANDO** se añaden, renombran, mueven o borran nodos, **ENTONCES** el documento almacenado refleja la estructura nueva de inmediato, y ningún archivo o directorio en disco se renombra, mueve ni borra.
- **AC-R9.4** — **CUANDO** la ruta almacenada de un nodo de carpeta no puede resolverse, **ENTONCES** el nodo muestra un estado de advertencia específico que distingue ausente, no-es-carpeta y marcador irresoluble, y el resto del árbol sigue siendo utilizable.
- **AC-R9.5** — **CUANDO** un movimiento colocaría un nodo dentro de su propio descendiente, **ENTONCES** el movimiento se rechaza con una explicación.
- **AC-R9.6** — **CUANDO** el documento almacenado se edita externamente y se pide una actualización, **ENTONCES** el árbol se recarga; **CUANDO** el documento no es válido, **ENTONCES** el árbol actual se conserva y el archivo no se sobrescribe.
- **AC-R9.7** — **CUANDO** una escritura se interrumpe, **ENTONCES** el documento almacenado previamente sigue intacto.
- **AC-R9.8** — **CUANDO** el árbol supera el tope declarado de nodos, hijos o profundidad, **ENTONCES** el exceso se trunca al cargar y el truncamiento se informa.
- **AC-R9.9** — **CUANDO** se activa un grupo virtual, **ENTONCES** la vista explica que un grupo no tiene contrapartida en disco en lugar de no hacer nada.

**Evidencia.** [Vistas e interacción → Gestión de recursos personalizada](views-and-interaction.es.md#gestión-de-recursos-personalizada-wispkitresourcetree); material en `demo/R9-resource-tree/`; resultados de sondas en [Compilación y verificación](build-and-verify.es.md).

### R10  Modo global de solo lectura que evita cargar el documento

**Requisito.** La extensión DEBE proporcionar un control en la barra de estado que conmute el editor a un modo global de solo lectura. En ese modo, un archivo de texto de un tipo configurado DEBE mostrarse como vista previa de solo lectura que carga solo una ventana acotada del archivo, DEBE ofrecer una acción explícita que reabra ese archivo en un editor editable y DEBE indicar cuándo el contenido mostrado está truncado. El modo NO DEBE aplicarse a las vistas de navegación que la propia extensión posee.

**Justificación.** Leer un archivo grande para inspeccionar su cabecera no debería costar la memoria de cargar el archivo entero, ni arriesgar una modificación accidental. Ambos objetivos exigen que el documento no se materialice, y por eso el contenido truncado es un requisito y no un defecto.

**Criterios de aceptación.**

- **AC-R10.1** — **CUANDO** el control de solo lectura está activado y se abre un archivo de un tipo configurado, **ENTONCES** se abre como vista previa de solo lectura en lugar de en un editor de texto.
- **AC-R10.2** — **CUANDO** se abre en ese modo un archivo mayor que el límite de bytes configurado, **ENTONCES** la vista previa indica que solo se cargó una parte inicial y cuánto contiene el archivo.
- **AC-R10.3** — **CUANDO** se alcanza el límite de líneas configurado, **ENTONCES** la vista previa se detiene en esa línea y lo indica, y el resto no se muestra.
- **AC-R10.4** — **CUANDO** se usa la acción de desbloqueo, **ENTONCES** ese archivo se abre en un editor editable y la vista previa de solo lectura del mismo se cierra.
- **AC-R10.5** — **CUANDO** el modo se desactiva, **ENTONCES** los archivos posteriores se abren en su editor normal.
- **AC-R10.6** — **CUANDO** se abre en modo de solo lectura un tipo de archivo que pertenece a una de las vistas de navegación de la extensión, **ENTONCES** se abre en esa vista de navegación sin cambios, sin truncamiento.
- **AC-R10.7** — **CUANDO** la aplicación arranca y el modo está configurado como activo por defecto, **ENTONCES** el control refleja el estado activo sin que el usuario lo conmute.

**Evidencia.** [Vistas e interacción → Vista de texto de solo lectura](views-and-interaction.es.md#vista-de-texto-de-solo-lectura-wispkittext); material en `demo/R10-readonly/`; sondas en [Compilación y verificación](build-and-verify.es.md).

### R11  Panel de subárbol del Explorador y entradas de carpeta

**Requisito.** La extensión DEBE proporcionar, en una fila de carpeta del Explorador, una entrada que abra un panel de subárbol para esa carpeta, y una segunda entrada que abra la página de presentación declarada por esa carpeta. El panel de subárbol DEBE mostrar columnas configurables, DEBE cargar un nivel de directorio solo cuando se expande, DEBE ofrecer operaciones de archivo y herramientas definidas por el usuario sobre la selección, y DEBE aceptar arrastrar y soltar en ambos sentidos. Repetir la misma solicitud para la misma carpeta DEBE reutilizar el panel existente.

**Justificación.** El Explorador presenta una columna de nombres; revisar tamaños, fechas o tipos obliga a salir de él. Un panel temporal que sigue a la selección preserva el contexto de navegación en lugar de competir con él, y por eso es un panel y no otra vista permanente.

**Criterios de aceptación.**

- **AC-R11.1** — **CUANDO** se inspecciona una fila de carpeta, **ENTONCES** se ofrecen ambas entradas y están ausentes en filas que no son de carpeta.
- **AC-R11.2** — **CUANDO** se pide dos veces el panel de la misma carpeta, **ENTONCES** el panel existente se revela en lugar de duplicarse.
- **AC-R11.3** — **CUANDO** un nivel se colapsa y más tarde se expande, **ENTONCES** ese nivel se lee en el momento de la expansión.
- **AC-R11.4** — **CUANDO** se cambia la configuración de columnas, **ENTONCES** el panel muestra las columnas configuradas en el orden configurado, ignorando las entradas no válidas en lugar de fallar.
- **AC-R11.5** — **CUANDO** el anfitrión no expone el valor subyacente de una columna, **ENTONCES** la columna muestra un marcador explícito en lugar de un valor inventado.
- **AC-R11.6** — **CUANDO** se ejecuta una herramienta definida por el usuario, **ENTONCES** sus marcadores declarados se sustituyen y se ejecuta en el modo de ejecución declarado; un marcador desconocido DEBE dejarse literal en lugar de vaciarse en silencio.
- **AC-R11.7** — **CUANDO** un comando del anfitrión ofrecido en el área de acciones no está disponible, **ENTONCES** una advertencia nombra el comando ausente en lugar de fallar en silencio.
- **AC-R11.8** — **CUANDO** se sueltan archivos desde el sistema operativo o se arrastran entre dos paneles de subárbol, **ENTONCES** las operaciones de archivo resultantes se realizan y se informa su resultado.
- **AC-R11.9** — **CUANDO** un directorio contiene más entradas que el tope declarado, **ENTONCES** el exceso se trunca y el truncamiento se indica en el panel.
- **AC-R11.10** — **CUANDO** se escribe un carácter imprimible con el panel enfocado, **ENTONCES** la selección pasa a la primera entrada visible cuyo nombre empieza por ese prefijo, pulsar el mismo carácter otra vez sigue bajando por la lista y vuelve al principio, y apagar el interruptor detiene el comportamiento por completo.
- **AC-R11.11** — **CUANDO** una fila visible es un acceso directo o un ejecutable de Windows, **ENTONCES** la fila muestra el icono incrustado en el archivo cuando la plataforma lo ofrece y, si no, recurre al tema de iconos.
- **AC-R11.12** — **CUANDO** se elige el terminal del sistema para la selección, **ENTONCES** arranca un terminal independiente del editor en la carpeta seleccionada (en la carpeta del archivo seleccionado cuando se selecciona un archivo), y los tipos de terminal ofrecidos son exactamente los que ofrece la plataforma actual.
- **AC-R11.13** — **CUANDO** se elige abrir con la aplicación predeterminada, **ENTONCES** la selección se entrega a la aplicación que el sistema operativo tiene registrada, y esa entrada no está disponible cuando la selección contiene una carpeta.

**Evidencia.** [Vistas e interacción → Panel de subárbol](views-and-interaction.es.md#panel-de-subárbol-wispkitsubtree); material en `demo/R11-subtree/`; resultados de sondas en [Compilación y verificación](build-and-verify.es.md).

### R13  Vista de archivo Mermaid independiente

**Requisito.** Un archivo Mermaid independiente DEBE abrirse en una vista que renderice su diagrama, y DEBE ofrecer una entrada al origen, una acción de actualización y una entrada a la navegación 3D. Cuando el anfitrión no proporcione ningún script de renderizado Mermaid, la vista DEBE degradar a mostrar el origen con una explicación en lugar de una página vacía.

**Justificación.** Un archivo de código de diagrama no es más que texto. Reutilizar el script Mermaid del anfitrión mantiene un solo comportamiento de renderizado en todo el producto en lugar de dos que se separan con el tiempo.

**Criterios de aceptación.**

- **AC-R13.1** — **CUANDO** un archivo Mermaid se abre en esta vista, **ENTONCES** su diagrama se renderiza y una línea de estado informa el tipo de diagrama y sus recuentos de nodos y aristas.
- **AC-R13.2** — **CUANDO** se usa la entrada de origen, **ENTONCES** el mismo archivo se abre en un editor de texto normal junto a la vista.
- **AC-R13.3** — **CUANDO** se actualiza después de que el archivo cambie, **ENTONCES** el diagrama refleja el origen nuevo.
- **AC-R13.4** — **CUANDO** se usa la entrada 3D, **ENTONCES** el panel 3D se abre para este archivo e informa los mismos recuentos de elementos.
- **AC-R13.5** — **CUANDO** no hay ningún script de renderizado Mermaid disponible, **ENTONCES** la vista muestra el origen con una explicación y mantiene operativas sus acciones de barra de herramientas.

**Evidencia.** [Vistas e interacción → Vista de archivo Mermaid](views-and-interaction.es.md#vista-de-archivo-mermaid-wispkitmermaid); material `demo/R8-graph3d/04-standalone.mmd`; medido en [Compilación y verificación](build-and-verify.es.md).

### R14  Reproducción de vídeo dentro del editor

**Requisito.** Los contenedores de vídeo habituales DEBEN abrirse en una vista que los reproduzca mediante el propio elemento multimedia del anfitrión, sin incluir un reproductor. La vista DEBE ofrecer una entrega al reproductor del sistema y una acción de copiar la ruta, DEBE informar de un formato que no puede reproducir en lugar de mostrar un área negra silenciosa, y DEBE detener la reproducción cuando se abandona la vista.

**Justificación.** Abrir un vídeo no debería exigir salir del editor. La capacidad de reproducción pertenece al tiempo de ejecución; prometer más de lo que el tiempo de ejecución decodifica sería una promesa que el producto no puede cumplir, y por eso la reserva forma parte del requisito.

**Criterios de aceptación.**

- **AC-R14.1** — **CUANDO** un archivo de vídeo soportado se abre en esta vista, **ENTONCES** se reproduce con los controles nativos del tiempo de ejecución y se informa su duración cuando se conoce.
- **AC-R14.2** — **CUANDO** el tiempo de ejecución no puede reproducir el códec o contenedor del archivo, **ENTONCES** la página indica el motivo y ofrece la entrega al reproductor del sistema en lugar de un fotograma en blanco.
- **AC-R14.3** — **CUANDO** se usa la acción de copiar la ruta, **ENTONCES** la ruta absoluta llega al portapapeles.
- **AC-R14.4** — **CUANDO** el usuario cambia a otra pestaña, **ENTONCES** la reproducción se detiene.
- **AC-R14.5** — **CUANDO** se considera una extensión de archivo que también es la extensión de origen de un lenguaje de programación, **ENTONCES** no es reclamada por la vista de vídeo.

**Evidencia.** [Vistas e interacción → Vista de vídeo](views-and-interaction.es.md#vista-de-vídeo-wispkitvideo); resultados de sondas en [Compilación y verificación](build-and-verify.es.md).

### R15  Edición de párrafos en el sitio en la vista Markdown

**Requisito.** La vista Markdown DEBE ofrecer un modo de edición en el que activar un párrafo renderizado convierta **ese párrafo** en una caja de edición en el sitio, mientras el resto del documento sigue renderizado. La caja de edición DEBE contener el origen de ese párrafo literalmente, DEBE expresar de forma distinta un salto de párrafo y un salto de línea suave, DEBE permitir confirmar y descartar el párrafo actual, y DEBE guardar a través de la ruta de edición normal del anfitrión para que el cambio sea deshacible.

**Justificación.** Un editor de panel dividido obliga al lector a correlacionar dos vistas; editar el párrafo donde se lee mantiene el documento como objeto de atención. Acotar el alcance a un párrafo es lo que hace el modo lo bastante barato para conservarlo como conmutador en lugar de como un segundo editor.

**Criterios de aceptación.**

- **AC-R15.1** — **CUANDO** el modo de edición está activo y se activa un párrafo, **ENTONCES** ese párrafo se convierte en una caja editable que contiene su origen literalmente, y los demás párrafos siguen renderizados.
- **AC-R15.2** — **CUANDO** se introduce un salto de línea dentro de la caja, **ENTONCES** produce un salto de párrafo; **CUANDO** se introduce un salto de línea con modificador, **ENTONCES** produce un salto suave que no divide el párrafo.
- **AC-R15.3** — **CUANDO** se confirma el párrafo actual, **ENTONCES** el cambio se escribe en el documento y se guarda de inmediato.
- **AC-R15.4** — **CUANDO** se usa la acción de descartar, **ENTONCES** los cambios de ese párrafo se descartan y se restaura su forma renderizada.
- **AC-R15.5** — **CUANDO** se guarda el documento mientras se edita un párrafo, **ENTONCES** el texto pendiente se confirma primero.
- **AC-R15.6** — **CUANDO** se confirma una edición, **ENTONCES** el cambio es deshacible mediante el deshacer normal del anfitrión.
- **AC-R15.7** — **CUANDO** el modo de edición está desactivado, **ENTONCES** no se carga ningún texto de origen con fines de edición.

**Evidencia.** [Vistas e interacción → Modo de edición](views-and-interaction.es.md#modo-edición-edición-de-párrafos-en-el-sitio); el límite de la inferencia de líneas está en [Limitaciones conocidas](limitations.es.md#8-el-modo-edición-no-tiene-resaltado-de-sintaxis).

### R16  Búsqueda dentro del documento en la vista Markdown

**Requisito.** La vista Markdown DEBE proporcionar una barra de búsqueda que resalte cada coincidencia en el cuerpo del documento, informe la posición de la coincidencia actual y el total, salte entre coincidencias en ambos sentidos, soporte distinción de mayúsculas y borre su resaltado al cerrarse. Cuando haya texto seleccionado en el cuerpo, abrir la barra de búsqueda DEBE rellenar la consulta con él. La búsqueda NO DEBE entrar en regiones de diagramas, dibujos o gráficos vectoriales.

**Justificación.** Un lector que busca un término dentro de un documento largo ya renderizado necesita ver todas las apariciones a la vez, no una por una; entrar en regiones de diagramas produciría coincidencias que el lector no puede usar y rangos que el renderizador de terceros puede invalidar.

**Criterios de aceptación.**

- **AC-R16.1** — **CUANDO** se escribe una consulta, **ENTONCES** cada coincidencia del cuerpo se resalta y se muestra el recuento de coincidencias.
- **AC-R16.2** — **CUANDO** se usa la acción de siguiente o anterior, **ENTONCES** la coincidencia actual avanza o retrocede y se informa su posición.
- **AC-R16.3** — **CUANDO** se alterna la distinción de mayúsculas, **ENTONCES** el conjunto de coincidencias se recalcula en consecuencia.
- **AC-R16.4** — **CUANDO** se cierra la barra de búsqueda, **ENTONCES** todo el resaltado se elimina y el documento queda por lo demás sin cambios.
- **AC-R16.5** — **CUANDO** la barra de búsqueda se abre con texto del cuerpo seleccionado, **ENTONCES** la consulta se rellena con ese texto.
- **AC-R16.6** — **CUANDO** una consulta aparece dentro de un diagrama o gráfico vectorial, **ENTONCES** no se informa como coincidencia del cuerpo.
- **AC-R16.7** — **CUANDO** se resaltan coincidencias, **ENTONCES** el contenido propio del documento no se reescribe para marcarlas.

**Evidencia.** [Vistas e interacción → Zoom del cuerpo y búsqueda](views-and-interaction.es.md#zoom-del-cuerpo-y-búsqueda); medido en [Compilación y verificación](build-and-verify.es.md) y en la [tabla de mediciones del README](../README.es.md#comportamiento-medido).

### R17  Zoom del cuerpo en la vista Markdown

**Requisito.** La vista Markdown DEBE ofrecer un zoom del cuerpo suficientemente granular tanto mediante un control de barra de herramientas como mediante gestos de teclado, DEBE aplicar el zoom solo al cuerpo del documento, DEBE mantener la barra de herramientas y la barra lateral de directorio en su propio tamaño, y DEBE recordar el paso por documento.

**Justificación.** La salida renderizada se lee al tamaño que convenga al lector; ampliar toda la ventana haría crecer los controles que el lector necesita que permanezcan constantes.

**Criterios de aceptación.**

- **AC-R17.1** — **CUANDO** se usa el control de zoom de la barra de herramientas, **ENTONCES** la escala del cuerpo cambia a través de un conjunto fijo de pasos entre un mínimo y un máximo declarados.
- **AC-R17.2** — **CUANDO** se usa el gesto de restablecimiento, **ENTONCES** el cuerpo vuelve a su escala por defecto.
- **AC-R17.3** — **CUANDO** se amplía el cuerpo, **ENTONCES** la barra de herramientas y la barra lateral de directorio mantienen su propio tamaño.
- **AC-R17.4** — **CUANDO** el documento se cierra y se reabre, **ENTONCES** se restaura su último paso de zoom.
- **AC-R17.5** — **CUANDO** se amplía el cuerpo, **ENTONCES** los diagramas y dibujos que contiene no se escalan dos veces.

**Evidencia.** [Vistas e interacción → Zoom del cuerpo y búsqueda](views-and-interaction.es.md#zoom-del-cuerpo-y-búsqueda); el valor de configuración está documentado en [Configuración](configuration.es.md).

### R18  La propia superficie de la extensión está localizada

**Requisito.** Cada cadena visible para el usuario que la propia extensión posee —títulos de comandos, nombres de vistas, descripciones de ajustes— DEBE suministrarse a través del mecanismo de localización del anfitrión, y la extensión DEBE incluir al menos el mismo conjunto de idiomas que su documentación. Una cadena sin traducción DEBE caer al idioma por defecto en lugar de mostrar una clave.

**Justificación.** Los comandos y ajustes propios de la extensión aparecen en la paleta y en la página de ajustes del anfitrión, junto a funciones integradas totalmente localizadas. Ofrecer allí un solo idioma hace que el producto parezca inacabado, por bien que se comporten sus vistas.

**Criterios de aceptación.**

- **AC-R18.1** — **CUANDO** el anfitrión se ejecuta con un idioma de interfaz que la extensión incluye, **ENTONCES** sus títulos de comandos, nombres de vistas y descripciones de ajustes aparecen en ese idioma.
- **AC-R18.2** — **CUANDO** el anfitrión se ejecuta con un idioma que la extensión no incluye, **ENTONCES** aparecen las cadenas del idioma por defecto y no se muestra ninguna clave sin traducir.
- **AC-R18.3** — **CUANDO** se añade un comando, vista o ajuste nuevo, **ENTONCES** se añade a cada paquete de idioma incluido en el mismo cambio.

**Evidencia.** [Configuración](configuration.es.md); el hueco de medición es el elemento no verificado 5 de [Limitaciones conocidas](limitations.es.md).

### R19  Los accesos directos y los ejecutables de Windows tienen página de propiedades

**Requisito.** La extensión DEBE ofrecer un editor personalizado para los accesos directos `.lnk` que muestre la ruta de destino, el directorio de trabajo, los argumentos de inicio, la ubicación del icono, la etiqueta de volumen, la máquina de creación y los indicadores; y un editor personalizado para los archivos `.exe` que muestre la estructura PE: el formato (`PE32` o `PE32+`), la arquitectura, el subsistema, si la imagen es una DLL, si porta un ensamblado .NET, la RVA del punto de entrada, la base de la imagen, la tabla de secciones y los recursos de versión. Ambos DEBEN registrarse como editores `option`, de modo que ninguno se apropie del manejador de apertura por defecto. Abrir cualquiera de los dos tipos DEBE seguir su comportamiento configurado: entregarlo al sistema, abrirlo dentro de Wispkit o preguntar antes. En Windows la página del acceso directo DEBE permitir editar la ruta de destino, el directorio de trabajo, los argumentos y el comentario, y guardar DEBE reescribir solo los campos que el usuario cambió. Un ejecutable iniciado desde Wispkit DEBE usar como directorio de trabajo el suyo propio; un acceso directo iniciado desde Wispkit NO DEBE ver sobrescrito el directorio de trabajo que tiene registrado.

**Justificación.** Estos son los dos tipos de archivo que un lector más a menudo necesita *inspeccionar* y menos a menudo quiere *ejecutar*: pulsar un acceso directo con un icono engañoso no debería lanzar un programa, y averiguar si un ejecutable es de 32 o de 64 bits no debería exigir arrancarlo. Registrar ambos como editores `option` deja intacto el comportamiento de doble clic que el sistema ya tenía, mientras la página de propiedades queda a un *Reopen Editor With…* de distancia. La asimetría del directorio de trabajo es deliberada: un acceso directo registra su propio directorio de inicio, de modo que sustituirlo cambiaría en silencio lo que hace, mientras que un ejecutable no registra ninguno y el directorio que lo contiene es el único valor por defecto defendible.

**Criterios de aceptación.**

- **AC-R19.1** — **CUANDO** se abre un archivo `.lnk` en esta vista, **ENTONCES** se muestran su ruta de destino, directorio de trabajo, argumentos, ubicación del icono, etiqueta de volumen, máquina de creación e indicadores.
- **AC-R19.2** — **CUANDO** se abre un archivo `.exe` en esta vista, **ENTONCES** se muestran el formato, la arquitectura, el subsistema, el indicador de DLL, el indicador de .NET, la RVA del punto de entrada, la base de la imagen, las secciones y los recursos de versión.
- **AC-R19.3** — **CUANDO** se abre cualquiera de los dos tipos sin que el usuario elija una vista, **ENTONCES** se aplica el comportamiento del sistema, porque ambos editores están registrados como `option`.
- **AC-R19.4** — **CUANDO** el comportamiento de apertura es abrir dentro de Wispkit, **ENTONCES** el destino de un acceso directo se abre en Wispkit y la página de propiedades de un ejecutable se abre; **CUANDO** es entregar al sistema, **ENTONCES** el sistema abre el archivo.
- **AC-R19.5** — **CUANDO** el comportamiento de apertura es preguntar, **ENTONCES** se ofrece la elección antes de abrir nada.
- **AC-R19.6** — **CUANDO** el destino de un acceso directo es una carpeta y el ajuste de carpeta es el interno, **ENTONCES** la carpeta se abre en el panel de subárbol; **CUANDO** el ajuste es el del sistema, **ENTONCES** la abre el gestor de archivos del sistema.
- **AC-R19.7** — **CUANDO** se edita y guarda un campo de un acceso directo, **ENTONCES** solo se reescriben los campos editados y el resto del acceso directo, incluidos su icono y su tecla de acceso rápido, se conserva.
- **AC-R19.8** — **CUANDO** la edición de accesos directos está desactivada por configuración, **ENTONCES** la página no muestra formulario de edición y sigue siendo legible.
- **AC-R19.9** — **CUANDO** se inicia un ejecutable desde Wispkit, **ENTONCES** su directorio de trabajo es el directorio que contiene el ejecutable.
- **AC-R19.10** — **CUANDO** se inicia un acceso directo desde Wispkit, **ENTONCES** se usa sin cambios el directorio de trabajo registrado dentro del acceso directo.
- **AC-R19.11** — **CUANDO** se pide a cualquiera de las dos páginas analizar un archivo por encima del límite de tamaño declarado, **ENTONCES** declara el motivo en lugar de mostrar una página vacía.

**Evidencia.** [Vistas e interacción → Vista de acceso directo](views-and-interaction.es.md#vista-de-acceso-directo-wispkitshelllink) y [Vista de ejecutable](views-and-interaction.es.md#vista-de-ejecutable-wispkitexecutable); los cuatro ajustes están en [Configuración → Accesos directos y ejecutables de Windows](configuration.es.md#accesos-directos-y-ejecutables-de-windows); casos unitarios en `src/test/shellLink*.test.ts` y `src/test/peParse.test.ts`. Todavía no existe un conjunto de fixtures `demo/R19-*/`, así que este requisito se juzga por ahora solo con casos unitarios e inspección del manifiesto.

## 4. Restricciones transversales

Se aplican a todos los requisitos anteriores y no se repiten bajo cada uno.

### C1  Seguridad de contenido

- **C1.1** — Una vista que renderiza Markdown o XAML DEBE usar una política estricta: script solo por nonce, recursos solo del propio origen de la vista, ningún script en línea por relajación de la política.
- **C1.2** — Una vista que renderiza HTML arbitrario **PUEDE** usar una política relajada, porque los scripts propios de la página son el contenido. Esa relajación DEBE documentarse en [Seguridad](../README.es.md#seguridad) y en [Limitaciones conocidas](limitations.es.md#3-la-vista-html-usa-una-csp-relajada).
- **C1.3** — Cada archivo que una vista tiene permitido leer como recurso DEBE declararse, y la declaración DEBE incluir el directorio del propio documento siempre que el documento pueda referenciar recursos hermanos.
- **C1.4** — Una acción que escribe en disco DEBE escribir solo en un destino que el usuario eligió explícitamente o en el archivo que está editando.

### C2  Frontera entre anfitrión y front-end

- **C2.1** — Una URL de recurso dentro de una webview DEBE tratarse como opaca. El front-end NO DEBE intentar derivar de ella una ruta del sistema de archivos.
- **C2.2** — Cuando el front-end necesita identificar un recurso, DEBE informar una posición (índice más tipo) y el anfitrión DEBE releer el documento original.
- **C2.3** — Cada mensaje entre los dos lados DEBE ser un mensaje con nombre y carga útil declarada; una carga útil sin nombre o improvisada no es conforme.
- **C2.4** — La lógica que ambos lados comparten NO DEBE depender de la API del anfitrión, para que siga siendo comprobable fuera de un editor en ejecución.

### C3  Semántica de solo lectura

- **C3.1** — El modo de solo lectura DEBE acotar la ventana cargada tanto por un límite de bytes como por un límite de líneas, y DEBE indicar el truncamiento al lector.
- **C3.2** — El modo de solo lectura NO DEBE aplicarse a las vistas de navegación propias de la extensión; truncar un documento que se renderiza produciría un renderizado roto en lugar de uno más pequeño.
- **C3.3** — Un archivo presentado como solo lectura DEBE tener una ruta explícita de vuelta a un editor editable; un modo sin salida sería una trampa.

### C4  Rendimiento y escala

| Límite | Valor | Dónde se aplica |
|---|---|---|
| Elementos de gráfico por documento | 200 | Navegación 3D |
| Nodos por grafo | 600 | Navegación 3D |
| Nodos del árbol de recursos / hijos por nivel / profundidad | 2000 / 200 / 12 | `R9` |
| Entradas mostradas por nivel de directorio | 2000 | `R11` |
| Ventana cargada en solo lectura | 65536 bytes / 800 líneas por defecto, ambos configurables | `R10` |
| Umbrales de virtualización del cuerpo | unos 4000 elementos, o 40 tablas / bloques de código / diagramas, o 180000 caracteres de texto plano | `R2`, `R16`, `R17` |

- **C4.1** — Cada tope DEBE informarse cuando se alcanza; el truncamiento silencioso no es conforme.
- **C4.2** — Un bloque que contiene un diagrama DEBE mantener maquetación real incluso mientras el resto del cuerpo está virtualizado, porque un diagrama cuya maquetación se omite no puede informar su propio tamaño.

### C5  Portabilidad

- **C5.1** — La extensión DEBE declarar `^1.71.0` como su versión mínima de anfitrión y NO DEBE usar ninguna API de anfitrión introducida después de esa versión.
- **C5.2** — La propia extensión DEBE ser neutral respecto a la plataforma. La única parte ligada a la plataforma es el renderizador XAML, que requiere el tiempo de ejecución de escritorio de Windows y DEBE declararse como prerrequisito.
- **C5.3** — El renderizador XAML DEBE distribuirse dependiendo del framework, no autocontenido: el paquete no tiene permitido transportar un tiempo de ejecución.

### C6  Observabilidad

- **C6.1** — Un fallo causado por la entrada del usuario o por su entorno DEBE informarse con su causa; una no-operación silenciosa no es conforme.
- **C6.2** — Una aserción de prueba DEBE morder un resultado observable desde fuera. Una aserción que solo demuestra que una regla o un mensaje existe no satisface el requisito que dice cubrir.
- **C6.3** — Un número medido citado en cualquier documento DEBE ser reproducible mediante un comando declarado; un número sin comando es una estimación y DEBE etiquetarse como tal.

## 5. Mapa de verificación

| Capacidad | Requisito | Tipo de evidencia | Origen del número medido |
|---|---|---|---|
| Inyección de scripts de vista previa de terceros | `R1` | casos unitarios + sonda en máquina real | [Compilación y verificación → Estructura de pruebas](build-and-verify.es.md#estructura-de-las-pruebas); `demo/R1-injection/` |
| Navegación por directorio | `R2` | casos unitarios | [Compilación y verificación](build-and-verify.es.md#estructura-de-las-pruebas); `demo/R2-toc/` |
| Zoom de Mermaid en Markdown | `R3` | casos unitarios + sonda en máquina real | [Vistas e interacción](views-and-interaction.es.md#menú-contextual-de-medios); `demo/R3-mermaid/` |
| Zoom y paneo de imagen | `R4` | casos unitarios + sonda CDP | [Compilación y verificación](build-and-verify.es.md); `demo/R4-image/`; [tabla de mediciones del README](../README.es.md#comportamiento-medido) |
| Enrutado de enlaces | `R5` | casos unitarios | [Compilación y verificación](build-and-verify.es.md#estructura-de-las-pruebas); `demo/R5-jump/` |
| Origen y render de XAML | `R6` | contrato del renderizador + artefactos registrados + sonda en máquina real | [las notas del renderizador](../tools/xaml-render/README.md); `demo/R6-xaml/`, `demo/R12-xaml/` |
| Navegación de topología 3D | `R8` | sondas CDP sobre una instalación empaquetada | [Compilación y verificación → Bundle 3D y sondas de extremo a extremo](build-and-verify.es.md#3d-bundle-y-sondas-de-extremo-a-extremo); `demo/R8-graph3d/` |
| Gestión de recursos personalizada | `R9` | casos unitarios + tres suites de sondas | [Compilación y verificación → Pruebas del árbol de recursos](build-and-verify.es.md#pruebas-del-árbol-de-recursos-y-comprobación-del-empaquetado); `demo/R9-resource-tree/` |
| Modo de solo lectura | `R10` | casos unitarios + sonda en máquina real | [Compilación y verificación](build-and-verify.es.md#estructura-de-las-pruebas); `demo/R10-readonly/` |
| Panel de subárbol | `R11` | casos unitarios + sonda | [Compilación y verificación](build-and-verify.es.md#estructura-de-las-pruebas); `demo/R11-subtree/` |
| Vista de archivo Mermaid | `R13` | casos unitarios + sonda en máquina real | [tabla de mediciones del README](../README.es.md#comportamiento-medido); `demo/R8-graph3d/04-standalone.mmd` |
| Reproducción de vídeo | `R14` | sonda CDP | [tabla de mediciones del README](../README.es.md#comportamiento-medido) |
| Edición de párrafos | `R15` | casos unitarios + sonda en máquina real | [Compilación y verificación](build-and-verify.es.md#estructura-de-las-pruebas); [tabla de mediciones del README](../README.es.md#comportamiento-medido) |
| Búsqueda dentro del documento | `R16` | sonda CDP | [tabla de mediciones del README](../README.es.md#comportamiento-medido) |
| Zoom del cuerpo | `R17` | sonda CDP | [tabla de mediciones del README](../README.es.md#comportamiento-medido) |
| Localización | `R18` | inspección del manifiesto | [Configuración](configuration.es.md); elemento no verificado 5 de [Limitaciones conocidas](limitations.es.md) |
| Páginas de propiedades de accesos directos y ejecutables | `R19` | casos unitarios + inspección del manifiesto | [Vistas e interacción → Vista de acceso directo](views-and-interaction.es.md#vista-de-acceso-directo-wispkitshelllink) y [Vista de ejecutable](views-and-interaction.es.md#vista-de-ejecutable-wispkitexecutable); ajustes en [Configuración → Accesos directos y ejecutables de Windows](configuration.es.md#accesos-directos-y-ejecutables-de-windows); `src/test/shellLink*.test.ts`, `src/test/peParse.test.ts` |

**Números medidos directamente al escribir este documento:** 70 archivos de prueba / **1149** casos en verde (`npm test`), 8 bundles de webview, un bundle 3D de unos 603 KB, 19 ajustes, 9 editores personalizados, 2 vistas contribuidas, 61 patrones glob de solo lectura por defecto, **173** entradas de contenido empaquetadas (`vsce ls`; `wispkit-0.2.15.vsix` contiene 175 entradas de archivo, unos 1,73 MB).

**Los documentos que contienen estas cifras se alinearon en el mismo cambio que añadió este archivo.** [README](../README.es.md#compilación-y-entorno-medido), [Compilación y verificación](build-and-verify.es.md#estructura-de-las-pruebas), [Arquitectura](architecture.es.md#escala) y el [índice](index.es.md) ahora declaran los mismos totales. La línea base se registra aquí una vez para que el contrato de requisitos diga qué significa «medido»; los demás documentos no pueden discrepar de ella.

## 6. Diferido y excluido

Cada fila de abajo tiene un elemento correspondiente en [Limitaciones conocidas](limitations.es.md). Cuando los dos difieren, esta tabla gana en **intención** y la página de limitaciones gana en **detalle**.

| Elemento | Estado | Por qué no se promete | Prerrequisito para revisarlo |
|---|---|---|---|
| Sincronización de desplazamiento editor ↔ vista previa | No entregada | Requiere un protocolo de mapa de origen que la vista previa no emite; la navegación por directorio no depende de él (limitación 1) | Un contrato estable de mapa de origen del anfitrión |
| Adueñarse del Simple Browser del anfitrión | Imposible en la superficie pública | Es un panel creado por comando y nunca entra en la competición de editores personalizados (limitación 2) | Un mecanismo del anfitrión para reclamar un panel existente |
| HTML renderizado bajo una política relajada | Entregado, con advertencia | Navegar HTML exige por naturaleza los scripts propios de la página (limitación 3) | No aplica: la relajación es la única política viable |
| Seis tipos de vista que toman el manejador de apertura por defecto | Deliberado | Las vistas de navegación pretenden ser el destino de un doble clic (limitación 4) | Que el usuario cambie las asociaciones explícitamente |
| El zoom Mermaid por defecto depende de la extensión de diagramas del anfitrión | Dependencia deliberada | La extensión eleva un valor por defecto contribuido en lugar de incluir un segundo renderizador (limitación 5) | Incluir un renderizador, con un coste de tamaño que el proyecto rechaza |
| XAML renderizado como instantánea estática | Deliberado | Evaluar contra datos vivos y ejecutar manejadores exigiría alojar la aplicación (limitación 6) | Nunca, bajo la intención 1 |
| Los tipos raíz XAML tienen que estar ya compilados | Dependiente del entorno | Un tipo que solo existe en el código fuente no puede alojarse (limitación 7) | Compilar antes el proyecto |
| La caja de edición no tiene resaltado de sintaxis | Compromiso deliberado | Una superficie de texto plano garantiza la coincidencia carácter por carácter con el origen (limitación 8) | Un editor embebible que garantice la misma coincidencia |
| El modo de solo lectura omite las vistas de navegación propias | Deliberado | Truncar un documento renderizado produce un renderizado roto (limitación 9) | No aplica |
| El modo de solo lectura reemplaza la pestaña una vez al cambiar de editor | Comportamiento conocido | El modo reescribe asociaciones, así que al conmutar ocurre un reemplazo (limitación 10) | Una API del anfitrión que abra un documento directamente en un editor elegido sin recargar |
| `atime` y los bits de permiso siempre muestran un marcador | Limitación del anfitrión | Los metadatos de archivo del anfitrión no los exponen (limitación 11) | Una API del anfitrión que los exponga |
| Los temas de iconos basados en fuentes no tienen respaldo | Comportamiento conocido | Solo se analizan las definiciones de icono vectoriales (limitación 12) | Analizar las asignaciones de glifos de fuentes |
| Los comandos integrados del Explorador son una lista mantenida a mano | Comportamiento conocido | El anfitrión no expone ninguna lista enumerable (limitación 13) | Una API que enumere sus propios comandos con argumentos |
| Las operaciones de archivo del subárbol son propias | Deliberado | El anfitrión no expone sus propias operaciones para reutilizarlas (limitación 14) | No aplica |
| El 3D analiza topología, no el renderizado de la biblioteca de diagramas | Deliberado | La salida vectorial 2D no puede convertirse en una escena rotable; el 3D necesita la topología (limitación 15) | Un emisor 3D que preserve la topología |
| El reconocimiento de árboles ASCII desnudos es conservador | Deliberado | Adivinar demasiado inventaría grafos que el lector nunca escribió (limitación 16) | Un recurso de desambiguación en el panel |
| Topes de elementos y nodos del 3D | Deliberado | Coste acotado de maquetación y renderizado (limitación 17, C4) | Trabajo de rendimiento medido con grafos grandes |
| La escena 3D requiere un contexto 3D | Dependiente del entorno | Una proyección 2D prometería otro producto (limitación 18) | No aplica |
| Los grupos virtuales no tienen contrapartida en disco | Por diseño | Un grupo nombra y agrupa; no es un directorio (limitación 19) | No aplica |
| Las rutas absolutas fuera del espacio de trabajo no viajan | Comportamiento conocido | No hay ancla de marcador fuera del espacio de trabajo (limitación 20) | Un esquema de anclas portátil |
| Ediciones externas concurrentes: gana el último escritor | Comportamiento conocido | Se añadió comparación antes de escribir, pero queda una ventana (limitación 21) | Un protocolo de bloqueo en el formato de almacenamiento |
| Fronteras de enlaces simbólicos, permisos y múltiples raíces | Parcialmente verificado | Verificado en máquina real para los casos listados; los sistemas de archivos remotos no (limitación 22) | Un entorno con sistema de archivos remoto |
| Topes de tamaño del árbol de recursos | Deliberado | Coste de lectura y renderizado acotado (limitación 23) | No aplica |
| La vista previa Mermaid independiente depende de la extensión de diagramas del anfitrión | Deliberado | Reutiliza un solo comportamiento de renderizado en lugar de dos (limitación 24) | No aplica |
| Un archivo Mermaid es un diagrama | Por diseño | Un archivo es un documento, una escena por archivo (limitación 25) | Un formato de archivo con múltiples escenas |
| La navegación 3D de archivos Mermaid comparte los límites del analizador | Comportamiento conocido | El mismo analizador, la misma cobertura (limitación 26) | Trabajo de cobertura del analizador |
| HEIF / HEIC / TIFF / JXL y varios contenedores de vídeo | Deliberado | Un decodificador cuesta megabytes; en su lugar hay una reserva explícita (limitación 27) | Un tiempo de ejecución que incluya el decodificador |
| Apariencia a nivel de píxel y fuentes de edición multilingüe | No verificado | Varios cambios se verificaron por valor en lugar de comparar píxeles renderizados (no verificado 1) | Comparación de renderizado lado a lado |
| Precisión de los límites de párrafo en estructuras anidadas | No verificado | La línea final se infiere de los inicios de bloque; el anidamiento es el caso menos preciso (no verificado 2) | Comprobación en máquina real por tipo de anidamiento |
| La ruta de escritura completa del espacio de trabajo, los comandos del Explorador contribuidos y la recogida de la localización | No verificado | Probados por unidad, nunca ejecutados en el producto real (no verificado 3, 4, 5) | Ejercicio en máquina real |
| Momento del reemplazo de la pestaña de solo lectura en discos lentos, archivos grandes y pestañas de vista previa | No verificado | La ruta de reemplazo se ejercita, pero no en esas condiciones (no verificado 6) | Activar y desactivar una vez las pestañas de vista previa y medir ambos casos |
| Directorios muy grandes y rutas de red | No verificado | No se ejercitó tal entorno (no verificado 7, 14) | Un entorno con un recurso compartido grande |
| Cobertura del puente de idiomas del tema de iconos | No verificado | La tabla extensión-a-lenguaje no se comparó elemento por elemento (no verificado 8) | Comparación exhaustiva |
| Rendimiento 3D con grafos grandes y corrección visual de tipos de diagrama poco frecuentes | No verificado | Maquetaciones probadas por unidad; las muestras en máquina real eran pequeñas (no verificado 9, 10, 11) | Medición con grafos grandes |
| El destino de carpeta de un acceso directo solo llega al panel de subárbol | Deliberado | El navegador de comparación no acepta un directorio inicial, así que el panel de subárbol es el único destino interno (limitación 28) | Un navegador de comparación que acepte un directorio inicial |
| Los archivos `.dll` no tienen página de propiedades | Deliberado | Solo se registra `*.exe`; el analizador es válido para DLL pero ningún selector las reclama (limitación 29) | Registrar un selector `.dll` |
| La edición de accesos directos es solo para Windows | Ligado a la plataforma | La vía de escritura es el objeto de acceso directo del anfitrión de scripts de Windows, que solo existe allí (limitación 30) | Un escritor de accesos directos multiplataforma |
| Un acceso directo que solo guarda una IDList de destino no puede abrirse internamente | Limitación del anfitrión | No existe una ruta absoluta legible, así que el sistema es la única vía (limitación 31) | No aplicable |
| Los documentos por encima del límite de 256 MB se rechazan | Deliberado | Analizar un archivo sin límite en el anfitrión de la extensión bloquearía la interfaz (limitación 32) | Un análisis en flujo con presupuesto declarado |
| El análisis de accesos directos en macOS y Linux | Parcialmente admitido | El análisis a nivel de bytes funciona; la apertura del sistema y la edición no se aplican (limitación 33) | No aplicable |

### Inconsistencias de documentación encontradas al escribir este archivo

Estos son defectos del conjunto existente, listados para que no se normalicen en silencio. La discrepancia de tamaño del VSIX que se listaba aquí se resolvió en el mismo cambio que añadió este archivo; las dos siguientes siguen abiertas.

1. **`demo/R6-xaml/` describe una ruta de renderizado ya superada** — sus notas de material dicen que el renderizador recorre una ruta de análisis de texto, mientras que [Vistas e interacción](views-and-interaction.es.md#cadena-de-llamada-del-render) y [las notas del renderizador](../tools/xaml-render/README.md) describen alojar primero en un ensamblado compilado y recurrir a esa ruta solo cuando no puede alojarse ningún tipo raíz. El material sigue siendo válido; solo su párrafo explicativo está desactualizado.
2. **`demo/R6-xaml/` declara que la vista XAML no reclama el manejador de apertura por defecto** — ahora es `default`, como registran [Vistas e interacción](views-and-interaction.es.md#vista-xaml-wispkitxaml) y el manifiesto. La instrucción de usar *Reopen Editor With…* sigue funcionando, pero ya no es la única vía.

## 7. Protocolo de cambio

| Si cambias… | También debes actualizar… | Porque |
|---|---|---|
| Cualquier comportamiento visible para el usuario | La entrada `R`/`AC` de este archivo | Los requisitos preceden a la implementación; un documento que va por detrás del comportamiento es un defecto (C6) |
| La interacción o el gesto de cualquier vista | [Vistas e interacción](views-and-interaction.es.md) y el material `demo/R<n>-*/` correspondiente | Un criterio debe poder reproducirse por quien lea el documento después |
| El nombre, el valor por defecto o el rango de cualquier ajuste | [Configuración](configuration.es.md) y cada paquete de idioma incluido | Una clave de ajuste es un contrato externo; renombrarla en silencio rompe los ajustes de los usuarios |
| Cualquier recuento de pruebas, tamaño de paquete o resultado medido | [Compilación y verificación](build-and-verify.es.md) | Los números deben venir de un comando realmente ejecutado (C6.3) |
| Cualquier documento | Las variantes en chino y español, **en el mismo cambio** | Un documento en un solo idioma es un defecto; las tres variantes son traducciones, no resúmenes |
| Una vista o capacidad nueva | Asignar aquí un número `R` **primero** y después construirla | El número es la identidad del requisito; asignarlo después vuelve retroactiva y ambigua la correspondencia con el material |
| Un requisito retirado | Registrar aquí la retirada y dejar el número vacante | Reutilizar un número cambia en silencio el significado de las referencias antiguas (`R7`) |
| Un conjunto de material de aceptación nuevo | Nombrarlo `demo/R<n>-*/` para su requisito, o registrar la excepción aquí (`R12`) | La correspondencia entre número y material forma parte del contrato |
| La tabla de temas del README | La tabla de temas del índice de documentación, y viceversa | Dos tablas que listan los mismos temas no pueden divergir |
| Un fallo que no se va a corregir | [Limitaciones conocidas](limitations.es.md) **y** el [§6](#6-diferido-y-excluido) de este archivo | Cada fallo tiene un hogar y una referencia cruzada |

## 8. Registro de cambios de este documento

- **Creado** consolidando material que antes vivía en cuatro lugares: la reafirmación de requisitos, la lista de aceptación y la lista honesta del registro de encargo original; [Vistas e interacción](views-and-interaction.es.md); [Configuración](configuration.es.md); [Limitaciones conocidas](limitations.es.md).
- **La numeración de requisitos** sigue el orden de encargo (`R1`–`R6`, `R8`–`R12`) y lo extiende para capacidades entregadas después sin número (`R13`–`R18`). `R7` queda registrado como retirado en lugar de reasignado; `R12` queda registrado como un segundo conjunto de material de `R6`, no como una capacidad separada.
- **Los criterios de aceptación** se redactaron de nuevo como enunciados `CUANDO … ENTONCES …`. Cuando una capacidad entregada no tenía criterio previo, el comportamiento observable se tomó de [Vistas e interacción](views-and-interaction.es.md) y se reformuló sin detalle de implementación.
- **Las filas diferidas** se conciliaron con los 27 elementos de limitaciones y las 16 filas no verificadas en el momento de escribir; las tres inconsistencias de documentación encontradas en esa conciliación se listan en el [§6](#inconsistencias-de-documentación-encontradas-al-escribir-este-archivo).
- **Las discrepancias de números** registradas en el [§5](#5-mapa-de-verificación) se enuncian en lugar de corregirse, porque corregirlas corresponde a los documentos que poseen esos números.
- **`R19` se asignó en este cambio** para las páginas de propiedades de accesos directos y ejecutables de Windows, que se habían entregado sin número de requisito. Reutiliza la forma de prioridad `option` de `R10` en lugar de reclamar el manejador de apertura por defecto, y su conjunto de fixtures sigue vacío, lo cual se registra en su línea de evidencia en vez de quedar implícito.
