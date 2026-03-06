# Mini Sterling

Editor de PDF para Chrome Extension (Manifest V3), pensado para trabajar de forma local, rapida y privada.

## Que es Mini Sterling

Mini Sterling es una extension para:

- unir PDFs
- navegar por paginas con miniaturas
- agregar imagenes/sellos y texto sobre el documento
- eliminar paginas especificas
- exportar el PDF final con nombre personalizado
- usar un panel de IA para consultar y resumir contenido del PDF

Todo el flujo esta orientado a una experiencia visual clara tipo "mesa de trabajo".

## Caracteristicas destacadas

- Procesamiento local del PDF con `pdf.js`, `pdf-lib` y `fabric.js`
- Interfaz moderna en tres paneles (paginas, lienzo, herramientas)
- Biblioteca de sellos frecuente con almacenamiento local
- Exportacion con panel integrado (sin modal del navegador)
- Barra lateral izquierda colapsable y ajustable
- Arquitectura modular en TypeScript

## Stack

- TypeScript
- Webpack
- Chrome Extension Manifest V3
- pdfjs-dist
- pdf-lib
- fabric

## Estructura principal

```text
src/
  background/
  popup/
  services/
  shared/
  workspace/
```

## Como ejecutar

```bash
npm install
npm run build
```

Luego carga la carpeta `dist/` como extension desempaquetada en `chrome://extensions`.

## Roadmap comunitario

- mejoras de rendimiento para documentos grandes
- historial/undo de operaciones
- plantillas de sellos por equipo
- internacionalizacion de la UI

## Contribuir

1. Haz un fork
2. Crea tu rama: `feature/mi-mejora`
3. Abre un Pull Request con contexto y capturas

Si quieres colaborar en UI, DX o rendimiento de PDFs, eres bienvenido.

## Captura

![Mini Sterling Workspace](./img2.png)

---

Construido para equipos que necesitan editar PDFs con velocidad, control y una experiencia cuidada.
