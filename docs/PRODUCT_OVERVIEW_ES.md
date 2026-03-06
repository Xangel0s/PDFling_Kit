# PDFling - Product Overview (Interno)

## Objetivo

PDFling es una extension de Chrome para editar y exportar documentos PDF de forma rapida, visual y principalmente local.

## Problema que resuelve

Equipos que trabajan con PDFs suelen depender de herramientas separadas para visualizar, anotar, ajustar y exportar. Esto genera friccion operativa, perdida de tiempo y resultados inconsistentes.

PDFling centraliza ese flujo en una mesa de trabajo unica.

## Capacidades actuales

- Carga de PDF y navegacion por paginas.
- Agregar texto y figuras geometricas.
- Ajustes visuales de figuras (color, tamano, redondeado).
- Deshacer y rehacer con UI y atajos de teclado.
- Exportacion de PDF con anotaciones aplanadas.
- Historial local de operaciones recientes.
- Popup con idioma ES/EN y configuracion de tema.

## Valor para gestion de equipo

- Menos tiempo por tarea documental.
- Mayor consistencia visual en entregables.
- Menor dependencia de herramientas externas para cambios simples.
- Mejor continuidad operativa por historial local.
- Curva de aprendizaje baja para perfiles no tecnicos.

## Alcance tecnico

- Manifest V3
- TypeScript + Webpack
- pdfjs-dist, pdf-lib, fabric
- Almacenamiento local con chrome.storage e IndexedDB

## Estado

Producto funcional para uso interno y crecimiento incremental.

## Proxima evolucion recomendada

- Pruebas automatizadas de exportacion.
- Checklist de release y versionado formal.
- Metricas de uso local para priorizar mejoras.
